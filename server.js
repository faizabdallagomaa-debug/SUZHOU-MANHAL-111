/**
 * Suzhou Manhal — Website Server  |  سيرفر موقع سوجو منهل
 *
 * Zero dependencies — requires Node.js 18+ only.
 *   node server.js   →  site: http://localhost:3000
 * Features: content API, admin auth, uploads, customer messages (DB),
 * email notifications (SMTP / Gmail), WhatsApp fallback (CallMeBot),
 * Web Push notifications to the installed admin app (PWA).
 */
'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
const BACKUPS = path.join(DATA, 'backups');
const F = {
  content: path.join(DATA, 'content.json'),
  seed: path.join(DATA, 'seed.json'),
  auth: path.join(DATA, 'auth.json'),
  messages: path.join(DATA, 'messages.json'),
  private: path.join(DATA, 'private.json'),
  vapid: path.join(DATA, 'vapid.json'),
  subs: path.join(DATA, 'push-subscriptions.json'),
  ops: path.join(DATA, 'operations.json'),
  stats: path.join(DATA, 'stats.json')
};
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'SuzhouMm@2000';
const SESSION_HOURS = 12;
const STATUSES = ['new', 'replied', 'completed'];
const LANGS = ['ar', 'en', 'zh'];
const normLang = l => (LANGS.includes(l) ? l : 'ar');

for (const d of [DATA, UPLOADS, BACKUPS]) fs.mkdirSync(d, { recursive: true });

/* ================= storage ================= */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
if (!fs.existsSync(F.content)) {
  if (fs.existsSync(F.seed)) fs.copyFileSync(F.seed, F.content); else writeJSON(F.content, {});
}
if (!fs.existsSync(F.messages)) writeJSON(F.messages, []);

/* Private settings (never sent to the public site) */
const PRIVATE_DEFAULTS = {
  // where customer messages are delivered: set in Admin › Email & Notifications (or the NOTIFY_EMAIL environment variable)
  notifyEmail: process.env.NOTIFY_EMAIL || 'suzhoumanhal@gmail.com',
  smtp: { host: 'smtp.gmail.com', port: 465, user: 'suzhoumanhal@gmail.com', pass: '', fromName: 'Suzhou Manhal' },
  whatsapp: { mode: 'fallback', phone: '966539759859', apikey: '' },
  completionEmail: {
    enabled: true,
    subject: { ar: 'تم إنجاز طلبك — سوجو منهل', en: 'Your request is completed — Suzhou Manhal', zh: '您的需求已完成 — 苏州曼哈尔' },
    body: {
      ar: 'مرحباً {name}،\n\nنود إبلاغك بأنه تم الانتهاء من طلبك بخصوص: {machine}.\nنشكرك على ثقتك في سوجو منهل، ويسعدنا خدمتك دائماً.\n\nمع خالص التحية،\nفريق سوجو منهل',
      en: 'Hello {name},\n\nWe are pleased to inform you that your request regarding: {machine} has been completed.\nThank you for trusting Suzhou Manhal — we are always happy to serve you.\n\nBest regards,\nSuzhou Manhal Team',
      zh: '{name} 您好：\n\n很高兴通知您，您关于「{machine}」的需求已经完成。\n感谢您对苏州曼哈尔的信任，我们随时乐意为您服务。\n\n此致\n苏州曼哈尔团队'
    }
  }
};
function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  }
  return out;
}
const getPrivate = () => deepMerge(PRIVATE_DEFAULTS, readJSON(F.private, {}));

/* ================= password auth ================= */
const hashPassword = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
function loadAuth() {
  let a = readJSON(F.auth, null);
  if (!a || !a.hash) {
    const salt = crypto.randomBytes(16).toString('hex');
    a = { salt, hash: hashPassword(DEFAULT_PASSWORD, salt), isDefault: true };
    writeJSON(F.auth, a);
  }
  return a;
}
let auth = loadAuth();
function checkPassword(pw) {
  const h = Buffer.from(hashPassword(pw, auth.salt), 'hex');
  const ref = Buffer.from(auth.hash, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}
const sessions = new Map();
function newSession() {
  const t = crypto.randomBytes(32).toString('hex');
  for (const [k, exp] of sessions) if (exp < Date.now()) sessions.delete(k);
  while (sessions.size >= 20) sessions.delete(sessions.keys().next().value); // cap concurrent sessions
  sessions.set(t, Date.now() + SESSION_HOURS * 3600e3);
  return t;
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function isAuthed(req) {
  const t = getCookie(req, 'sm_session');
  if (!t || !sessions.has(t)) return false;
  if (sessions.get(t) < Date.now()) { sessions.delete(t); return false; }
  return true;
}
const isHttps = req => req.socket.encrypted || (req.headers['x-forwarded-proto'] || '').includes('https');

/* ================= rate limiting ================= */
const buckets = new Map();
function blocked(key, max) { const b = buckets.get(key); return !!(b && Date.now() <= b.reset && b.n >= max); }
function limited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n++; buckets.set(key, b);
  return b.n > max;
}
const isLoopback = a => /^(127\.|::1$|::ffff:127\.)/.test(a || '');
const ip = req => {
  const remote = req.socket.remoteAddress || '';
  if (isLoopback(remote) && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',').pop().trim() || remote;
  return remote;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= SMTP mail client (Gmail compatible) ================= */
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const encHeader = s => { s = String(s || '').replace(/[\r\n]+/g, ' '); return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`; };
const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');

function buildMime({ from, fromName, to, cc, replyTo, subject, text, html }) {
  const boundary = 'b_' + crypto.randomBytes(12).toString('hex');
  const domain = (from.split('@')[1] || 'localhost');
  const headers = [
    `From: ${encHeader(fromName || from)} <${from}>`,
    `To: ${[].concat(to).join(', ')}`,
    cc && cc.length ? `Cc: ${[].concat(cc).join(', ')}` : null,
    replyTo && EMAIL_RE.test(replyTo) ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(10).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ].filter(Boolean);
  const part = (type, body) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(body))}`;
  return headers.join('\r\n') + '\r\n\r\n' + part('text/plain', text || '') + '\r\n' + part('text/html', html || (text || '').replace(/\n/g, '<br>')) + `\r\n--${boundary}--\r\n`;
}

function smtpSend(cfg, mail) {
  return new Promise((resolve, reject) => {
    const port = Number(cfg.port) || 465;
    const implicitTLS = cfg.secure != null ? cfg.secure : port === 465;
    let socket;
    let buffer = '';
    let waiter = null;
    let done = false;
    const timer = setTimeout(() => fail(new Error('SMTP timeout')), 25000);
    function fail(e) { if (done) return; done = true; clearTimeout(timer); try { socket.destroy(); } catch { /* */ } reject(e); }
    function onData(chunk) {
      buffer += chunk.toString('utf8');
      if (!waiter) return;
      const lines = buffer.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const resp = lines.slice(0, i + 1).join('\n');
          buffer = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null;
          if (w) w(resp);
          return onData('');
        }
      }
    }
    const read = () => new Promise(r => { waiter = r; if (buffer) onData(''); });
    async function cmd(line, expect) {
      if (line != null) socket.write(line + '\r\n');
      const resp = await read();
      const code = parseInt(resp.slice(-200).match(/(\d{3}) [^\n]*$/)[1], 10);
      if (expect && !expect.includes(code)) throw new Error(`SMTP ${code}: ${resp.split('\n').pop()}`);
      return resp;
    }
    function attach(s) {
      socket = s;
      s.on('data', onData);
      s.on('error', fail);
    }
    async function run() {
      try {
        await cmd(null, [220]);
        let ehlo = await cmd('EHLO suzhoumanhal.local', [250]);
        if (!implicitTLS && /STARTTLS/i.test(ehlo)) {
          await cmd('STARTTLS', [220]);
          socket.removeAllListeners('data');
          await new Promise((res, rej) => {
            const t = tls.connect({ socket, servername: cfg.host }, res);
            t.on('error', rej);
            attach(t);
          });
          ehlo = await cmd('EHLO suzhoumanhal.local', [250]);
        }
        if (cfg.user && cfg.pass) {
          await cmd('AUTH LOGIN', [334]);
          await cmd(b64(cfg.user), [334]);
          await cmd(b64(cfg.pass), [235]);
        }
        const from = mail.from || cfg.user;
        await cmd(`MAIL FROM:<${from}>`, [250]);
        for (const r of [].concat(mail.to, mail.cc || []).filter(Boolean)) await cmd(`RCPT TO:<${r}>`, [250, 251]);
        await cmd('DATA', [354]);
        const body = buildMime({ ...mail, from, fromName: mail.fromName || cfg.fromName }).replace(/\r\n\./g, '\r\n..');
        await cmd(body + '\r\n.', [250]);
        socket.write('QUIT\r\n');
        done = true; clearTimeout(timer); socket.end();
        resolve(true);
      } catch (e) { fail(e); }
    }
    const opts = { host: cfg.host, port };
    if (implicitTLS) attach(tls.connect({ ...opts, servername: cfg.host }, run));
    else { attach(net.connect(opts, run)); }
  });
}
function mailConfigured(p) { return !!(p.smtp && p.smtp.host && p.smtp.user && p.smtp.pass); }
async function sendMail(mail) {
  const p = getPrivate();
  if (!mailConfigured(p)) throw new Error('Email (SMTP) is not configured');
  return smtpSend(p.smtp, mail);
}

/* ================= WhatsApp (CallMeBot) ================= */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject).setTimeout(20000, function () { this.destroy(new Error('timeout')); });
  });
}
async function sendWhatsApp(text) {
  const p = getPrivate();
  const phone = String(p.whatsapp.phone || '').replace(/[^\d]/g, '');
  if (!phone || !p.whatsapp.apikey) throw new Error('WhatsApp notifications are not configured (phone + API key)');
  const url = `https://api.callmebot.com/whatsapp.php?phone=%2B${phone}&text=${encodeURIComponent(text.slice(0, 1500))}&apikey=${encodeURIComponent(p.whatsapp.apikey)}`;
  const r = await httpGet(url);
  if (r.status !== 200 || /error|invalid/i.test(r.body.slice(0, 300))) throw new Error('WhatsApp API: ' + r.status + ' ' + r.body.replace(/<[^>]+>/g, ' ').trim().slice(0, 120));
  return true;
}

/* ================= Web Push (VAPID + aes128gcm, RFC 8291/8292) ================= */
const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function getVapid() {
  let v = readJSON(F.vapid, null);
  if (!v || !v.privateJwk) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    v = { privateJwk: jwk, publicKey: b64url(Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)])) };
    writeJSON(F.vapid, v);
  }
  return v;
}
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
function encryptPush(sub, payload) {
  const uaPublic = fromB64url(sub.keys.p256dh);
  const authSecret = fromB64url(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}
function vapidAuth(endpoint) {
  const v = getVapid();
  const aud = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:' + (getPrivate().notifyEmail || 'admin@example.com') }));
  const key = crypto.createPrivateKey({ key: v.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${v.publicKey}`;
}
function pushOne(sub, payload) {
  return new Promise((resolve) => {
    let body;
    try { body = encryptPush(sub, payload); } catch (e) { return resolve({ ok: false, gone: true, error: e.message }); }
    const u = new URL(sub.endpoint);
    const req = https.request({ method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers: {
      'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length,
      TTL: '86400', Urgency: 'high', Authorization: vapidAuth(sub.endpoint)
    } }, res => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, gone: res.statusCode === 404 || res.statusCode === 410, status: res.statusCode });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}
async function pushAll(data) {
  const subs = readJSON(F.subs, []);
  if (!subs.length) return { sent: 0, total: 0 };
  const payload = JSON.stringify(data);
  const results = await Promise.all(subs.map(s => pushOne(s, payload)));
  const keep = subs.filter((s, i) => !results[i].gone);
  if (keep.length !== subs.length) writeJSON(F.subs, keep);
  return { sent: results.filter(r => r.ok).length, total: subs.length };
}

/* ================= machine translation ================= */
async function translateChunk(q, from, to) {
  const r = await httpGet('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=' + from + '|' + to);
  let j; try { j = JSON.parse(r.body); } catch { throw new Error('bad response'); }
  if (j.responseStatus && Number(j.responseStatus) !== 200) throw new Error(String(j.responseDetails || j.responseStatus).slice(0, 120));
  return String((j.responseData && j.responseData.translatedText) || '');
}
async function translate(text, from, to) {
  // keep line structure (bullets) and respect the ~480 char limit per request
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(\s*(?:•|-|\*|–)\s+)?(.*)$/);
    const prefix = m[1] || '', body = m[2];
    if (!body.trim()) { out.push(line); continue; }
    const parts = body.length <= 480 ? [body] : body.match(/[^.!?。！？؟]+[.!?。！？؟]*\s*/g) || [body];
    let res = '';
    for (const p of parts) res += (await translateChunk(p.slice(0, 480), from, to)) + (to === 'zh-CN' ? '' : ' ');
    out.push(prefix + res.trim());
  }
  return out.join('\n');
}

/* ================= message notifications ================= */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const FIELD_LABELS = [['name', 'الاسم'], ['company', 'الشركة'], ['phone', 'الجوال'], ['email', 'البريد'], ['country', 'الدولة'], ['machine', 'الطلب / الماكينة'], ['message', 'الرسالة']];
function messageText(m) {
  return `📩 رسالة جديدة من موقع سوجو منهل\n` + FIELD_LABELS.filter(([k]) => m[k]).map(([k, l]) => `${l}: ${m[k]}`).join('\n');
}
function emailShell(inner, dir = 'rtl') {
  return `<div dir="${dir}" style="font-family:Tahoma,Arial,sans-serif;background:#F4F7FB;padding:24px"><div style="max-width:620px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0">
  <div style="background:#0D3B66;color:#fff;padding:18px 24px;font-size:18px;font-weight:bold">SUZHOU MANHAL · سوجو منهل</div>
  <div style="padding:24px;color:#0B1F33;font-size:15px;line-height:1.8">${inner}</div></div></div>`;
}
function newMessageEmail(m) {
  const rows = FIELD_LABELS.filter(([k]) => m[k]).map(([k, l]) => `<tr><td style="padding:8px 10px;background:#F8FAFC;color:#64748B;width:130px;vertical-align:top">${l}</td><td style="padding:8px 10px;white-space:pre-wrap">${esc(m[k])}</td></tr>`).join('');
  const wa = String(m.phone || '').replace(/[^\d]/g, '');
  const html = emailShell(`<h2 style="margin:0 0 14px;color:#0D3B66">رسالة جديدة من الموقع</h2><table style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0">${rows}</table>
    <p style="margin-top:18px">${wa ? `<a href="https://wa.me/${wa}" style="background:#25D366;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">رد عبر واتساب</a> ` : ''}
    ${m.email ? `<a href="mailto:${esc(m.email)}" style="background:#0D3B66;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">رد بالبريد</a>` : ''}</p>
    <p style="color:#64748B;font-size:13px">يمكنك إدارة الرسالة وتغيير حالتها من لوحة التحكم ← رسائل العملاء.</p>`);
  return { subject: `رسالة جديدة من الموقع — ${m.name}${m.machine ? ' — ' + m.machine : ''}`, text: messageText(m), html };
}
function signature(lang) {
  const c = readJSON(F.content, {});
  const ct = c.contact || {};
  const name = (c.settings && c.settings.siteName && c.settings.siteName[lang]) || 'Suzhou Manhal';
  const phones = (ct.phones || []).map(p => p.number).join(' | ');
  const mails = (ct.emails || []).map(e => e.value).join(' | ');
  return `\n\n— ${name}\n${phones}${mails ? '\n' + mails : ''}`;
}
function customerEmail(m, subject, text) {
  const lang = normLang(m.lang);
  const full = text + signature(lang);
  return { subject, text: full, html: emailShell(`<div style="white-space:pre-wrap">${esc(full)}</div>`, lang === 'ar' ? 'rtl' : 'ltr') };
}
function fillTemplate(t, m) {
  if (t && typeof t === 'object') t = t[normLang(m.lang)] || t.en || t.ar;
  return String(t || '').replace(/\{(\w+)\}/g, (_, k) => m[k] || (k === 'machine' ? '—' : ''));
}

async function notifyNewMessage(m) {
  const p = getPrivate();
  const delivery = { email: '', whatsapp: '', push: '' };
  let emailOk = false;
  try {
    const mail = newMessageEmail(m);
    await sendMail({ to: p.notifyEmail || p.smtp.user, replyTo: m.email || undefined, ...mail });
    emailOk = true; delivery.email = 'sent';
  } catch (e) { delivery.email = 'failed: ' + e.message; }
  const mode = p.whatsapp.mode;
  if (mode === 'always' || (mode === 'fallback' && !emailOk)) {
    try { await sendWhatsApp(messageText(m)); delivery.whatsapp = 'sent'; }
    catch (e) { delivery.whatsapp = 'failed: ' + e.message; }
  } else delivery.whatsapp = mode === 'off' ? 'off' : 'not needed';
  try {
    const r = await pushAll({ title: 'رسالة جديدة — ' + m.name, body: [m.machine, m.message].filter(Boolean).join(' • ').slice(0, 160), url: '/admin/#messages/' + m.id, tag: m.id });
    delivery.push = `${r.sent}/${r.total}`;
  } catch (e) { delivery.push = 'failed: ' + e.message; }
  updateMessage(m.id, x => { x.delivery = delivery; });
}
function updateMessage(id, fn) {
  const list = readJSON(F.messages, []);
  const it = list.find(x => x.id === id);
  if (it) { fn(it); writeJSON(F.messages, list); }
  return it;
}

/* ================= visitor statistics ================= */
const TZ_COUNTRY = { 'Asia/Riyadh': 'sa', 'Asia/Dubai': 'ae', 'Asia/Qatar': 'qa', 'Asia/Kuwait': 'kw', 'Asia/Muscat': 'om', 'Asia/Bahrain': 'bh', 'Asia/Baghdad': 'iq',
  'Africa/Cairo': 'eg', 'Asia/Amman': 'jo', 'Asia/Aden': 'ye', 'Asia/Beirut': 'lb', 'Asia/Damascus': 'sy', 'Asia/Gaza': 'ps', 'Asia/Hebron': 'ps', 'Africa/Tripoli': 'ly',
  'Africa/Tunis': 'tn', 'Africa/Algiers': 'dz', 'Africa/Casablanca': 'ma', 'Africa/Khartoum': 'sd', 'Africa/Mogadishu': 'so', 'Africa/Djibouti': 'dj', 'Africa/Nouakchott': 'mr',
  'Europe/Istanbul': 'tr', 'Asia/Tehran': 'ir', 'Asia/Karachi': 'pk', 'Africa/Addis_Ababa': 'et', 'Africa/Nairobi': 'ke', 'Africa/Lagos': 'ng', 'Asia/Shanghai': 'cn',
  'Asia/Hong_Kong': 'hk', 'Asia/Kolkata': 'in', 'Asia/Calcutta': 'in', 'Europe/London': 'gb', 'Europe/Berlin': 'de', 'Europe/Paris': 'fr', 'Europe/Madrid': 'es',
  'Europe/Rome': 'it', 'Europe/Moscow': 'ru', 'America/New_York': 'us', 'America/Chicago': 'us', 'America/Los_Angeles': 'us', 'America/Toronto': 'ca', 'Asia/Jakarta': 'id',
  'Asia/Kuala_Lumpur': 'my', 'Asia/Singapore': 'sg', 'Australia/Sydney': 'au' };
const STAT_SALT = crypto.randomBytes(16).toString('hex'); // per server start: daily ids cannot be linked across restarts
let stats = readJSON(F.stats, null) || { days: {}, pages: {}, machines: {}, countries: {}, langs: {}, devices: {}, refs: {} };
let statsDirty = false;
const todayKey = () => new Date().toISOString().slice(0, 10);
const bump = (obj, k, by = 1) => { if (!k) return; obj[k] = (obj[k] || 0) + by; };
function trackVisit(b) {
  const day = todayKey();
  const d = stats.days[day] || (stats.days[day] = { v: 0, u: 0, uh: [] });
  d.v++;
  const vid = clipLine(b.v, 40);
  if (vid) {
    const h = crypto.createHash('sha256').update(vid + day + STAT_SALT).digest('hex').slice(0, 12);
    if (!d.uh.includes(h)) { d.uh.push(h); d.u++; if (d.uh.length > 20000) d.uh.shift(); }
  }
  const p = String(b.p || '/');
  if (/^\/[a-z0-9\/_-]{0,80}$/i.test(p) || /^\/machine\/.+/.test(p)) bump(stats.pages, p.replace(/^\/machine\/.+/, '/machine').replace(/^\/page\/.+/, '/page'));
  const mid = clipLine(b.m, 80);
  if (mid && /^[\w-]+$/.test(mid)) bump(stats.machines, mid);
  bump(stats.countries, TZ_COUNTRY[clipLine(b.tz, 60)] || 'other');
  bump(stats.langs, ['ar', 'en', 'zh'].includes(b.l) ? b.l : 'other');
  bump(stats.devices, b.d === 'm' ? 'mobile' : 'desktop');
  const ref = clipLine(b.r, 100).toLowerCase();
  if (ref && /^[a-z0-9.-]+$/.test(ref)) bump(stats.refs, ref);
  statsDirty = true;
}
function saveStats() {
  if (!statsDirty) return;
  // keep 400 days; old days drop their visitor hashes
  const keys = Object.keys(stats.days).sort();
  keys.slice(0, -400).forEach(k => delete stats.days[k]);
  const today = todayKey();
  keys.forEach(k => { if (k !== today && stats.days[k] && stats.days[k].uh && stats.days[k].uh.length) stats.days[k].uh = []; });
  try { writeJSON(F.stats, stats); statsDirty = false; } catch (e) { console.error('stats save failed', e.message); }
}
setInterval(saveStats, 20000).unref();
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => { saveStats(); process.exit(0); }));
function statsSummary(daysBack = 30) {
  const out = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const r = stats.days[d] || { v: 0, u: 0 };
    out.push({ date: d, v: r.v || 0, u: r.u || 0 });
  }
  const top = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
  const sum = a => a.reduce((s, x) => s + x, 0);
  const today = out[out.length - 1];
  return {
    days: out,
    totals: { v: sum(out.map(x => x.v)), u: sum(out.map(x => x.u)), vToday: today.v, uToday: today.u, allTime: sum(Object.values(stats.days).map(x => x.v || 0)) },
    pages: top(stats.pages, 10), machines: top(stats.machines, 10), countries: top(stats.countries, 12),
    langs: top(stats.langs, 4), devices: top(stats.devices, 2), refs: top(stats.refs, 10)
  };
}

/* ================= http helpers ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg'
};
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}
function serveFile(res, file, cache, extra = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': cache ? 'public, max-age=604800' : 'no-cache', ...extra
    });
    fs.createReadStream(file).pipe(res);
  });
}
function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) || p === base ? p : null;
}
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const clipLine = (v, n) => clip(String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' '), n);
const clipText = (v, n) => clip(String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''), n);
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

function organizationLd(content, origin) {
  const s = content.settings || {}, ct = content.contact || {};
  // only real profile links (not bare platform home pages) go into sameAs
  const sameAs = (content.socials || []).filter(x => x.show && /^https?:\/\/[^/]+\/[^/?#]+/.test(x.url || '') && !/wa\.me|mailto:/.test(x.url)).map(x => x.url);
  const phone = (ct.phones || [])[0];
  return {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: (s.siteName && s.siteName.en) || 'Suzhou Manhal', alternateName: [s.siteName && s.siteName.ar, s.siteName && s.siteName.zh].filter(Boolean),
    url: origin + '/', logo: origin + (s.logo || '/assets/img/logo-mark.png'),
    description: (s.seoDescription && s.seoDescription.en) || undefined,
    email: ((ct.emails || [])[0] || {}).value || undefined,
    contactPoint: phone ? [{ '@type': 'ContactPoint', telephone: String(phone.number).replace(/\s/g, ''), contactType: 'sales', availableLanguage: ['Arabic', 'English', 'Chinese'] }] : undefined,
    areaServed: (content.markets || []).map(m => m.name && m.name.en).filter(Boolean),
    sameAs: sameAs.length ? sameAs : undefined
  };
}
function renderIndex(res, req) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const content = readJSON(F.content, {});
  const s = content.settings || {};
  const lang = normLang(s.defaultLang);
  const title = (s.seoTitle && s.seoTitle[lang]) || (s.siteName && s.siteName[lang]) || 'Suzhou Manhal';
  const desc = (s.seoDescription && s.seoDescription[lang]) || '';
  const host = String((req && req.headers.host) || 'localhost').replace(/[^\w.:-]/g, '');
  const origin = (req && isHttps(req) ? 'https://' : 'http://') + host;
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  const safeJson = o => JSON.stringify(o).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
  const payload = safeJson(content);
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
    .replace(/{{LANG}}/g, lang === 'zh' ? 'zh-CN' : lang).replace(/{{DIR}}/g, lang === 'ar' ? 'rtl' : 'ltr')
    .replace(/{{TITLE}}/g, esc(title)).replace(/{{DESCRIPTION}}/g, esc(desc))
    .replace(/{{FAVICON}}/g, esc(s.favicon || s.logo || '/assets/img/logo-mark.png'))
    .replace(/{{OGIMAGE}}/g, esc(origin + '/assets/img/icon-512.png'))
    .replace(/{{CANONICAL}}/g, esc(origin + '/'))
    .replace('{{LDJSON}}', () => safeJson(organizationLd(content, origin)))
    .replace(/{{NONCE}}/g, nonce)
    .replace('{{DATA}}', () => payload);
  send(res, 200, html, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache', 'Content-Security-Policy': cspSite(nonce, req && isHttps(req)) });
}
function maskPrivate(p) {
  const c = JSON.parse(JSON.stringify(p));
  c.smtp.pass = c.smtp.pass ? '********' : '';
  c.whatsapp.apikey = c.whatsapp.apikey ? '********' : '';
  c.mailConfigured = mailConfigured(p);
  return c;
}

/* ================= API ================= */
async function api(req, res, pathname) {
  const method = req.method;

  if (pathname === '/api/content' && method === 'GET') return send(res, 200, readJSON(F.content, {}), undefined, { 'Cache-Control': 'no-cache' });

  if ((pathname === '/api/message' || pathname === '/api/inquiry') && method === 'POST') {
    if (limited('msg:' + ip(req), 10, 3600e3) || limited('msg:all', 300, 3600e3)) return send(res, 429, { error: 'Too many requests' });
    const b = await readBody(req, 30e3);
    if (b.website) return send(res, 200, { ok: true }); // honeypot
    const m = {
      id: crypto.randomBytes(6).toString('hex'), date: new Date().toISOString(), status: 'new', read: false,
      name: clipLine(b.name, 120), phone: clipLine(b.phone, 40), email: clipLine(b.email, 120), country: clipLine(b.country, 80),
      company: clipLine(b.company, 120), machine: clipLine(b.machine, 200), message: clipText(b.message, 4000), lang: normLang(b.lang),
      replies: [], delivery: { email: 'pending', whatsapp: 'pending', push: 'pending' }
    };
    if (m.email && !EMAIL_RE.test(m.email)) m.email = '';
    if (!m.name || (!m.phone && !m.email)) return send(res, 400, { error: 'Name and phone or email are required' });
    const list = readJSON(F.messages, []);
    list.unshift(m);
    writeJSON(F.messages, list.slice(0, 10000));
    send(res, 200, { ok: true });
    notifyNewMessage(m).catch(e => console.error('notify error', e));
    return;
  }

  if (pathname === '/api/track' && method === 'POST') {
    if (limited('trk:' + ip(req), 120, 60e3)) return send(res, 204, '');
    const b = await readBody(req, 2e3);
    if (!/bot|crawl|spider|slurp|preview|headless|lighthouse/i.test(req.headers['user-agent'] || '')) trackVisit(b || {});
    return send(res, 204, '');
  }

  if (pathname === '/api/login' && method === 'POST') {
    const who = ip(req);
    if (blocked('fail:' + who, 6) || blocked('fail:all', 60)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const b = await readBody(req, 5e3);
    if (typeof b.password !== 'string' || !checkPassword(b.password)) {
      limited('fail:' + who, 6, 15 * 60e3); limited('fail:all', 60, 15 * 60e3);
      console.warn(`[security] failed admin login from ${who} at ${new Date().toISOString()}`);
      await sleep(600);
      return send(res, 401, { error: 'Wrong password' });
    }
    const t = newSession();
    return send(res, 200, { ok: true, isDefault: !!auth.isDefault }, undefined,
      { 'Set-Cookie': `sm_session=${t}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${isHttps(req) ? '; Secure' : ''}` });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    const t = getCookie(req, 'sm_session'); if (t) sessions.delete(t);
    return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': `sm_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}` });
  }
  if (pathname === '/api/session' && method === 'GET') return send(res, 200, { authed: isAuthed(req), isDefault: !!auth.isDefault });

  if (!pathname.startsWith('/api/admin/')) return send(res, 404, { error: 'Not found' });
  if (!isAuthed(req)) return send(res, 401, { error: 'Unauthorized' });
  if (method !== 'GET' && req.headers['x-requested-with'] !== 'SMAdmin') return send(res, 403, { error: 'Forbidden' });

  // ---- content
  if (pathname === '/api/admin/content' && method === 'PUT') {
    const b = await readBody(req, 8e6);
    if (!b || typeof b !== 'object' || Array.isArray(b) || !b.settings) return send(res, 400, { error: 'Invalid content' });
    try {
      fs.copyFileSync(F.content, path.join(BACKUPS, `content-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const bk = fs.readdirSync(BACKUPS).filter(f => f.endsWith('.json')).sort();
      while (bk.length > 30) fs.unlinkSync(path.join(BACKUPS, bk.shift()));
    } catch { /* ignore */ }
    writeJSON(F.content, b);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/reset' && method === 'POST') {
    if (!fs.existsSync(F.seed)) return send(res, 404, { error: 'No seed file' });
    fs.copyFileSync(F.content, path.join(BACKUPS, `content-before-reset-${Date.now()}.json`));
    fs.copyFileSync(F.seed, F.content);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/upload' && method === 'POST') {
    const b = await readBody(req, 25e6);
    const m = /^data:(image\/(png|jpeg|webp|gif)|application\/pdf|video\/mp4);base64,(.+)$/.exec(b.data || '');
    if (!m) return send(res, 400, { error: 'Only PNG, JPG, WEBP, GIF, PDF or MP4 files are allowed' });
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf', 'video/mp4': '.mp4' }[m[1]];
    const base = clip(b.name, 40).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
    const fname = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${base}${ext}`;
    const buf = Buffer.from(m[3], 'base64');
    const sig = buf.subarray(0, 12);
    const okType = {
      'image/png': sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      'image/jpeg': sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff,
      'image/gif': sig.subarray(0, 4).toString('latin1') === 'GIF8',
      'image/webp': sig.subarray(0, 4).toString('latin1') === 'RIFF' && sig.subarray(8, 12).toString('latin1') === 'WEBP',
      'application/pdf': sig.subarray(0, 5).toString('latin1') === '%PDF-',
      'video/mp4': sig.subarray(4, 8).toString('latin1') === 'ftyp'
    }[m[1]];
    if (!okType) return send(res, 400, { error: 'File content does not match its type' });
    fs.writeFileSync(path.join(UPLOADS, fname), buf);
    return send(res, 200, { ok: true, url: '/uploads/' + fname });
  }

  // ---- messages
  if (pathname === '/api/admin/messages' && method === 'GET') return send(res, 200, readJSON(F.messages, []));
  if (pathname === '/api/admin/messages/summary' && method === 'GET') {
    const list = readJSON(F.messages, []);
    return send(res, 200, { total: list.length, unread: list.filter(x => !x.read).length, new: list.filter(x => x.status === 'new').length, latest: list[0] ? { id: list[0].id, name: list[0].name, machine: list[0].machine } : null });
  }
  let mm = /^\/api\/admin\/messages\/([a-f0-9]+)(\/reply)?$/.exec(pathname);
  if (mm && !mm[2] && method === 'PATCH') {
    const b = await readBody(req, 5e3);
    let completedNow = false;
    const it = updateMessage(mm[1], x => {
      if (STATUSES.includes(b.status) && x.status !== b.status) { completedNow = b.status === 'completed'; x.status = b.status; }
      if (typeof b.read === 'boolean') x.read = b.read;
      if (typeof b.note === 'string') x.note = clip(b.note, 3000);
    });
    if (!it) return send(res, 404, { error: 'Not found' });
    let completion = null;
    if (completedNow) {
      const p = getPrivate();
      if (p.completionEmail.enabled && it.email) {
        const lang = normLang(it.lang);
        try {
          await sendMail({ to: it.email, cc: p.notifyEmail ? [p.notifyEmail] : [], ...customerEmail(it, fillTemplate(p.completionEmail.subject[lang] || p.completionEmail.subject.en, it), fillTemplate(p.completionEmail.body[lang] || p.completionEmail.body.en, it)) });
          completion = 'sent';
        } catch (e) { completion = 'failed: ' + e.message; }
        updateMessage(it.id, x => { x.replies = x.replies || []; x.replies.push({ date: new Date().toISOString(), via: 'completion-email', text: fillTemplate(p.completionEmail.body[lang] || p.completionEmail.body.en, it), ok: completion === 'sent', error: completion === 'sent' ? undefined : completion }); });
      } else completion = it.email ? 'disabled' : 'no-email';
    }
    return send(res, 200, { ok: true, completion });
  }
  if (mm && mm[2] && method === 'POST') {
    const b = await readBody(req, 20e3);
    const text = clip(b.text, 8000);
    if (!text) return send(res, 400, { error: 'Reply text is required' });
    const list = readJSON(F.messages, []);
    const it = list.find(x => x.id === mm[1]);
    if (!it) return send(res, 404, { error: 'Not found' });
    const via = b.via === 'whatsapp' || b.via === 'note' ? b.via : 'email';
    let ok = true, error;
    if (via === 'email') {
      if (!it.email) return send(res, 400, { error: 'This customer did not provide an email' });
      const subject = clip(b.subject, 200) || ({ en: 'Reply from Suzhou Manhal', zh: '苏州曼哈尔回复' }[it.lang] || 'رد من سوجو منهل') + (it.machine ? ' — ' + it.machine : '');
      try { await sendMail({ to: it.email, replyTo: getPrivate().notifyEmail, ...customerEmail(it, subject, text) }); }
      catch (e) { ok = false; error = e.message; }
    }
    updateMessage(it.id, x => {
      x.replies = x.replies || [];
      x.replies.push({ date: new Date().toISOString(), via, text, ok, error });
      if (ok && via !== 'note' && x.status === 'new') x.status = 'replied';
      x.read = true;
    });
    return ok ? send(res, 200, { ok: true }) : send(res, 502, { error: 'Email failed: ' + error });
  }
  if (mm && !mm[2] && method === 'DELETE') {
    writeJSON(F.messages, readJSON(F.messages, []).filter(x => x.id !== mm[1]));
    return send(res, 200, { ok: true });
  }

  // ---- visitor statistics
  if (pathname === '/api/admin/stats' && method === 'GET') return send(res, 200, statsSummary(30));
  if (pathname === '/api/admin/stats' && method === 'DELETE') { stats = { days: {}, pages: {}, machines: {}, countries: {}, langs: {}, devices: {}, refs: {} }; statsDirty = true; saveStats(); return send(res, 200, { ok: true }); }

  // ---- operations: suppliers, shipments, offer comparisons (admin only)
  if (pathname === '/api/admin/ops' && method === 'GET') {
    const o = readJSON(F.ops, {});
    return send(res, 200, { suppliers: o.suppliers || [], shipments: o.shipments || [], comparisons: o.comparisons || [] });
  }
  if (pathname === '/api/admin/ops' && method === 'PUT') {
    const b = await readBody(req, 3e6);
    const okArr = a => Array.isArray(a) && a.length <= 5000 && a.every(x => x && typeof x === 'object' && !Array.isArray(x));
    if (!b || !okArr(b.suppliers || []) || !okArr(b.shipments || []) || !okArr(b.comparisons || [])) return send(res, 400, { error: 'Invalid data' });
    try { if (fs.existsSync(F.ops)) fs.copyFileSync(F.ops, path.join(BACKUPS, `ops-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)); } catch { /* ignore */ }
    try { const bk = fs.readdirSync(BACKUPS).filter(x => x.startsWith('ops-')).sort(); while (bk.length > 20) fs.unlinkSync(path.join(BACKUPS, bk.shift())); } catch { /* ignore */ }
    writeJSON(F.ops, { suppliers: b.suppliers || [], shipments: b.shipments || [], comparisons: b.comparisons || [] });
    return send(res, 200, { ok: true });
  }

  // ---- private settings (email / whatsapp)
  if (pathname === '/api/admin/private' && method === 'GET') return send(res, 200, maskPrivate(getPrivate()));
  if (pathname === '/api/admin/private' && method === 'PUT') {
    const b = await readBody(req, 50e3);
    const cur = getPrivate();
    const next = deepMerge(cur, {
      notifyEmail: clip(b.notifyEmail, 200),
      smtp: { host: clip(b.smtp && b.smtp.host, 200), port: Number(b.smtp && b.smtp.port) || 465, user: clip(b.smtp && b.smtp.user, 200), fromName: clip(b.smtp && b.smtp.fromName, 100),
        pass: b.smtp && b.smtp.pass === '********' ? cur.smtp.pass : clip(b.smtp && b.smtp.pass, 200).replace(/\s+/g, '') },
      whatsapp: { mode: ['always', 'fallback', 'off'].includes(b.whatsapp && b.whatsapp.mode) ? b.whatsapp.mode : 'fallback', phone: clip(b.whatsapp && b.whatsapp.phone, 30),
        apikey: b.whatsapp && b.whatsapp.apikey === '********' ? cur.whatsapp.apikey : clip(b.whatsapp && b.whatsapp.apikey, 100) },
      completionEmail: b.completionEmail ? {
        enabled: !!b.completionEmail.enabled,
        subject: { ar: clip(b.completionEmail.subject && b.completionEmail.subject.ar, 200), en: clip(b.completionEmail.subject && b.completionEmail.subject.en, 200), zh: clip(b.completionEmail.subject && b.completionEmail.subject.zh, 200) },
        body: { ar: clip(b.completionEmail.body && b.completionEmail.body.ar, 4000), en: clip(b.completionEmail.body && b.completionEmail.body.en, 4000), zh: clip(b.completionEmail.body && b.completionEmail.body.zh, 4000) }
      } : cur.completionEmail
    });
    if ((next.notifyEmail && !EMAIL_RE.test(next.notifyEmail)) || (next.smtp.user && !EMAIL_RE.test(next.smtp.user))) return send(res, 400, { error: 'Invalid email address' });
    if (next.smtp.host && !/^[a-z0-9.-]+$/i.test(next.smtp.host)) return send(res, 400, { error: 'Invalid SMTP host' });
    next.smtp.fromName = clipLine(next.smtp.fromName, 100);
    writeJSON(F.private, next);
    return send(res, 200, maskPrivate(next));
  }
  if (pathname === '/api/admin/test-email' && method === 'POST') {
    const p = getPrivate();
    try {
      await sendMail({ to: p.notifyEmail || p.smtp.user, subject: 'اختبار البريد — موقع سوجو منهل', text: 'تم إعداد البريد بنجاح ✅ ستصلك رسائل العملاء على هذا البريد.', html: emailShell('<b>تم إعداد البريد بنجاح ✅</b><br>ستصلك رسائل العملاء على هذا البريد.') });
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (pathname === '/api/admin/test-whatsapp' && method === 'POST') {
    try { await sendWhatsApp('✅ اختبار إشعارات واتساب — موقع سوجو منهل'); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 502, { error: e.message }); }
  }

  // ---- web push
  if (pathname === '/api/admin/push/key' && method === 'GET') return send(res, 200, { publicKey: getVapid().publicKey });
  if (pathname === '/api/admin/push/subscribe' && method === 'POST') {
    const b = await readBody(req, 10e3);
    const s = b.subscription;
    if (!s || !/^https:\/\//.test(s.endpoint || '') || !s.keys || !s.keys.p256dh || !s.keys.auth) return send(res, 400, { error: 'Invalid subscription' });
    const subs = readJSON(F.subs, []).filter(x => x.endpoint !== s.endpoint);
    subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, device: clip(b.device, 120), date: new Date().toISOString() });
    writeJSON(F.subs, subs);
    return send(res, 200, { ok: true, devices: subs.length });
  }
  if (pathname === '/api/admin/push/unsubscribe' && method === 'POST') {
    const b = await readBody(req, 10e3);
    writeJSON(F.subs, readJSON(F.subs, []).filter(x => x.endpoint !== b.endpoint));
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/push/devices' && method === 'GET') {
    return send(res, 200, readJSON(F.subs, []).map(s => ({ device: s.device, date: s.date, endpoint: s.endpoint.slice(0, 60) + '…' })));
  }
  if (pathname === '/api/admin/push/test' && method === 'POST') {
    const r = await pushAll({ title: 'سوجو منهل', body: 'اختبار الإشعارات ✅ سيصلك تنبيه هنا عند كل رسالة جديدة', url: '/admin/#messages' });
    return send(res, 200, r);
  }

  // ---- machine translation (MyMemory free API)
  if (pathname === '/api/admin/translate' && method === 'POST') {
    const b = await readBody(req, 20e3);
    const code = { ar: 'ar', en: 'en', zh: 'zh-CN' };
    if (!code[b.from] || !code[b.to] || b.from === b.to) return send(res, 400, { error: 'Invalid languages' });
    const text = clip(b.text, 5000);
    if (!text) return send(res, 200, { text: '' });
    try { return send(res, 200, { text: await translate(text, code[b.from], code[b.to]) }); }
    catch (e) { return send(res, 502, { error: 'Translation failed: ' + e.message }); }
  }

  // ---- password
  if (pathname === '/api/admin/password' && method === 'POST') {
    const b = await readBody(req, 5e3);
    if (!checkPassword(b.current || '')) return send(res, 401, { error: 'Current password is wrong' });
    if (!b.next || String(b.next).length < 8) return send(res, 400, { error: 'New password must be at least 8 characters' });
    const salt = crypto.randomBytes(16).toString('hex');
    auth = { salt, hash: hashPassword(b.next, salt), isDefault: false };
    writeJSON(F.auth, auth);
    const current = getCookie(req, 'sm_session');
    for (const k of [...sessions.keys()]) if (k !== current) sessions.delete(k);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Not found' });
}

/* ================= server ================= */
function cspSite(nonce, https) {
  return ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com`, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com", "img-src 'self' data: blob: https:", "media-src 'self' blob: https:", "connect-src 'self'",
    "frame-src https://www.google.com https://maps.google.com https://www.youtube-nocookie.com", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]
    .concat(https ? ['upgrade-insecure-requests'] : []).join('; ');
}
const CSP_ADMIN = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com", "img-src 'self' data: blob: https:", "media-src 'self' blob:", "connect-src 'self'",
  "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { return send(res, 400, 'Bad request', 'text/plain'); }
  if (pathname.includes('\0')) return send(res, 400, 'Bad request', 'text/plain');
  try {
    if (pathname.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
      // writes must be JSON: a cross-site HTML form cannot send application/json without a CORS preflight
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.method !== 'DELETE' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON required' });
      return await api(req, res, pathname);
    }
    if (pathname === '/' || pathname === '/index.html') return renderIndex(res, req);
    if (pathname === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
    if (pathname === '/admin/') return serveFile(res, path.join(PUB, 'admin.html'), false, { 'X-Robots-Tag': 'noindex', 'Content-Security-Policy': CSP_ADMIN, 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' });
    if (pathname === '/admin/sw.js') return serveFile(res, path.join(PUB, 'admin-sw.js'), false, { 'Service-Worker-Allowed': '/admin/' });
    if (pathname === '/admin/manifest.webmanifest') return serveFile(res, path.join(PUB, 'admin-manifest.webmanifest'), false);
    if (pathname === '/robots.txt') {
      const o = (isHttps(req) ? 'https://' : 'http://') + String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, '');
      return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${o}/sitemap.xml\n`, 'text/plain; charset=utf-8');
    }
    if (pathname === '/sitemap.xml') {
      const o = (isHttps(req) ? 'https://' : 'http://') + String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, '');
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${o}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>\n`, 'application/xml; charset=utf-8');
    }
    if (pathname.startsWith('/uploads/')) {
      const f = safeJoin(UPLOADS, pathname.slice('/uploads/'.length));
      return f ? serveFile(res, f, true, /\.pdf$/i.test(f) ? {} : { 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; sandbox" }) : send(res, 403, 'Forbidden', 'text/plain');
    }
    const f = safeJoin(PUB, pathname);
    if (!f) return send(res, 403, 'Forbidden', 'text/plain');
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return serveFile(res, f, pathname.startsWith('/assets/img/'));
    return renderIndex(res, req);
  } catch (e) {
    const code = e.code === 413 ? 413 : e.code === 400 ? 400 : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) send(res, code, { error: code === 500 ? 'Server error' : e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    getVapid();
    console.log(`\n  Suzhou Manhal website running → http://localhost:${PORT}`);
    console.log(`  Admin: triple-click the small mark at the bottom of the site, or open /admin/`);
    if (auth.isDefault) console.log(`  ⚠ Default admin password is active — change it from Admin › Password.`);
    if (!mailConfigured(getPrivate())) console.log(`  ✉ Email is not configured yet — Admin › Email & Notifications.`);
  });
}
module.exports = { smtpSend, encryptPush, buildMime };
