/* Suzhou Manhal — Admin panel (schema-driven content editor) */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  };
  const ic = cls => h('i', { class: cls, 'aria-hidden': 'true' });
  const uid = p => (p || 'id') + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const clone = o => JSON.parse(JSON.stringify(o));
  const ar = v => (v == null ? '' : typeof v === 'string' ? v : v.ar || v.en || '');

  let content = null;
  let messages = [];
  let dirty = false;
  let current = 'dashboard';
  let editing = null; // {sectionId, index}
  let isDefaultPw = false;

  /* ---------- API ---------- */
  async function api(url, opts = {}) {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SMAdmin' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    });
    let data = {};
    try { data = await r.json(); } catch { /* ignore */ }
    if (r.status === 401 && url.startsWith('/api/admin/')) { showLogin(); throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً'); }
    if (!r.ok) throw new Error(data.error || 'حدث خطأ');
    return data;
  }
  function toast(msg, type = 'ok') {
    const el = h('div', { class: 'toast ' + type }, ic(type === 'ok' ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation'), msg);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 3200);
  }
  function setDirty(v = true) {
    dirty = v;
    $('#dirty').hidden = !(v || privDirty);
    $('#saveBtn').disabled = !(v || privDirty);
  }
  // email & notification settings are saved separately from the site content
  let privDirty = false, privSaver = null;
  // private operations data (suppliers, shipments, offer comparisons) — saved to its own file, never public
  let ops = { suppliers: [], shipments: [], comparisons: [] }, opsSnap = JSON.stringify(ops), contentSnap = '';
  const storeOf = S => (S.store === 'ops' ? ops : content);
  function markPrivDirty() { privDirty = true; $('#dirty').hidden = false; $('#saveBtn').disabled = false; }
  function clearPrivDirty() { privDirty = false; setDirty(dirty); }
  function trErr(msg) {
    const m = String(msg || '');
    if (/BadCredentials|535/.test(m)) return 'جوجل رفض الدخول: كلمة مرور التطبيقات غير صحيحة أو لا تخص حساب الإرسال المكتوب. تأكد أن "حساب Gmail المرسِل" هو نفس الحساب الذي أنشأت منه كلمة المرور.';
    if (/Invalid email address/.test(m)) return 'البريد الإلكتروني المكتوب غير صحيح، راجع الخانات.';
    if (/Invalid SMTP host/.test(m)) return 'عنوان خادم SMTP غير صحيح (الصحيح لجيميل: smtp.gmail.com).';
    if (/not configured/.test(m) && /SMTP|Email/.test(m)) return 'البريد غير مُفعّل: أدخل حساب الإرسال وكلمة مرور التطبيقات ثم احفظ.';
    if (/timeout|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(m)) return 'تعذر الاتصال بخادم البريد. تأكد من اتصال الإنترنت ومن عنوان الخادم والمنفذ (465).';
    return m;
  }

  /* ---------- upload (with client-side image optimization) ---------- */
  function readAsDataURL(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  async function optimizeImage(file, maxSide = 1800) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return readAsDataURL(file);
    const url = await readAsDataURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 400e3) return url;
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL('image/webp', 0.86);
    if (!out.startsWith('data:image/webp')) out = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86);
    return out;
  }
  async function upload(file) {
    if (file.size > 20e6) throw new Error('حجم الملف أكبر من 20 ميجابايت');
    const data = await optimizeImage(file);
    const r = await api('/api/admin/upload', { method: 'POST', body: { name: file.name, data } });
    return r.url;
  }
  function pickFiles(accept, multiple) {
    return new Promise(res => {
      const i = h('input', { type: 'file', accept, multiple: multiple || null });
      i.onchange = () => res([...i.files]);
      i.click();
    });
  }

  /* ---------- icon list ---------- */
  const ICONS = ['industry', 'gears', 'gear', 'screwdriver-wrench', 'bottle-water', 'cow', 'cookie-bite', 'seedling', 'cubes', 'mug-hot', 'box', 'print', 'boxes-stacked', 'pump-soap', 'trowel-bricks', 'recycle', 'wheat-awn', 'oil-can', 'fire', 'bolt', 'solar-panel', 'droplet', 'flask', 'pills', 'shirt', 'car', 'tractor', 'tree', 'fish', 'egg', 'bread-slice', 'ice-cream', 'candy-cane', 'jar', 'wine-bottle', 'warehouse', 'truck-fast', 'ship', 'plane-departure', 'anchor', 'globe', 'earth-asia', 'handshake', 'shield-halved', 'certificate', 'clipboard-check', 'chart-line', 'magnifying-glass-chart', 'file-signature', 'comments', 'headset', 'user-gear', 'people-group', 'language', 'location-dot', 'hand-holding-dollar', 'medal', 'eye', 'bullseye', 'star', 'award', 'circle-check', 'layer-group', 'microchip', 'robot', 'temperature-high', 'gauge-high', 'weight-hanging', 'ruler-combined', 'helmet-safety', 'hammer', 'wrench', 'building', 'city', 'leaf', 'lightbulb', 'rocket', 'phone', 'envelope', 'clock'];
  const BRANDS = ['whatsapp', 'instagram', 'facebook-f', 'youtube', 'tiktok', 'linkedin-in', 'x-twitter', 'telegram', 'snapchat', 'weixin', 'pinterest', 'threads', 'google'];
  const PLATFORMS = [
    ['whatsapp', 'واتساب', 'fa-brands fa-whatsapp'], ['instagram', 'انستجرام', 'fa-brands fa-instagram'], ['facebook', 'فيسبوك', 'fa-brands fa-facebook-f'],
    ['youtube', 'يوتيوب', 'fa-brands fa-youtube'], ['tiktok', 'تيك توك', 'fa-brands fa-tiktok'], ['linkedin', 'لينكدإن', 'fa-brands fa-linkedin-in'],
    ['x', 'X (تويتر)', 'fa-brands fa-x-twitter'], ['telegram', 'تيليجرام', 'fa-brands fa-telegram'], ['snapchat', 'سناب شات', 'fa-brands fa-snapchat'],
    ['wechat', 'وي شات', 'fa-brands fa-weixin'], ['website', 'موقع إلكتروني', 'fa-solid fa-globe'], ['email', 'بريد', 'fa-solid fa-envelope'], ['other', 'أخرى', 'fa-solid fa-link']
  ];

  /* ---------- field renderers ---------- */
  function ensureBi(obj, key) {
    const v = obj[key];
    if (v == null || typeof v !== 'object') obj[key] = { ar: v == null ? '' : String(v), en: v == null ? '' : String(v), zh: v == null ? '' : String(v) };
    else if (obj[key].zh == null) obj[key].zh = '';
    return obj[key];
  }
  function wrap(f, control) {
    return h('div', { class: 'f' + (f.full || ['bitext', 'gallery', 'list', 'image'].includes(f.type) ? ' full' : '') },
      f.type === 'bool' ? null : h('label', {}, f.label), control, f.hint ? h('div', { class: 'hint' }, f.hint) : null);
  }
  function field(f, obj, onChange) {
    const changed = () => { if (!f.noDirty) setDirty(); onChange && onChange(); };
    const key = f.key;
    switch (f.type) {
      case 'bi':
      case 'bitext': {
        const v = ensureBi(obj, key);
        const els = {};
        const mk = (lang) => {
          const attrs = { class: 'inp', dir: lang === 'ar' ? 'rtl' : 'ltr', lang: lang === 'zh' ? 'zh-CN' : lang, placeholder: { ar: 'بالعربية', en: 'In English', zh: '中文' }[lang] };
          const el = f.type === 'bi' ? h('input', attrs) : h('textarea', attrs);
          el.value = v[lang] || '';
          el.oninput = () => { v[lang] = el.value; changed(); };
          els[lang] = el;
          return h('div', {}, h('span', { class: 'lang-tag' }, { ar: 'عربي', en: 'EN', zh: '中文' }[lang]), el);
        };
        const tr = h('button', { type: 'button', class: 'tr-btn', title: 'ترجمة تلقائية للخانات الفارغة', onclick: async () => {
          tr.classList.add('busy');
          try { const n = await autoTranslateBi(v); ['ar', 'en', 'zh'].forEach(l => { els[l].value = v[l] || ''; }); if (n) { changed(); toast('تمت الترجمة — راجعها ثم احفظ'); } else toast('لا توجد خانات فارغة أو لا يوجد نص للترجمة'); }
          catch (e) { toast(e.message, 'err'); }
          tr.classList.remove('busy');
        } }, ic('fa-solid fa-language'), 'ترجمة');
        return wrap(f, h('div', { class: 'bi bi3' }, mk('ar'), mk('en'), mk('zh'), tr));
      }
      case 'text': case 'url': case 'number': case 'tel': case 'textarea': case 'date': {
        const el = f.type === 'textarea' ? h('textarea', { class: 'inp' }) : h('input', { class: 'inp', type: f.type === 'url' ? 'text' : f.type, dir: f.ltr ? 'ltr' : null, placeholder: f.placeholder || null });
        el.value = obj[key] == null ? '' : obj[key];
        el.oninput = () => { obj[key] = f.type === 'number' ? Number(el.value) : el.value; changed(); };
        return wrap(f, el);
      }
      case 'bool': {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = !!obj[key];
        cb.onchange = () => { obj[key] = cb.checked; changed(); };
        return wrap(f, h('label', { class: 'switch' }, cb, h('span', { class: 'track' }), f.label));
      }
      case 'color': {
        const c = h('input', { type: 'color' }); const t = h('input', { class: 'inp', dir: 'ltr' });
        c.value = t.value = obj[key] || '#000000';
        c.oninput = () => { t.value = obj[key] = c.value; changed(); };
        t.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { c.value = obj[key] = t.value; changed(); } };
        return wrap(f, h('div', { class: 'color-row' }, c, t));
      }
      case 'select': {
        const opts = typeof f.options === 'function' ? f.options() : f.options;
        const s = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v }, l)));
        s.value = obj[key] == null ? '' : obj[key];
        s.onchange = () => { obj[key] = s.value; f.onSelect && f.onSelect(obj, s.value); changed(); };
        return wrap(f, s);
      }
      case 'icon': {
        const prev = h('span', { class: 'icon-prev' }, ic(obj[key] || 'fa-solid fa-circle'));
        const inp = h('input', { class: 'inp', dir: 'ltr', placeholder: 'fa-solid fa-industry' });
        inp.value = obj[key] || '';
        const set = v => { obj[key] = v; inp.value = v; prev.innerHTML = ''; prev.append(ic(v)); changed(); };
        inp.oninput = () => set(inp.value);
        let grid = null;
        const toggle = h('button', { type: 'button', class: 'a-btn a-btn-sm', onclick: () => {
          if (grid) { grid.remove(); grid = null; return; }
          grid = h('div', { class: 'icon-grid' },
            ...ICONS.map(n => h('button', { type: 'button', title: n, onclick: () => set('fa-solid fa-' + n) }, ic('fa-solid fa-' + n))),
            ...BRANDS.map(n => h('button', { type: 'button', title: n, onclick: () => set('fa-brands fa-' + n) }, ic('fa-brands fa-' + n))));
          box.append(grid);
        } }, ic('fa-solid fa-icons'), 'اختر');
        const box = h('div', {}, h('div', { class: 'icon-field' }, prev, inp, toggle));
        return wrap(Object.assign({ hint: 'اختر من القائمة أو اكتب اسم أي أيقونة من موقع fontawesome.com' }, f), box);
      }
      case 'image': case 'file': {
        const isFile = f.type === 'file';
        const prev = h('div', { class: 'img-prev' });
        const inp = h('input', { class: 'inp', dir: 'ltr', placeholder: isFile ? 'رابط الملف أو ارفع ملفاً' : 'رابط الصورة أو ارفع صورة' });
        const render = () => {
          prev.innerHTML = '';
          const v = obj[key];
          if (!v) prev.append(ic(isFile ? 'fa-solid fa-file-arrow-up' : 'fa-regular fa-image'));
          else if (isFile) prev.append(ic(/\.pdf/i.test(v) ? 'fa-solid fa-file-pdf' : /\.mp4/i.test(v) ? 'fa-solid fa-file-video' : 'fa-solid fa-link'));
          else prev.append(h('img', { src: v, alt: '' }));
          inp.value = v || '';
        };
        inp.onchange = () => { obj[key] = inp.value.trim(); render(); changed(); };
        const up = h('button', { type: 'button', class: 'a-btn a-btn-sm a-btn-accent', onclick: async () => {
          const [file] = await pickFiles(f.accept || (isFile ? 'application/pdf,video/mp4' : 'image/png,image/jpeg,image/webp,image/gif'));
          if (!file) return;
          up.classList.add('uploading'); up.lastChild.textContent = 'جارٍ الرفع...';
          try { obj[key] = await upload(file); render(); changed(); toast('تم رفع الملف'); }
          catch (e) { toast(e.message, 'err'); }
          up.classList.remove('uploading'); up.lastChild.textContent = 'رفع';
        } }, ic('fa-solid fa-upload'), h('span', {}, 'رفع'));
        const del = h('button', { type: 'button', class: 'a-btn a-btn-sm a-btn-danger', onclick: () => { obj[key] = ''; render(); changed(); } }, ic('fa-solid fa-trash'), 'إزالة');
        render();
        return wrap(f, h('div', { class: 'img-field' }, prev, h('div', { class: 'img-ctrl' }, inp, h('div', { class: 'row' }, up, del))));
      }
      case 'gallery': {
        if (!Array.isArray(obj[key])) obj[key] = [];
        const arr = obj[key];
        const box = h('div', { class: 'gallery' });
        const render = () => {
          box.innerHTML = '';
          arr.forEach((src, i) => {
            box.append(h('div', { class: 'g-item' }, h('img', { src, alt: '' }), i === 0 ? h('span', { class: 'main-tag' }, 'الرئيسية') : null,
              h('div', { class: 'g-actions' },
                h('button', { type: 'button', title: 'تحريك', onclick: () => { if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; render(); changed(); } } }, ic('fa-solid fa-arrow-right')),
                h('button', { type: 'button', title: 'تحريك', onclick: () => { if (i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; render(); changed(); } } }, ic('fa-solid fa-arrow-left')),
                h('button', { type: 'button', title: 'حذف', onclick: () => { arr.splice(i, 1); render(); changed(); } }, ic('fa-solid fa-trash')))));
          });
          const add = h('div', { class: 'g-add', onclick: async () => {
            const files = await pickFiles('image/png,image/jpeg,image/webp,image/gif', true);
            if (!files.length) return;
            add.innerHTML = '<span><i class="fa-solid fa-spinner fa-spin"></i>جارٍ الرفع...</span>';
            for (const file of files) {
              try { arr.push(await upload(file)); changed(); } catch (e) { toast(e.message, 'err'); }
            }
            render(); toast('تم رفع الصور');
          } }, h('span', {}, ic('fa-solid fa-images'), 'إضافة صور'));
          box.append(add);
        };
        render();
        return wrap(Object.assign({ hint: 'الصورة الأولى هي الصورة الرئيسية. يتم ضغط الصور تلقائياً. يمكنك اختيار عدة صور مرة واحدة.' }, f), box);
      }
      case 'list': {
        if (!Array.isArray(obj[key])) obj[key] = [];
        const arr = obj[key];
        const box = h('div', { class: 'nlist' });
        const render = () => {
          box.innerHTML = '';
          arr.forEach((item, i) => {
            if (typeof item !== 'object' || item === null) arr[i] = item = { value: item };
            box.append(h('div', { class: 'nrow' },
              h('div', { class: 'nrow-head' }, h('b', {}, `${f.itemLabel || 'عنصر'} ${i + 1}`),
                h('div', { class: 'nrow-actions' },
                  h('button', { type: 'button', class: 'a-icon-btn', title: 'لأعلى', disabled: i === 0 || null, onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; render(); changed(); } }, ic('fa-solid fa-arrow-up')),
                  h('button', { type: 'button', class: 'a-icon-btn', title: 'لأسفل', disabled: i === arr.length - 1 || null, onclick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; render(); changed(); } }, ic('fa-solid fa-arrow-down')),
                  h('button', { type: 'button', class: 'a-icon-btn danger', title: 'حذف', onclick: () => { if (confirm('حذف هذا العنصر؟')) { arr.splice(i, 1); render(); changed(); } } }, ic('fa-solid fa-trash')))),
              h('div', { class: 'fields' }, ...f.fields.map(sf => field(sf, item, () => { if (sf.rerender) render(); })))));
          });
          box.append(h('button', { type: 'button', class: 'a-btn', onclick: () => { arr.push(f.newItem ? f.newItem() : {}); render(); changed(); } }, ic('fa-solid fa-plus'), f.addLabel || 'إضافة'));
        };
        render();
        return wrap(f, box);
      }
      default: return h('div');
    }
  }
  function fieldsBox(fields, obj, opts) {
    return h('div', { class: 'fields' }, ...fields.map(f => field(opts && opts.noDirty ? { ...f, noDirty: true } : f, obj, opts && opts.onChange)));
  }

  /* ---------- operations helpers ---------- */
  const SHIP_STATUS = { preparing: 'قيد التجهيز', production: 'قيد التصنيع', inspection: 'الفحص قبل الشحن', shipped: 'تم الشحن', arrived: 'وصلت الميناء', customs: 'في التخليص الجمركي', delivered: 'تم التسليم' };
  const VERIFY = { desk: 'تحقق مكتبي (أوراق وتراخيص)', video: 'زيارة بالفيديو', visit: 'زيارة ميدانية', inspection: 'فحص فني مستقل' };
  function shipmentTracker(s) {
    const keys = Object.keys(SHIP_STATUS), at = Math.max(0, keys.indexOf(s.status));
    const days = s.eta ? Math.ceil((Date.parse(s.eta) - Date.now()) / 864e5) : null;
    return h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-route'), 'مسار الشحنة'),
      h('div', { class: 'tracker' }, ...keys.map((k, i) => h('div', { class: 'trk' + (i < at ? ' done' : i === at ? ' now' : '') }, h('span', { class: 'trk-dot' }, i < at ? ic('fa-solid fa-check') : String(i + 1)), h('small', {}, SHIP_STATUS[k])))),
      days != null && s.status !== 'delivered' ? h('p', { class: 'desc', style: 'margin:14px 0 0' }, days >= 0 ? `الوصول المتوقع بعد ${days} يوم (${s.eta})` : `تجاوزت موعد الوصول المتوقع بـ ${-days} يوم — راجع الشحنة`) : null,
      s.phone ? h('a', { class: 'a-btn a-btn-sm', style: 'margin-top:12px;background:var(--wa);color:#fff;border-color:var(--wa)', target: '_blank', rel: 'noopener',
        href: 'https://wa.me/' + String(s.phone).replace(/[^\d]/g, '') + '?text=' + encodeURIComponent(`مرحباً ${s.customer || ''}، تحديث شحنتك رقم ${s.ref || ''}: ${SHIP_STATUS[s.status] || ''}${s.eta ? '، الوصول المتوقع ' + s.eta : ''}.`) }, ic('fa-brands fa-whatsapp'), 'إرسال تحديث الحالة للعميل') : null);
  }
  function comparisonTable(s) {
    const offers = (s.offers || []).filter(o => o.price || o.supplier);
    if (!offers.length) return h('div', { class: 'card' }, h('p', { class: 'desc', style: 'margin:0' }, 'أدخل العروض بالأعلى لتظهر المقارنة هنا.'));
    const usd = o => (+o.price || 0) * (o.currency === 'CNY' ? 1 / 7.2 : 1); // approximate rate for ranking only
    const priced = offers.filter(o => +o.price > 0), timed = offers.filter(o => +o.leadDays > 0);
    const best = priced.length ? priced.reduce((a, b) => (usd(b) < usd(a) ? b : a)) : null;
    const fast = timed.length ? timed.reduce((a, b) => (+b.leadDays < +a.leadDays ? b : a)) : null;
    const name = o => (ops.suppliers.find(x => x.id === o.supplier) || {}).name || '(مورد غير محدد)';
    const row = o => h('tr', {}, h('td', {}, name(o)), h('td', { class: o === best ? 'best' : '' }, o.price ? `${(+o.price).toLocaleString('en-US')} ${o.currency || 'USD'}` : '—'), h('td', {}, o.moq || '—'), h('td', { class: o === fast ? 'best' : '' }, o.leadDays ? o.leadDays + ' يوم' : '—'), h('td', {}, o.warranty || '—'), h('td', {}, o.payment || '—'));
    return h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-table'), 'المقارنة'),
      h('div', { class: 'tw' }, h('table', { class: 'cmp' }, h('thead', {}, h('tr', {}, ...['المورد', 'السعر', 'MOQ', 'مدة التصنيع', 'الضمان', 'الدفع'].map(x => h('th', {}, x)))), h('tbody', {}, ...offers.map(row)))),
      h('p', { class: 'desc', style: 'margin:12px 0 0' }, [best ? `الأقل سعراً: ${name(best)}` : '', fast ? `الأسرع تسليماً: ${name(fast)}` : ''].filter(Boolean).join(' · ') + ' — قارن أيضاً الجودة وسمعة المصنع وشروط الضمان قبل القرار.'));
  }

  /* ---------- visitor statistics ---------- */
  const COUNTRY_NAME = { sa: 'السعودية', ae: 'الإمارات', qa: 'قطر', kw: 'الكويت', om: 'عُمان', bh: 'البحرين', iq: 'العراق', eg: 'مصر', jo: 'الأردن', ye: 'اليمن', lb: 'لبنان', sy: 'سوريا', ps: 'فلسطين', ly: 'ليبيا', tn: 'تونس', dz: 'الجزائر', ma: 'المغرب', sd: 'السودان', so: 'الصومال', dj: 'جيبوتي', mr: 'موريتانيا', tr: 'تركيا', ir: 'إيران', pk: 'باكستان', et: 'إثيوبيا', ke: 'كينيا', ng: 'نيجيريا', cn: 'الصين', hk: 'هونغ كونغ', in: 'الهند', gb: 'بريطانيا', de: 'ألمانيا', fr: 'فرنسا', es: 'إسبانيا', it: 'إيطاليا', ru: 'روسيا', us: 'أمريكا', ca: 'كندا', id: 'إندونيسيا', my: 'ماليزيا', sg: 'سنغافورة', au: 'أستراليا', other: 'دول أخرى' };
  const PAGE_NAME = { '/': 'الرئيسية', '/machines': 'الماكينات', '/machine': 'صفحات الماكينات', '/markets': 'الأسواق', '/services': 'الخدمات', '/about': 'من نحن', '/contact': 'تواصل معنا', '/compare': 'مقارنة الماكينات', '/page': 'صفحات مخصصة' };
  function barList(title, iconCls, rows, label) {
    const max = Math.max(1, ...rows.map(r => r.v));
    return h('div', { class: 'card' }, h('h3', {}, ic(iconCls), title),
      rows.length ? h('div', { class: 'hbars' }, ...rows.map(r => h('div', { class: 'hbar', title: `${label(r.k)}: ${r.v}` },
        h('span', { class: 'hb-label' }, label(r.k)), h('span', { class: 'hb-track' }, h('span', { class: 'hb-fill', style: `width:${Math.max(2, r.v / max * 100)}%` })), h('b', {}, String(r.v)))))
        : h('p', { class: 'desc', style: 'margin:10px 0 0' }, 'لا توجد بيانات بعد.'));
  }
  function dailyChart(days) {
    const W = 760, H = 220, padL = 36, padB = 26, padT = 12, n = days.length, max = Math.max(4, ...days.map(d => d.v));
    const step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
    const bw = (W - padL - 8) / n, y = v => padT + (H - padT - padB) * (1 - v / top);
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'dchart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'المشاهدات اليومية لآخر 30 يوماً');
    const el = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
    for (let i = 0; i <= 4; i++) { const v = top / 4 * i, yy = y(v); el('line', { x1: padL, x2: W - 8, y1: yy, y2: yy, class: 'grid' }); el('text', { x: padL - 6, y: yy + 4, class: 'tick', 'text-anchor': 'end' }, Math.round(v)); }
    const tip = h('div', { class: 'ctip', hidden: true });
    days.forEach((d, i) => {
      const x = padL + i * bw + 2, w = Math.max(2, bw - 4), yy = y(d.v), hgt = H - padB - yy, r = Math.min(4, w / 2, hgt);
      if (d.v > 0) el('path', { class: 'bar' + (i === n - 1 ? ' today' : ''), d: `M${x} ${H - padB}V${yy + r}Q${x} ${yy} ${x + r} ${yy}H${x + w - r}Q${x + w} ${yy} ${x + w} ${yy + r}V${H - padB}Z` });
      const hit = el('rect', { x: padL + i * bw, y: padT, width: bw, height: H - padT - padB, class: 'hit' });
      hit.addEventListener('pointerenter', ev => { tip.hidden = false; tip.textContent = `${d.date}: ${d.v} مشاهدة · ${d.u} زائر`; });
      hit.addEventListener('pointermove', ev => { const b = svg.getBoundingClientRect(); tip.style.left = (ev.clientX - b.left) + 'px'; tip.style.top = (ev.clientY - b.top - 34) + 'px'; });
      hit.addEventListener('pointerleave', () => { tip.hidden = true; });
      if (i % 5 === 0 || i === n - 1) el('text', { x: x + w / 2, y: H - 8, class: 'tick', 'text-anchor': 'middle' }, d.date.slice(5).replace('-', '/'));
    });
    el('line', { x1: padL, x2: W - 8, y1: H - padB, y2: H - padB, class: 'axis' });
    return h('div', { class: 'chart-wrap' }, svg, tip);
  }
  async function viewStats(v) {
    v.append(h('p', { class: 'desc' }, 'جارٍ التحميل...'));
    let s;
    try { s = await api('/api/admin/stats'); } catch (e) { v.innerHTML = ''; v.append(h('div', { class: 'alert warn' }, trErr(e.message))); return; }
    v.innerHTML = '';
    const kpi = (icon, n, label) => h('div', { class: 'kpi', style: 'cursor:default' }, ic(icon), h('div', {}, h('b', {}, Number(n).toLocaleString('en-US')), h('span', {}, label)));
    v.append(h('div', { class: 'kpis' }, kpi('fa-solid fa-user', s.totals.uToday, 'زائر اليوم'), kpi('fa-solid fa-eye', s.totals.vToday, 'مشاهدة اليوم'), kpi('fa-solid fa-users', s.totals.u, 'زائر خلال 30 يوماً'), kpi('fa-solid fa-chart-line', s.totals.v, 'مشاهدة خلال 30 يوماً')));
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-chart-column'), 'المشاهدات اليومية — آخر 30 يوماً'), h('p', { class: 'desc' }, 'مرّر الماوس على أي يوم لرؤية الأرقام. العمود الأغمق = اليوم.'), dailyChart(s.days),
      h('details', { class: 'tview' }, h('summary', {}, 'عرض الأرقام كجدول'), h('div', { class: 'tw' }, h('table', { class: 'cmp' }, h('thead', {}, h('tr', {}, h('th', {}, 'التاريخ'), h('th', {}, 'المشاهدات'), h('th', {}, 'الزوار'))), h('tbody', {}, ...s.days.slice().reverse().map(d => h('tr', {}, h('td', {}, d.date), h('td', {}, String(d.v)), h('td', {}, String(d.u))))))))));
    const machineName = id => { const m = (content.machines || []).find(x => x.id === id); return m ? ar(m.name) : id; };
    v.append(h('div', { class: 'stats-grid' },
      barList('أكثر الماكينات مشاهدة', 'fa-solid fa-industry', s.machines, machineName),
      barList('من أين يأتي الزوار (تقديري)', 'fa-solid fa-earth-asia', s.countries, k => COUNTRY_NAME[k] || k),
      barList('أكثر الصفحات زيارة', 'fa-solid fa-file-lines', s.pages, k => PAGE_NAME[k] || k),
      barList('لغة التصفح', 'fa-solid fa-language', s.langs, k => ({ ar: 'العربية', en: 'English', zh: '中文' })[k] || 'أخرى'),
      barList('نوع الجهاز', 'fa-solid fa-mobile-screen', s.devices, k => (k === 'mobile' ? 'جوال' : 'كمبيوتر')),
      barList('مصادر الزيارات (روابط خارجية)', 'fa-solid fa-link', s.refs, k => k)));
    v.append(h('div', { class: 'alert info' }, ic('fa-solid fa-shield-halved'), h('div', {}, 'الإحصائيات تُجمع بدون كوكيز وبدون حفظ عناوين IP. الدولة تُقدَّر من المنطقة الزمنية لجهاز الزائر، والزائر الفريد يُحسب لكل يوم. إجمالي كل المشاهدات منذ البداية: ' + Number(s.totals.allTime).toLocaleString('en-US'))));
    v.append(h('button', { class: 'a-btn a-btn-danger', onclick: async () => { if (!confirm('مسح كل الإحصائيات والبدء من جديد؟')) return; await api('/api/admin/stats', { method: 'DELETE' }); toast('تم مسح الإحصائيات'); render(); } }, ic('fa-solid fa-eraser'), 'مسح الإحصائيات'));
  }

  /* ---------- schemas ---------- */
  const COUNTRIES = [['sa', '🇸🇦 السعودية'], ['ae', 'الإمارات'], ['qa', 'قطر'], ['kw', 'الكويت'], ['om', 'عُمان'], ['bh', 'البحرين'], ['iq', 'العراق'], ['eg', 'مصر'], ['jo', 'الأردن'], ['ye', 'اليمن'], ['lb', 'لبنان'], ['sy', 'سوريا'], ['ps', 'فلسطين'], ['ly', 'ليبيا'], ['tn', 'تونس'], ['dz', 'الجزائر'], ['ma', 'المغرب'], ['sd', 'السودان'], ['so', 'الصومال'], ['dj', 'جيبوتي'], ['mr', 'موريتانيا'], ['tr', 'تركيا'], ['ir', 'إيران'], ['pk', 'باكستان'], ['et', 'إثيوبيا'], ['ke', 'كينيا'], ['ng', 'نيجيريا'], ['cn', 'الصين']].map(([c, n]) => [c, n.replace(/^\S+ /, '')]);
  const catOptions = () => (content.categories || []).map(c => [c.id, ar(c.name) || c.id]);
  const LINK_HINT = 'أمثلة: #/machines (الماكينات) — #/contact (تواصل) — #/services — #/about — whatsapp (فتح واتساب) — أو أي رابط كامل https://...';

  const SCHEMAS = {
    machines: {
      title: 'الماكينات وخطوط الإنتاج', single: 'ماكينة', icon: 'fa-solid fa-industry', path: 'machines', search: true, filterCat: true,
      thumb: m => (m.images || [])[0], thumbIcon: m => { const c = (content.categories || []).find(x => x.id === m.cat); return c ? c.icon : 'fa-solid fa-industry'; },
      titleOf: m => ar(m.name) || '(بدون اسم)',
      subOf: m => { const c = (content.categories || []).find(x => x.id === m.cat); return [m.model, c ? ar(c.name) : '', ar(m.capacity)].filter(Boolean).join(' • '); },
      pills: m => m.featured ? [['مميزة', 'ok']] : [],
      newItem: () => ({ id: uid('m'), cat: ((content.categories || [])[0] || {}).id || '', featured: false, model: '', name: { ar: '', en: '' }, capacity: { ar: '', en: '' }, price: { ar: '', en: '' }, badge: { ar: '', en: '' }, desc: { ar: '', en: '' }, specs: [{ k: { ar: 'الطاقة الإنتاجية', en: 'Capacity' }, v: { ar: '', en: '' } }, { k: { ar: 'القدرة الكهربائية', en: 'Power' }, v: { ar: '', en: '' } }, { k: { ar: 'الخامة', en: 'Material' }, v: { ar: '', en: '' } }], sections: [], images: [], video: '', brochure: '' }),
      fields: () => [
        { key: 'name', type: 'bi', label: 'اسم الماكينة / خط الإنتاج', full: true },
        { key: 'cat', type: 'select', label: 'القسم', options: catOptions },
        { key: 'model', type: 'text', label: 'الموديل', ltr: true, placeholder: 'مثال: CGF 24-24-8' },
        { key: 'capacity', type: 'bi', label: 'الطاقة الإنتاجية (تظهر في البطاقة)', full: true },
        { key: 'price', type: 'bi', label: 'السعر (اتركه فارغاً ليظهر "حسب الطلب")', full: true },
        { key: 'badge', type: 'bi', label: 'شارة مميزة (مثال: الأكثر طلباً / جديد) — اختياري', full: true },
        { key: 'featured', type: 'bool', label: 'عرضها في "خطوط إنتاج مختارة" بالصفحة الرئيسية' },
        { key: 'desc', type: 'bitext', label: 'الوصف', hint: 'لعمل قائمة نقطية ابدأ السطر بـ • أو -   وللخط العريض ضع النص بين **نجمتين**' },
        { key: 'images', type: 'gallery', label: 'صور الماكينة' },
        { key: 'specs', type: 'list', label: 'المواصفات الفنية (تظهر كجدول في صفحة الماكينة)', itemLabel: 'مواصفة', addLabel: 'إضافة مواصفة', newItem: () => ({ k: { ar: '', en: '' }, v: { ar: '', en: '' } }),
          fields: [{ key: 'k', type: 'bi', label: 'البند', full: true }, { key: 'v', type: 'bi', label: 'القيمة', full: true }] },
        { key: 'sections', type: 'list', label: 'أقسام إضافية في صفحة الماكينة (مزايا، ملحقات، المنتجات النهائية...)', itemLabel: 'قسم', addLabel: 'إضافة قسم جديد', newItem: () => ({ title: { ar: '', en: '' }, text: { ar: '', en: '' }, image: '' }),
          fields: [{ key: 'title', type: 'bi', label: 'عنوان القسم', full: true }, { key: 'text', type: 'bitext', label: 'المحتوى' }, { key: 'image', type: 'image', label: 'صورة (اختياري)' }] },
        { key: 'video', type: 'file', label: 'فيديو التشغيل', accept: 'video/mp4', hint: 'ضع رابط يوتيوب (أفضل) أو ارفع ملف MP4' },
        { key: 'brochure', type: 'file', label: 'كتالوج PDF (اختياري)', accept: 'application/pdf' }
      ]
    },
    categories: {
      title: 'الأقسام / القطاعات', single: 'قسم', icon: 'fa-solid fa-layer-group', path: 'categories',
      thumb: c => c.image, thumbIcon: c => c.icon, titleOf: c => ar(c.name) || '(بدون اسم)',
      subOf: c => `${(content.machines || []).filter(m => m.cat === c.id).length} ماكينة`,
      newItem: () => ({ id: uid('cat'), icon: 'fa-solid fa-industry', image: '', name: { ar: '', en: '' }, desc: { ar: '', en: '' } }),
      beforeDelete: c => { const n = (content.machines || []).filter(m => m.cat === c.id).length; return !n || confirm(`هذا القسم يحتوي على ${n} ماكينة. ستبقى الماكينات بدون قسم. متابعة؟`); },
      fields: () => [
        { key: 'name', type: 'bi', label: 'اسم القسم', full: true },
        { key: 'icon', type: 'icon', label: 'الأيقونة' },
        { key: 'desc', type: 'bitext', label: 'وصف مختصر' },
        { key: 'image', type: 'image', label: 'صورة بدلاً من الأيقونة (اختياري)' }
      ]
    },
    hero: {
      title: 'شرائح الواجهة الرئيسية', single: 'شريحة', icon: 'fa-solid fa-images', path: 'hero',
      thumb: s => s.image, thumbIcon: () => 'fa-solid fa-panorama', titleOf: s => ar(s.title) || '(بدون عنوان)', subOf: s => ar(s.badge),
      newItem: () => ({ badge: { ar: '', en: '' }, title: { ar: '', en: '' }, subtitle: { ar: '', en: '' }, image: '', imageAsBackground: false, btn1Text: { ar: 'تصفح الماكينات', en: 'Browse Machines' }, btn1Link: '#/machines', btn2Text: { ar: 'تواصل معنا', en: 'Contact Us' }, btn2Link: '#/contact' }),
      fields: () => [
        { key: 'badge', type: 'bi', label: 'شارة صغيرة أعلى العنوان', full: true },
        { key: 'title', type: 'bi', label: 'العنوان الرئيسي', full: true },
        { key: 'subtitle', type: 'bitext', label: 'النص التوضيحي' },
        { key: 'image', type: 'image', label: 'صورة الشريحة (اختياري)', hint: 'بدون صورة يظهر شعار الشركة بتصميم متحرك' },
        { key: 'imageAsBackground', type: 'bool', label: 'استخدام الصورة كخلفية كاملة للشريحة' },
        { key: 'btn1Text', type: 'bi', label: 'نص الزر الأول' },
        { key: 'btn1Link', type: 'text', label: 'رابط الزر الأول', ltr: true, hint: LINK_HINT },
        { key: 'btn2Text', type: 'bi', label: 'نص الزر الثاني' },
        { key: 'btn2Link', type: 'text', label: 'رابط الزر الثاني', ltr: true, hint: LINK_HINT }
      ]
    },
    services: {
      title: 'الخدمات', single: 'خدمة', icon: 'fa-solid fa-briefcase', path: 'services',
      thumbIcon: s => s.icon, titleOf: s => ar(s.title), subOf: s => ar(s.desc),
      newItem: () => ({ icon: 'fa-solid fa-star', title: { ar: '', en: '' }, desc: { ar: '', en: '' } }),
      fields: () => [{ key: 'title', type: 'bi', label: 'اسم الخدمة', full: true }, { key: 'icon', type: 'icon', label: 'الأيقونة' }, { key: 'desc', type: 'bitext', label: 'الوصف' }]
    },
    process: {
      title: 'خطوات العمل', single: 'خطوة', icon: 'fa-solid fa-route', path: 'process',
      thumbIcon: s => s.icon, titleOf: s => ar(s.title), subOf: s => ar(s.desc),
      newItem: () => ({ icon: 'fa-solid fa-circle-check', title: { ar: '', en: '' }, desc: { ar: '', en: '' } }),
      fields: () => [{ key: 'title', type: 'bi', label: 'عنوان الخطوة', full: true }, { key: 'icon', type: 'icon', label: 'الأيقونة' }, { key: 'desc', type: 'bitext', label: 'الوصف' }]
    },
    why: {
      title: 'لماذا نحن', single: 'ميزة', icon: 'fa-solid fa-award', path: 'why',
      thumbIcon: s => s.icon, titleOf: s => ar(s.title), subOf: s => ar(s.desc),
      newItem: () => ({ icon: 'fa-solid fa-star', title: { ar: '', en: '' }, desc: { ar: '', en: '' } }),
      fields: () => [{ key: 'title', type: 'bi', label: 'العنوان', full: true }, { key: 'icon', type: 'icon', label: 'الأيقونة' }, { key: 'desc', type: 'bitext', label: 'الوصف' }]
    },
    pages: {
      title: 'الصفحات', single: 'صفحة', icon: 'fa-solid fa-file-lines', path: 'pages',
      thumbIcon: () => 'fa-solid fa-file-lines', titleOf: p => ar(p.title) || '(بدون عنوان)',
      subOf: p => '/#/page/' + (p.slug || ''), pills: p => [p.showInNav ? ['في القائمة العلوية', 'ok'] : null, p.showInFooter ? ['في التذييل', ''] : null].filter(Boolean),
      newItem: () => ({ id: uid('p'), slug: 'page-' + Math.random().toString(36).slice(2, 6), title: { ar: '', en: '' }, subtitle: { ar: '', en: '' }, showInNav: true, showInFooter: true, blocks: [{ type: 'text', heading: { ar: '', en: '' }, text: { ar: '', en: '' }, image: '', buttonText: { ar: '', en: '' }, buttonLink: '' }] }),
      fields: () => [
        { key: 'title', type: 'bi', label: 'عنوان الصفحة', full: true },
        { key: 'subtitle', type: 'bi', label: 'وصف قصير تحت العنوان', full: true },
        { key: 'slug', type: 'text', label: 'رابط الصفحة (بالإنجليزية بدون مسافات)', ltr: true, hint: 'مثال: warranty ← يصبح الرابط yoursite.com/#/page/warranty' },
        { key: 'showInNav', type: 'bool', label: 'إظهار في القائمة العلوية' },
        { key: 'showInFooter', type: 'bool', label: 'إظهار في روابط التذييل' },
        { key: 'blocks', type: 'list', label: 'محتوى الصفحة (أقسام)', itemLabel: 'قسم', addLabel: 'إضافة قسم للصفحة', newItem: () => ({ type: 'text', heading: { ar: '', en: '' }, text: { ar: '', en: '' }, image: '', buttonText: { ar: '', en: '' }, buttonLink: '', category: '' }),
          fields: [
            { key: 'type', type: 'select', label: 'نوع القسم', options: [['text', 'نص (مع صورة اختيارية)'], ['image', 'صورة كبيرة'], ['cta', 'شريط دعوة للتواصل'], ['machines', 'عرض ماكينات من قسم']] },
            { key: 'category', type: 'select', label: 'القسم (لنوع "عرض ماكينات")', options: () => [['', 'كل الأقسام'], ...catOptions()] },
            { key: 'heading', type: 'bi', label: 'العنوان', full: true },
            { key: 'text', type: 'bitext', label: 'النص', hint: 'ابدأ السطر بـ • لعمل قائمة نقطية' },
            { key: 'image', type: 'image', label: 'صورة' },
            { key: 'buttonText', type: 'bi', label: 'نص الزر (اختياري)' },
            { key: 'buttonLink', type: 'text', label: 'رابط الزر', ltr: true, hint: LINK_HINT }
          ] }
      ]
    },
    shipments: {
      title: 'الشحنات', single: 'شحنة', icon: 'fa-solid fa-ship', path: 'shipments', store: 'ops', search: true,
      thumbIcon: s => ({ sea: 'fa-solid fa-ship', air: 'fa-solid fa-plane', rail: 'fa-solid fa-train', land: 'fa-solid fa-truck' })[s.mode] || 'fa-solid fa-box',
      titleOf: s => [s.ref, s.customer].filter(Boolean).join(' — ') || '(شحنة بدون رقم)',
      subOf: s => [s.machines && String(s.machines).split('\n')[0], s.destination, s.eta ? 'الوصول المتوقع ' + s.eta : ''].filter(Boolean).join(' • '),
      pills: s => [[SHIP_STATUS[s.status] || s.status, s.status === 'delivered' ? 'ok' : '']],
      newItem: () => ({ id: uid('sh'), ref: 'SM-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(), customer: '', phone: '', machines: '', mode: 'sea', incoterm: 'FOB', origin: 'شنغهاي', destination: '', etd: '', eta: '', container: '', bl: '', status: 'preparing', notes: '' }),
      fields: () => [
        { key: 'ref', type: 'text', label: 'رقم الشحنة', ltr: true },
        { key: 'status', type: 'select', label: 'الحالة الآن', options: Object.entries(SHIP_STATUS) },
        { key: 'customer', type: 'text', label: 'العميل' },
        { key: 'phone', type: 'text', label: 'جوال العميل', ltr: true },
        { key: 'machines', type: 'textarea', label: 'محتوى الشحنة (الماكينات والكميات)', full: true },
        { key: 'mode', type: 'select', label: 'طريقة الشحن', options: [['sea', 'بحري'], ['air', 'جوي'], ['rail', 'سككي'], ['land', 'بري']] },
        { key: 'incoterm', type: 'select', label: 'شرط التسليم', options: [['EXW', 'EXW'], ['FOB', 'FOB'], ['CIF', 'CIF'], ['DDP', 'DDP'], ['other', 'آخر']] },
        { key: 'origin', type: 'text', label: 'ميناء الشحن' },
        { key: 'destination', type: 'text', label: 'ميناء / مدينة الوصول' },
        { key: 'etd', type: 'date', label: 'تاريخ الشحن (ETD)' },
        { key: 'eta', type: 'date', label: 'الوصول المتوقع (ETA)' },
        { key: 'container', type: 'text', label: 'رقم الحاوية', ltr: true },
        { key: 'bl', type: 'text', label: 'رقم بوليصة الشحن (B/L)', ltr: true },
        { key: 'notes', type: 'textarea', label: 'ملاحظات', full: true }
      ],
      after: s => shipmentTracker(s)
    },
    suppliers: {
      title: 'الموردون (المصانع)', single: 'مورد', icon: 'fa-solid fa-industry', path: 'suppliers', store: 'ops', search: true,
      thumbIcon: () => 'fa-solid fa-industry',
      titleOf: s => s.name || '(بدون اسم)',
      subOf: s => [s.city, s.products && String(s.products).split('\n')[0], s.phone].filter(Boolean).join(' • '),
      pills: s => [[VERIFY[s.verify] || 'لم يُتحقق', s.verify === 'inspection' || s.verify === 'visit' ? 'ok' : (s.verify ? '' : 'off')], ...(s.rating ? [['★'.repeat(+s.rating), '']] : [])],
      newItem: () => ({ id: uid('sp'), name: '', city: '', products: '', category: '', contact: '', phone: '', wechat: '', email: '', website: '', verify: '', rating: '', notes: '' }),
      fields: () => [
        { key: 'name', type: 'text', label: 'اسم المصنع / المورد' },
        { key: 'city', type: 'text', label: 'المدينة والمقاطعة', placeholder: 'مثال: تشانغجياقانغ، جيانغسو' },
        { key: 'category', type: 'select', label: 'القطاع', options: () => [['', '—'], ...catOptions()] },
        { key: 'products', type: 'textarea', label: 'ما يصنعه (الماكينات والمنتجات)', full: true },
        { key: 'contact', type: 'text', label: 'الشخص المسؤول' },
        { key: 'phone', type: 'text', label: 'الهاتف / واتساب', ltr: true },
        { key: 'wechat', type: 'text', label: 'وي شات WeChat', ltr: true },
        { key: 'email', type: 'text', label: 'البريد', ltr: true },
        { key: 'website', type: 'text', label: 'الموقع / رابط علي بابا', ltr: true },
        { key: 'verify', type: 'select', label: 'نوع التحقق الذي تم فعلاً', options: Object.entries({ '': 'لم يُتحقق بعد', ...VERIFY }) },
        { key: 'rating', type: 'select', label: 'تقييمك للمورد', options: [['', '—'], ['1', '★'], ['2', '★★'], ['3', '★★★'], ['4', '★★★★'], ['5', '★★★★★']] },
        { key: 'notes', type: 'textarea', label: 'ملاحظات (الجودة، الالتزام، الأسعار…)', full: true }
      ]
    },
    comparisons: {
      title: 'مقارنة عروض الموردين', single: 'مقارنة', icon: 'fa-solid fa-scale-balanced', path: 'comparisons', store: 'ops',
      thumbIcon: () => 'fa-solid fa-scale-balanced',
      titleOf: s => s.title || s.product || '(مقارنة)',
      subOf: s => [(s.offers || []).length + ' عروض', s.date, s.decision && 'القرار: ' + String(s.decision).slice(0, 40)].filter(Boolean).join(' • '),
      newItem: () => ({ id: uid('cmp'), title: '', product: '', date: new Date().toISOString().slice(0, 10), offers: [{}, {}, {}].map(() => ({ supplier: '', price: '', currency: 'USD', moq: '', leadDays: '', warranty: '', payment: '', notes: '' })), decision: '' }),
      fields: () => [
        { key: 'title', type: 'text', label: 'عنوان المقارنة', placeholder: 'مثال: خط تعبئة مياه 8000 عبوة — عميل الرياض' },
        { key: 'date', type: 'date', label: 'التاريخ' },
        { key: 'product', type: 'text', label: 'المنتج / المواصفات المطلوبة', full: true },
        { key: 'offers', type: 'list', label: 'العروض', itemLabel: 'عرض', addLabel: 'إضافة عرض', newItem: () => ({ supplier: '', price: '', currency: 'USD', moq: '', leadDays: '', warranty: '', payment: '', notes: '' }),
          fields: [
            { key: 'supplier', type: 'select', label: 'المورد', options: () => [['', '— اختر من الموردين —'], ...ops.suppliers.map(s => [s.id, s.name || '(بدون اسم)'])] },
            { key: 'price', type: 'number', label: 'السعر' },
            { key: 'currency', type: 'select', label: 'العملة', options: [['USD', 'USD دولار'], ['CNY', 'CNY يوان']] },
            { key: 'moq', type: 'number', label: 'أقل كمية (MOQ)' },
            { key: 'leadDays', type: 'number', label: 'مدة التصنيع (يوم)' },
            { key: 'warranty', type: 'text', label: 'الضمان' },
            { key: 'payment', type: 'text', label: 'شروط الدفع' },
            { key: 'notes', type: 'text', label: 'ملاحظات' }
          ] },
        { key: 'decision', type: 'textarea', label: 'القرار والسبب', full: true }
      ],
      after: s => comparisonTable(s)
    },
    testimonials: {
      title: 'آراء العملاء', single: 'رأي', icon: 'fa-solid fa-quote-right', path: 'testimonials',
      thumbIcon: () => 'fa-solid fa-user', titleOf: s => ar(s.name), subOf: s => ar(s.role),
      newItem: () => ({ name: { ar: '', en: '' }, role: { ar: '', en: '' }, text: { ar: '', en: '' }, rating: 5 }),
      fields: () => [{ key: 'name', type: 'bi', label: 'اسم العميل', full: true }, { key: 'role', type: 'bi', label: 'الشركة / المدينة', full: true }, { key: 'text', type: 'bitext', label: 'نص الرأي' }, { key: 'rating', type: 'number', label: 'التقييم (1-5)' }]
    }
  };

  const FORMS = {
    contact: {
      title: 'أرقام التواصل والعناوين', icon: 'fa-solid fa-address-book', get: () => content.contact || (content.contact = {}),
      cards: [
        ['واتساب', 'fa-brands fa-whatsapp', 'رقم واتساب يُستخدم في كل أزرار واتساب بالموقع وزر واتساب العائم', [
          { key: 'whatsapp', type: 'text', label: 'رقم واتساب (مع كود الدولة)', ltr: true, placeholder: '9665xxxxxxxx', hint: 'أرقام فقط مع كود الدولة وبدون + أو أصفار في البداية. مثال: 966501234567' },
          { key: 'floatingWhatsapp', type: 'bool', label: 'إظهار زر واتساب العائم في كل الصفحات' },
          { key: 'whatsappMessage', type: 'bi', label: 'الرسالة الافتراضية عند فتح واتساب', full: true }
        ]],
        ['أرقام الهاتف', 'fa-solid fa-phone', 'تظهر في الشريط العلوي والتذييل وصفحة التواصل (الرقم الأول يظهر في الأعلى)', [
          { key: 'phones', type: 'list', label: '', itemLabel: 'رقم', addLabel: 'إضافة رقم', newItem: () => ({ label: { ar: '', en: '' }, number: '' }),
            fields: [{ key: 'label', type: 'bi', label: 'الوصف (مثال: مكتب السعودية)', full: true }, { key: 'number', type: 'text', label: 'الرقم', ltr: true, placeholder: '+966 50 000 0000' }] }
        ]],
        ['البريد الإلكتروني', 'fa-regular fa-envelope', '', [
          { key: 'emails', type: 'list', label: '', itemLabel: 'بريد', addLabel: 'إضافة بريد', newItem: () => ({ value: '' }), fields: [{ key: 'value', type: 'text', label: 'البريد', ltr: true }] }
        ]],
        ['المكاتب والعناوين', 'fa-solid fa-location-dot', '', [
          { key: 'offices', type: 'list', label: '', itemLabel: 'مكتب', addLabel: 'إضافة مكتب', newItem: () => ({ name: { ar: '', en: '' }, address: { ar: '', en: '' }, mapUrl: '' }),
            fields: [{ key: 'name', type: 'bi', label: 'اسم المكتب', full: true }, { key: 'address', type: 'bi', label: 'العنوان', full: true }, { key: 'mapUrl', type: 'text', label: 'رابط Google Maps', ltr: true, full: true }] },
          { key: 'hours', type: 'bi', label: 'ساعات العمل', full: true },
          { key: 'mapEmbed', type: 'text', label: 'رابط الخريطة المضمنة في صفحة التواصل', ltr: true, full: true, hint: 'من Google Maps: مشاركة ← تضمين خريطة ← انسخ الرابط الموجود داخل src="..." فقط' }
        ]]
      ]
    },
    socials: {
      title: 'روابط التواصل الاجتماعي', icon: 'fa-solid fa-share-nodes', get: () => content,
      cards: [['الأيقونات والروابط', 'fa-solid fa-share-nodes', 'اختر المنصة وضع الرابط، وفعّل "إظهار" لتظهر الأيقونة في أعلى وأسفل الموقع وصفحة التواصل. يمكنك تغيير الأيقونة لأي شكل تريده.', [
        { key: 'socials', type: 'list', label: '', itemLabel: 'رابط', addLabel: 'إضافة رابط جديد', newItem: () => ({ platform: 'instagram', icon: 'fa-brands fa-instagram', url: '', show: true }),
          fields: [
            { key: 'platform', type: 'select', label: 'المنصة', options: PLATFORMS.map(p => [p[0], p[1]]), rerender: true, onSelect: (o, v) => { const p = PLATFORMS.find(x => x[0] === v); if (p) o.icon = p[2]; } },
            { key: 'url', type: 'text', label: 'الرابط', ltr: true, placeholder: 'https://instagram.com/yourpage' },
            { key: 'icon', type: 'icon', label: 'الأيقونة' },
            { key: 'show', type: 'bool', label: 'إظهار في الموقع' }
          ] }
      ]]]
    },
    stats: {
      title: 'الأرقام والإحصائيات', icon: 'fa-solid fa-chart-simple', get: () => content,
      cards: [['أرقام الصفحة الرئيسية', 'fa-solid fa-chart-simple', 'تظهر أسفل الواجهة الرئيسية بجانب مربع البحث. ضع أرقاماً حقيقية عن شركتك.', [
        { key: 'stats', type: 'list', label: '', itemLabel: 'رقم', addLabel: 'إضافة رقم', newItem: () => ({ value: { ar: '', en: '' }, label: { ar: '', en: '' } }),
          fields: [{ key: 'value', type: 'bi', label: 'الرقم أو الكلمة (مثال: 500+ أو عالمي)', full: true }, { key: 'label', type: 'bi', label: 'الوصف', full: true }] }
      ]]]
    },
    markets: {
      title: 'الأسواق المستهدفة', icon: 'fa-solid fa-earth-asia', get: () => content,
      cards: [['الأسواق والدول', 'fa-solid fa-anchor', 'تظهر في قسم الأسواق بالصفحة الرئيسية وصفحة "الأسواق" وقائمة الدول في نموذج التواصل. عنوان القسم ووصفه من "أقسام الصفحة الرئيسية".', [
        { key: 'markets', type: 'list', label: '', itemLabel: 'دولة', addLabel: 'إضافة دولة', newItem: () => ({ code: '', region: 'gcc', name: { ar: '', en: '' }, note: { ar: '', en: '' }, sectors: { ar: '', en: '' }, desc: { ar: '', en: '' } }),
          fields: [
            { key: 'code', type: 'select', label: 'العلم (الدولة)', options: () => [['', '— بدون علم (منطقة / قارة) —'], ...COUNTRIES] },
            { key: 'icon', type: 'icon', label: 'أيقونة (تظهر إذا لم تختر علماً)' },
            { key: 'region', type: 'select', label: 'المجموعة', options: [['gcc', 'تركيزنا: دول الخليج العربي'], ['mena', 'أسواق الشرق الأوسط'], ['world', 'أسواق عالمية']] },
            { key: 'name', type: 'bi', label: 'اسم الدولة', full: true },
            { key: 'note', type: 'bi', label: 'الموانئ', full: true },
            { key: 'sectors', type: 'bi', label: 'القطاعات الأكثر طلباً (افصل بفاصلة ،)', full: true },
            { key: 'desc', type: 'bitext', label: 'وصف السوق' }
          ] }
      ]]]
    },
    faq: {
      title: 'الأسئلة الشائعة', icon: 'fa-solid fa-circle-question', get: () => content,
      cards: [['الأسئلة والأجوبة', 'fa-solid fa-circle-question', '', [
        { key: 'faq', type: 'list', label: '', itemLabel: 'سؤال', addLabel: 'إضافة سؤال', newItem: () => ({ q: { ar: '', en: '' }, a: { ar: '', en: '' } }),
          fields: [{ key: 'q', type: 'bi', label: 'السؤال', full: true }, { key: 'a', type: 'bitext', label: 'الإجابة' }] }
      ]]]
    },
    about: {
      title: 'صفحة من نحن', icon: 'fa-solid fa-building', get: () => content.about || (content.about = {}),
      cards: [
        ['المحتوى', 'fa-solid fa-building', '', [
          { key: 'title', type: 'bi', label: 'عنوان الصفحة', full: true },
          { key: 'intro', type: 'bitext', label: 'نبذة مختصرة (تظهر أيضاً في التذييل)' },
          { key: 'story', type: 'bitext', label: 'قصتنا' },
          { key: 'mission', type: 'bitext', label: 'رسالتنا' },
          { key: 'vision', type: 'bitext', label: 'رؤيتنا' },
          { key: 'image', type: 'image', label: 'صورة (مثلاً صورة المكتب أو الفريق)' }
        ]],
        ['القيم', 'fa-solid fa-gem', '', [
          { key: 'values', type: 'list', label: '', itemLabel: 'قيمة', addLabel: 'إضافة قيمة', newItem: () => ({ icon: 'fa-solid fa-star', title: { ar: '', en: '' }, desc: { ar: '', en: '' } }),
            fields: [{ key: 'title', type: 'bi', label: 'العنوان', full: true }, { key: 'icon', type: 'icon', label: 'الأيقونة' }, { key: 'desc', type: 'bi', label: 'الوصف', full: true }] }
        ]]
      ]
    },
    settings: {
      title: 'الإعدادات العامة والهوية', icon: 'fa-solid fa-sliders', get: () => content.settings || (content.settings = {}),
      cards: [
        ['الهوية', 'fa-solid fa-id-card', '', [
          { key: 'siteName', type: 'bi', label: 'اسم الشركة', full: true },
          { key: 'brandLine1', type: 'text', label: 'الاسم بالإنجليزية بجانب الشعار', ltr: true },
          { key: 'tagline', type: 'bi', label: 'الشعار النصي (Slogan)', full: true },
          { key: 'logo', type: 'image', label: 'الشعار (للخلفيات الفاتحة)', hint: 'يفضل PNG بخلفية شفافة' },
          { key: 'logoWhite', type: 'image', label: 'الشعار الأبيض (للخلفيات الداكنة)' },
          { key: 'favicon', type: 'image', label: 'أيقونة المتصفح (Favicon)' },
          { key: 'defaultLang', type: 'select', label: 'اللغة الافتراضية للموقع', options: [['ar', 'العربية'], ['en', 'English'], ['zh', '中文 الصينية']] }
        ]],
        ['الألوان', 'fa-solid fa-palette', 'ألوان الهوية — يتم تطبيقها على كامل الموقع', [
          { key: 'colors', type: '__colors' }
        ]],
        ['شريط الإعلان العلوي', 'fa-solid fa-bullhorn', 'شريط ملون أعلى الموقع لإعلان أو عرض خاص', [
          { key: 'announcement', type: '__announce' }
        ]],
        ['محركات البحث (SEO)', 'fa-brands fa-google', 'العنوان والوصف اللذان يظهران في نتائج جوجل', [
          { key: 'seoTitle', type: 'bi', label: 'عنوان الموقع', full: true },
          { key: 'seoDescription', type: 'bitext', label: 'وصف الموقع' },
          { key: 'copyright', type: 'bi', label: 'نص حقوق النشر في التذييل', full: true }
        ]]
      ]
    }
  };

  const SECTION_KEYS = [['categories', 'القطاعات'], ['featured', 'خطوط إنتاج مختارة'], ['process', 'خطوات العمل'], ['services', 'الخدمات'], ['markets', 'الأسواق'], ['why', 'لماذا نحن'], ['testimonials', 'آراء العملاء'], ['faq', 'الأسئلة الشائعة'], ['cta', 'شريط الدعوة للتواصل']];

  const NAV = [
    ['عام', [['dashboard', 'لوحة المعلومات', 'fa-solid fa-gauge'], ['messages', 'رسائل العملاء', 'fa-solid fa-inbox'], ['stats', 'إحصائيات الزوار', 'fa-solid fa-chart-column']]],
    ['العمليات (خاص بالإدارة)', [['shipments', 'الشحنات', 'fa-solid fa-ship'], ['suppliers', 'الموردون (المصانع)', 'fa-solid fa-industry'], ['comparisons', 'مقارنة عروض الموردين', 'fa-solid fa-scale-balanced']]],
    ['المنتجات', [['machines', 'الماكينات وخطوط الإنتاج', 'fa-solid fa-industry'], ['categories', 'الأقسام / القطاعات', 'fa-solid fa-layer-group']]],
    ['الصفحات والمحتوى', [['translate', 'الترجمة واللغات (عربي/English/中文)', 'fa-solid fa-language'], ['menu', 'أسماء الصفحات والقائمة', 'fa-solid fa-bars'], ['pages', 'الصفحات (إضافة صفحة جديدة)', 'fa-solid fa-file-lines'], ['hero', 'شرائح الواجهة', 'fa-solid fa-images'], ['sections', 'أقسام الصفحة الرئيسية', 'fa-solid fa-table-cells-large'], ['markets', 'الأسواق المستهدفة', 'fa-solid fa-earth-asia'], ['stats', 'الأرقام والإحصائيات', 'fa-solid fa-chart-simple'], ['services', 'الخدمات', 'fa-solid fa-briefcase'], ['process', 'خطوات العمل', 'fa-solid fa-route'], ['why', 'لماذا نحن', 'fa-solid fa-award'], ['testimonials', 'آراء العملاء', 'fa-solid fa-quote-right'], ['faq', 'الأسئلة الشائعة', 'fa-solid fa-circle-question'], ['about', 'صفحة من نحن', 'fa-solid fa-building']]],
    ['التواصل', [['contact', 'أرقام التواصل والعناوين', 'fa-solid fa-address-book'], ['socials', 'روابط السوشيال ميديا', 'fa-solid fa-share-nodes']]],
    ['النظام', [['notify', 'البريد والإشعارات والتطبيق', 'fa-solid fa-bell'], ['settings', 'الإعدادات والهوية', 'fa-solid fa-sliders'], ['backup', 'النسخ الاحتياطي', 'fa-solid fa-cloud-arrow-down'], ['security', 'كلمة المرور', 'fa-solid fa-lock']]]
  ];

  /* ---------- navigation ---------- */
  function renderNav() {
    const nav = $('#nav'); nav.innerHTML = '';
    const unread = messages.filter(i => !i.read).length;
    for (const [group, items] of NAV) {
      nav.append(h('div', { class: 'nav-group' }, group));
      for (const [id, label, icon] of items) {
        nav.append(h('div', { class: 'nav-item' + (current === id ? ' active' : ''), onclick: () => go(id) }, ic(icon), label,
          id === 'messages' && unread ? h('span', { class: 'nav-badge' }, String(unread)) : null));
      }
    }
    document.title = (unread ? `(${unread}) ` : '') + 'لوحة التحكم | سوجو منهل';
    if (navigator.setAppBadge) { try { unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge(); } catch { /* */ } }
  }
  function go(id) {
    if (privDirty && current === 'notify' && id !== 'notify') {
      if (!confirm('لديك تغييرات غير محفوظة في إعدادات البريد. اضغط "إلغاء" ثم "حفظ التغييرات"، أو "موافق" للخروج بدون حفظ.')) return;
      clearPrivDirty();
    }
    current = id; editing = null; openMsg = null;
    document.body.classList.remove('side-open');
    location.hash = id;
    render();
  }
  function labelOf(id) { for (const [, items] of NAV) for (const it of items) if (it[0] === id) return it[1]; return ''; }

  function render() {
    renderNav();
    const view = $('#view'); view.innerHTML = '';
    $('#pageTitle').textContent = labelOf(current);
    window.scrollTo(0, 0);
    if (current === 'dashboard') return viewDashboard(view);
    if (current === 'messages') return openMsg ? viewMessage(view, openMsg) : viewMessages(view);
    if (current === 'notify') return viewNotify(view);
    if (current === 'sections') return viewSections(view);
    if (current === 'menu') return viewMenu(view);
    if (current === 'translate') return viewTranslate(view);
    if (current === 'stats') return viewStats(view);
    if (current === 'backup') return viewBackup(view);
    if (current === 'security') return viewSecurity(view);
    if (SCHEMAS[current]) return editing ? viewEditor(view, current, editing.index) : viewCollection(view, current);
    if (FORMS[current]) return viewForm(view, current);
  }

  /* ---------- views ---------- */
  function viewDashboard(v) {
    const unread = messages.filter(i => !i.read).length;
    if (isDefaultPw) v.append(h('div', { class: 'alert warn' }, ic('fa-solid fa-triangle-exclamation'), h('div', {}, h('b', {}, 'تنبيه أمني: '), 'أنت تستخدم كلمة المرور الافتراضية. ', h('a', { href: '#security', style: 'text-decoration:underline;font-weight:700', onclick: e => { e.preventDefault(); go('security'); } }, 'غيّرها الآن'))));
    if (privateCfg && !privateCfg.mailConfigured) v.append(h('div', { class: 'alert warn' }, ic('fa-solid fa-envelope'), h('div', {}, h('b', {}, 'البريد غير مُفعّل بعد: '), 'لكي تصلك رسائل العملاء على ' + (privateCfg.notifyEmail || '') + ' أدخل "كلمة مرور التطبيقات" لحساب الإرسال من جوجل. ', h('a', { href: '#notify', style: 'text-decoration:underline;font-weight:700', onclick: e => { e.preventDefault(); go('notify'); } }, 'إعداد البريد والإشعارات'))));
    const kpi = (icon, n, label, target) => h('div', { class: 'kpi', onclick: () => go(target) }, ic(icon), h('div', {}, h('b', {}, String(n)), h('span', {}, label)));
    v.append(h('div', { class: 'kpis' },
      kpi('fa-solid fa-envelope', unread, 'رسالة غير مقروءة', 'messages'),
      kpi('fa-solid fa-inbox', messages.length, 'إجمالي الرسائل', 'messages'),
      kpi('fa-solid fa-industry', (content.machines || []).length, 'ماكينة وخط إنتاج', 'machines'),
      kpi('fa-solid fa-ship', ops.shipments.filter(s => s.status !== 'delivered').length, 'شحنة جارية', 'shipments')));
    const q = (icon, label, fn) => h('button', { class: 'a-btn', style: 'justify-content:flex-start;padding:14px', onclick: fn }, ic(icon), label);
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-bolt'), 'إجراءات سريعة'), h('p', { class: 'desc' }, 'أكثر ما ستحتاجه يومياً'),
      h('div', { class: 'quick' },
        q('fa-solid fa-plus', 'إضافة ماكينة جديدة', () => { current = 'machines'; addItem('machines'); }),
        q('fa-solid fa-file-circle-plus', 'إضافة صفحة جديدة', () => { current = 'pages'; addItem('pages'); }),
        q('fa-solid fa-earth-asia', 'الأسواق المستهدفة', () => go('markets')),
        q('fa-brands fa-whatsapp', 'أرقام التواصل وواتساب', () => go('contact')),
        q('fa-brands fa-instagram', 'روابط السوشيال ميديا', () => go('socials')),
        q('fa-solid fa-bell', 'تفعيل الإشعارات على جهازي', () => go('notify')))));
    const latest = messages.slice(0, 5);
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-inbox'), 'أحدث رسائل العملاء'),
      latest.length ? h('div', { class: 'rows', style: 'margin-top:14px' }, ...latest.map(msgRow)) : h('p', { class: 'desc', style: 'margin-top:10px' }, 'لا توجد رسائل بعد. ستظهر هنا كل الرسائل وطلبات الأسعار المرسلة من الموقع.')));
    v.append(h('div', { class: 'alert info' }, ic('fa-solid fa-circle-info'), h('div', {}, 'بعد أي تعديل اضغط ', h('b', {}, 'حفظ التغييرات'), ' (أو Ctrl+S) ليظهر التعديل في الموقع فوراً. يتم حفظ نسخة احتياطية تلقائياً قبل كل حفظ.')));
  }

  /* ---------- messages ---------- */
  const STATUS = { new: 'New — جديد', replied: 'Replied — تم الرد', completed: 'Completed — مكتمل' };
  const fmtDate = d => new Date(d).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  let msgFilter = '', msgSearch = '', openMsg = null;
  function msgRow(m) {
    return h('div', { class: 'row-item' + (m.read ? '' : ' unread'), style: 'cursor:pointer', onclick: () => openMessage(m.id) },
      h('div', { class: 'row-thumb' }, ic(m.read ? 'fa-regular fa-envelope-open' : 'fa-solid fa-envelope')),
      h('div', { class: 'row-main' }, h('b', {}, m.name, m.company ? h('span', { class: 'pill' }, m.company) : null),
        h('small', {}, [m.machine, m.country, (m.message || '').slice(0, 60)].filter(Boolean).join(' • '))),
      h('div', { style: 'display:grid;justify-items:end;gap:4px;flex-shrink:0' }, h('span', { class: 'pill st-' + m.status }, STATUS[m.status] || m.status), h('small', { style: 'color:var(--muted);font-size:.75rem' }, fmtDate(m.date))));
  }
  function openMessage(id) {
    current = 'messages'; openMsg = id; location.hash = 'messages/' + id;
    const m = messages.find(x => x.id === id);
    if (m && !m.read) { m.read = true; api('/api/admin/messages/' + id, { method: 'PATCH', body: { read: true } }).catch(() => {}); }
    render();
  }
  function viewMessages(v) {
    const sel = h('select', { onchange: () => { msgFilter = sel.value; render(); } }, h('option', { value: '' }, 'كل الحالات'), h('option', { value: 'unread' }, 'غير مقروءة'), ...Object.entries(STATUS).map(([k, l]) => h('option', { value: k }, l)));
    sel.value = msgFilter;
    const s = h('input', { class: 'inp', type: 'search', placeholder: 'بحث بالاسم أو الرقم أو الماكينة...' });
    s.value = msgSearch;
    s.onchange = () => { msgSearch = s.value; render(); };
    const q = msgSearch.trim().toLowerCase();
    const list = messages.filter(i => (!msgFilter || (msgFilter === 'unread' ? !i.read : i.status === msgFilter)) && (!q || [i.name, i.phone, i.email, i.machine, i.company, i.country].join(' ').toLowerCase().includes(q)));
    const exportCsv = () => {
      const cols = ['date', 'status', 'name', 'company', 'phone', 'email', 'country', 'machine', 'message', 'note'];
      download('messages.csv', '﻿' + [cols.join(','), ...messages.map(i => cols.map(c => '"' + String(i[c] || '').replace(/"/g, '""') + '"').join(','))].join('\n'), 'text/csv');
    };
    const counts = Object.keys(STATUS).map(k => h('span', { class: 'pill st-' + k }, `${STATUS[k].split(' — ')[1]}: ${messages.filter(x => x.status === k).length}`));
    v.append(h('div', { class: 'toolbar' }, sel, s, h('button', { class: 'a-btn', onclick: () => loadMessages(true) }, ic('fa-solid fa-rotate'), 'تحديث'), h('button', { class: 'a-btn', onclick: exportCsv }, ic('fa-solid fa-file-csv'), 'تصدير Excel'), h('span', { class: 'count' }, ...counts)));
    if (!list.length) { v.append(h('div', { class: 'empty' }, ic('fa-solid fa-inbox'), h('p', {}, 'لا توجد رسائل'))); return; }
    v.append(h('div', { class: 'rows' }, ...list.map(msgRow)));
  }
  function viewMessage(v, id) {
    const m = messages.find(x => x.id === id);
    if (!m) { openMsg = null; return render(); }
    $('#pageTitle').textContent = 'رسائل العملاء › ' + m.name;
    const phoneDigits = String(m.phone || '').replace(/[^\d]/g, '');
    const setStatus = async (st) => {
      if (st === 'completed' && m.email && !confirm('سيتم تغيير الحالة إلى "مكتمل" وإرسال رسالة إتمام على بريد العميل. متابعة؟')) return;
      try {
        const r = await api('/api/admin/messages/' + m.id, { method: 'PATCH', body: { status: st } });
        m.status = st;
        toast(r.completion === 'sent' ? 'تم التحديث وإرسال رسالة الإتمام للعميل ✉' : r.completion && r.completion.startsWith('failed') ? 'تم التحديث، لكن فشل إرسال البريد: ' + r.completion.slice(8) : 'تم تحديث الحالة', r.completion && r.completion.startsWith('failed') ? 'err' : 'ok');
        await loadMessages(); render();
      } catch (e) { toast(e.message, 'err'); }
    };
    const field = (icon, label, val, href) => val ? h('div', { class: 'msg-field' }, ic(icon), h('div', {}, h('small', {}, label), href ? h('a', { href, target: '_blank', rel: 'noopener', dir: 'auto' }, val) : h('span', { dir: 'auto' }, val))) : null;
    const d = m.delivery || {};
    const dl = (label, val) => h('span', { class: 'pill ' + (val === 'sent' || /^\d+\/\d+$/.test(val || '') && !/^0\//.test(val) ? 'ok' : /failed/.test(val || '') ? 'bad' : 'off'), title: val || '' }, label + ': ' + (val === 'sent' ? 'تم ✓' : /failed/.test(val || '') ? 'فشل' : val || '—'));
    v.append(h('div', { class: 'editor-head' },
      h('button', { class: 'a-btn', onclick: () => { openMsg = null; location.hash = 'messages'; render(); } }, ic('fa-solid fa-arrow-right'), 'كل الرسائل'),
      h('div', { class: 'status-switch' }, ...Object.entries(STATUS).map(([k, l]) => h('button', { class: 'a-btn a-btn-sm' + (m.status === k ? ' on st-' + k : ''), onclick: () => m.status !== k && setStatus(k) }, l))),
      h('button', { class: 'a-icon-btn danger', style: 'margin-inline-start:auto', title: 'حذف', onclick: async () => { if (!confirm('حذف هذه الرسالة نهائياً؟')) return; try { await api('/api/admin/messages/' + m.id, { method: 'DELETE' }); messages = messages.filter(x => x.id !== m.id); openMsg = null; toast('تم الحذف'); render(); } catch (e) { toast(e.message, 'err'); } } }, ic('fa-solid fa-trash'))));
    v.append(h('div', { class: 'card' },
      h('div', { class: 'msg-head' }, h('h3', {}, ic('fa-solid fa-user'), m.name), h('small', { style: 'color:var(--muted)' }, fmtDate(m.date))),
      h('div', { class: 'msg-fields' },
        field('fa-solid fa-phone', 'الجوال', m.phone, phoneDigits ? 'tel:+' + phoneDigits : null),
        field('fa-regular fa-envelope', 'البريد', m.email, m.email ? 'mailto:' + m.email : null),
        field('fa-solid fa-building', 'الشركة', m.company),
        field('fa-solid fa-flag', 'الدولة', m.country),
        field('fa-solid fa-industry', 'الطلب / الماكينة', m.machine),
        field('fa-solid fa-language', 'لغة العميل', ({ en: 'English', zh: '中文 الصينية' })[m.lang] || 'العربية')),
      m.message ? h('div', { class: 'inq-msg', dir: 'auto' }, m.message) : null,
      h('div', { class: 'delivery' }, h('small', {}, 'وصول الإشعار:'), dl('البريد', d.email), dl('واتساب', d.whatsapp), dl('إشعار الأجهزة', d.push))));
    if ((m.replies || []).length) {
      v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-comments'), 'سجل الردود'),
        h('div', { class: 'thread' }, ...m.replies.map(r => h('div', { class: 'bubble' + (r.ok === false ? ' failed' : '') },
          h('div', { class: 'bubble-meta' }, ic(r.via === 'whatsapp' ? 'fa-brands fa-whatsapp' : r.via === 'note' ? 'fa-solid fa-note-sticky' : 'fa-solid fa-envelope'),
            { email: 'رد بالبريد', whatsapp: 'رد واتساب', note: 'ملاحظة داخلية', 'completion-email': 'رسالة الإتمام (بريد)' }[r.via] || r.via, ' • ', fmtDate(r.date), r.ok === false ? h('b', { style: 'color:var(--danger)' }, ' — فشل: ' + (r.error || '')) : null),
          h('div', { dir: 'auto', style: 'white-space:pre-wrap' }, r.text))))));
    }
    const ta = h('textarea', { class: 'inp', placeholder: 'اكتب ردك على العميل هنا...', style: 'min-height:130px', dir: 'auto' });
    const subj = h('input', { class: 'inp', placeholder: 'عنوان الرسالة (اختياري)', dir: 'auto' });
    const sendReply = async (via) => {
      const text = ta.value.trim();
      if (!text) return toast('اكتب نص الرد أولاً', 'err');
      if (via === 'whatsapp') {
        if (!phoneDigits) return toast('لا يوجد رقم جوال لهذا العميل', 'err');
        window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      }
      try {
        await api('/api/admin/messages/' + m.id + '/reply', { method: 'POST', body: { text, via, subject: subj.value } });
        toast(via === 'email' ? 'تم إرسال الرد على بريد العميل ✉' : via === 'whatsapp' ? 'تم فتح واتساب وتسجيل الرد' : 'تم حفظ الملاحظة');
        await loadMessages(); render();
      } catch (e) { toast(e.message, 'err'); await loadMessages(); render(); }
    };
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-reply'), 'الرد على العميل'),
      h('p', { class: 'desc' }, 'الرد بالبريد يُرسل من بريد الشركة مباشرة إلى العميل ويتحول الطلب إلى "تم الرد". الرد بالواتساب يفتح المحادثة برسالتك جاهزة.'),
      h('div', { class: 'fields', style: 'grid-template-columns:1fr' }, m.email ? subj : null, ta),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
        m.email ? h('button', { class: 'a-btn a-btn-primary', onclick: () => sendReply('email') }, ic('fa-solid fa-paper-plane'), 'إرسال بالبريد') : h('span', { class: 'pill off' }, 'العميل لم يضع بريداً'),
        phoneDigits ? h('button', { class: 'a-btn', style: 'background:var(--wa);color:#fff;border-color:var(--wa)', onclick: () => sendReply('whatsapp') }, ic('fa-brands fa-whatsapp'), 'رد عبر واتساب') : null,
        h('button', { class: 'a-btn', onclick: () => sendReply('note') }, ic('fa-solid fa-note-sticky'), 'حفظ كملاحظة داخلية'))));
  }

  /* ---------- notifications / email settings / install ---------- */
  let privateCfg = null;
  function viewNotify(v) {
    if (!privateCfg) { v.append(h('p', {}, 'جارٍ التحميل...')); api('/api/admin/private').then(p => { privateCfg = p; render(); }).catch(e => toast(e.message, 'err')); return; }
    const p = clone(privateCfg);
    const save = async (quiet) => {
      try { privateCfg = await api('/api/admin/private', { method: 'PUT', body: p }); clearPrivDirty(); if (!quiet) toast('تم حفظ إعدادات البريد والإشعارات'); render(); return true; }
      catch (e) { toast(trErr(e.message), 'err'); return false; }
    };
    privSaver = save;
    const test = async (url, okMsg) => {
      if (privDirty && !(await save(true))) return; // always test with what is on screen
      try { await api(url, { method: 'POST' }); toast(okMsg); } catch (e) { toast(trErr(e.message), 'err'); }
    };

    // 1) this device
    const pushCard = h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-mobile-screen-button'), 'إشعارات هذا الجهاز (الجوال / الكمبيوتر)'),
      h('p', { class: 'desc' }, 'فعّل الإشعارات على كل جهاز تريد أن يصلك عليه تنبيه فوري عند وصول رسالة جديدة — حتى لو كانت اللوحة مغلقة.'));
    const pushStatus = h('div', { class: 'push-status' });
    pushCard.append(pushStatus);
    renderPushStatus(pushStatus);
    v.append(pushCard);

    // 2) install
    const installCard = h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-download'), 'تثبيت لوحة التحكم كتطبيق'),
      h('p', { class: 'desc' }, 'ثبّت لوحة التحكم على جوالك أو كمبيوترك كتطبيق مستقل بأيقونة الشركة (للإدارة فقط — الزوار لا يرونه).'));
    if (installPrompt) installCard.append(h('button', { class: 'a-btn a-btn-primary', onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); } }, ic('fa-solid fa-download'), 'تثبيت التطبيق الآن'));
    else if (matchMedia('(display-mode: standalone)').matches) installCard.append(h('div', { class: 'alert info', style: 'margin:0' }, ic('fa-solid fa-circle-check'), 'التطبيق مثبت ويعمل الآن كتطبيق مستقل.'));
    else installCard.append(h('div', { class: 'install-help' },
      h('div', {}, h('b', {}, ic('fa-brands fa-apple'), ' آيفون: '), 'افتح هذا الرابط في Safari ← زر المشاركة ', ic('fa-solid fa-arrow-up-from-bracket'), ' ← "إضافة إلى الشاشة الرئيسية". (الإشعارات على آيفون تعمل بعد التثبيت فقط)'),
      h('div', {}, h('b', {}, ic('fa-brands fa-android'), ' أندرويد: '), 'افتح الرابط في Chrome ← القائمة ⋮ ← "تثبيت التطبيق".'),
      h('div', {}, h('b', {}, ic('fa-solid fa-desktop'), ' الكمبيوتر: '), 'في Chrome أو Edge اضغط أيقونة التثبيت في شريط العنوان.'),
      h('div', { style: 'margin-top:8px' }, h('b', {}, 'رابط لوحة التحكم: '), h('code', { dir: 'ltr' }, location.origin + '/admin/'))));
    v.append(installCard);

    // 3) email
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-envelope'), 'البريد الإلكتروني (Gmail)'),
      h('p', { class: 'desc' }, 'كل رسالة من الموقع تُرسل تلقائياً إلى بريد الشركة، وتُحفظ دائماً في "رسائل العملاء" حتى لو فشل البريد.'),
      privateCfg.mailConfigured ? h('div', { class: 'alert info' }, ic('fa-solid fa-circle-check'), 'البريد مُفعّل.') : h('div', { class: 'alert warn' }, ic('fa-solid fa-triangle-exclamation'), h('div', {}, h('b', {}, 'لتفعيل البريد: '), 'ادخل حساب جوجل suzhoumanhal@gmail.com ← فعّل "التحقق بخطوتين" ← افتح ', h('a', { href: 'https://myaccount.google.com/apppasswords', target: '_blank', rel: 'noopener', style: 'text-decoration:underline' }, 'myaccount.google.com/apppasswords'), ' ← أنشئ كلمة مرور تطبيق باسم "Website" ← انسخ الـ 16 حرفاً وضعها في الحقل بالأسفل.')),
      fieldsBox([
        { key: 'notifyEmail', type: 'text', label: 'البريد الذي تصل عليه رسائل العملاء', ltr: true }
      ], p, { noDirty: true, onChange: markPrivDirty }),
      h('div', { style: 'height:14px' }),
      fieldsBox([
        { key: 'user', type: 'text', label: 'حساب Gmail المرسِل', ltr: true },
        { key: 'pass', type: 'text', label: 'كلمة مرور التطبيقات (App Password)', ltr: true, placeholder: 'xxxx xxxx xxxx xxxx' },
        { key: 'host', type: 'text', label: 'خادم SMTP', ltr: true },
        { key: 'port', type: 'number', label: 'المنفذ (465)' },
        { key: 'fromName', type: 'text', label: 'اسم المرسِل', ltr: true }
      ], p.smtp, { noDirty: true, onChange: markPrivDirty }),
      h('div', { style: 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap' },
        h('button', { class: 'a-btn a-btn-primary', onclick: save }, ic('fa-solid fa-floppy-disk'), 'حفظ'),
        h('button', { class: 'a-btn', onclick: () => test('/api/admin/test-email', 'تم إرسال بريد تجريبي — افحص صندوق الوارد') }, ic('fa-solid fa-paper-plane'), 'إرسال بريد تجريبي'))));

    // 4) whatsapp fallback
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-brands fa-whatsapp'), 'إرسال الرسائل على واتساب رقم الشركة'),
      h('p', { class: 'desc' }, 'يرسل نص رسالة العميل تلقائياً إلى رقم واتساب الشركة (مثلاً عند فشل البريد). يعمل عبر خدمة CallMeBot المجانية.'),
      h('div', { class: 'alert info' }, ic('fa-solid fa-circle-info'), h('div', {}, h('b', {}, 'للحصول على المفتاح (مرة واحدة): '), 'من جوال الرقم ', h('b', { dir: 'ltr' }, '+966539759859'), ' احفظ الرقم ', h('b', { dir: 'ltr' }, '+34 644 59 71 67'), ' وأرسل له على واتساب: ', h('code', { dir: 'ltr' }, 'I allow callmebot to send me messages'), ' — سيصلك مفتاح API، ضعه بالأسفل. (إذا تغيّر رقم الخدمة راجع موقع callmebot.com)')),
      fieldsBox([
        { key: 'mode', type: 'select', label: 'متى يُرسل على واتساب؟', options: [['fallback', 'فقط إذا فشل البريد'], ['always', 'دائماً مع كل رسالة'], ['off', 'إيقاف']] },
        { key: 'phone', type: 'text', label: 'رقم الواتساب (دولي بدون +)', ltr: true },
        { key: 'apikey', type: 'text', label: 'مفتاح CallMeBot API', ltr: true }
      ], p.whatsapp, { noDirty: true, onChange: markPrivDirty }),
      h('div', { style: 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap' },
        h('button', { class: 'a-btn a-btn-primary', onclick: save }, ic('fa-solid fa-floppy-disk'), 'حفظ'),
        h('button', { class: 'a-btn', onclick: () => test('/api/admin/test-whatsapp', 'تم إرسال رسالة واتساب تجريبية') }, ic('fa-brands fa-whatsapp'), 'إرسال تجربة'))));

    // 5) completion email
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-circle-check'), 'رسالة "تم الإنجاز" للعميل'),
      h('p', { class: 'desc' }, 'عند تغيير حالة الرسالة إلى Completed يُرسل هذا البريد تلقائياً للعميل (بلغته) مع نسخة لبريد الشركة. استخدم {name} لاسم العميل و {machine} للماكينة.'),
      fieldsBox([
        { key: 'enabled', type: 'bool', label: 'تفعيل إرسال رسالة الإتمام', full: true },
        { key: 'subject', type: 'bi', label: 'عنوان الرسالة', full: true },
        { key: 'body', type: 'bitext', label: 'نص الرسالة' }
      ], p.completionEmail, { noDirty: true, onChange: markPrivDirty }),
      h('button', { class: 'a-btn a-btn-primary', style: 'margin-top:14px', onclick: save }, ic('fa-solid fa-floppy-disk'), 'حفظ')));
  }

  /* ---------- push subscription ---------- */
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (current === 'notify') render(); });
  let swReg = null;
  async function ensureSW() {
    if (!('serviceWorker' in navigator)) return null;
    if (!swReg) swReg = await navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' });
    return swReg;
  }
  const urlB64ToUint8 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); };
  async function renderPushStatus(box) {
    box.innerHTML = '';
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
      box.append(h('div', { class: 'alert warn', style: 'margin:0' }, ic('fa-solid fa-triangle-exclamation'), 'هذا المتصفح لا يدعم الإشعارات. على آيفون: ثبّت اللوحة على الشاشة الرئيسية أولاً ثم افتحها من الأيقونة.'));
      return;
    }
    if (!window.isSecureContext) { box.append(h('div', { class: 'alert warn', style: 'margin:0' }, ic('fa-solid fa-lock'), 'الإشعارات تتطلب أن يعمل الموقع على HTTPS (بعد النشر).')); return; }
    const reg = await ensureSW();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      box.append(h('div', { class: 'alert info', style: 'margin:0 0 12px' }, ic('fa-solid fa-bell'), 'الإشعارات مفعّلة على هذا الجهاز ✓'),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
          h('button', { class: 'a-btn', onclick: async () => { const r = await api('/api/admin/push/test', { method: 'POST' }); toast(`تم إرسال إشعار تجريبي إلى ${r.sent} من ${r.total} جهاز`); } }, ic('fa-solid fa-paper-plane'), 'إرسال إشعار تجريبي'),
          h('button', { class: 'a-btn a-btn-danger', onclick: async () => { await api('/api/admin/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); toast('تم إيقاف الإشعارات على هذا الجهاز'); renderPushStatus(box); } }, ic('fa-solid fa-bell-slash'), 'إيقاف على هذا الجهاز')));
    } else if (Notification.permission === 'denied') {
      box.append(h('div', { class: 'alert warn', style: 'margin:0' }, ic('fa-solid fa-bell-slash'), 'الإشعارات محظورة في إعدادات المتصفح لهذا الموقع. اسمح بها من إعدادات الموقع (رمز القفل بجانب العنوان) ثم أعد المحاولة.'));
    } else {
      box.append(h('button', { class: 'a-btn a-btn-primary', onclick: async () => {
        try {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') return toast('لم يتم السماح بالإشعارات', 'err');
          const { publicKey } = await api('/api/admin/push/key');
          const s = await (await ensureSW()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(publicKey) });
          const device = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone/iPad' : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows' : 'Device';
          await api('/api/admin/push/subscribe', { method: 'POST', body: { subscription: s.toJSON(), device } });
          toast('تم تفعيل الإشعارات على هذا الجهاز 🔔');
          renderPushStatus(box);
        } catch (e) { toast('تعذر التفعيل: ' + e.message, 'err'); }
      } }, ic('fa-solid fa-bell'), 'تفعيل الإشعارات على هذا الجهاز'));
    }
    try {
      const devs = await api('/api/admin/push/devices');
      if (devs.length) box.append(h('p', { class: 'desc', style: 'margin:14px 0 0' }, 'الأجهزة المفعّلة: ' + devs.map(d => `${d.device || 'جهاز'} (${new Date(d.date).toLocaleDateString('ar-EG')})`).join('، ')));
    } catch { /* */ }
  }

  /* ---------- live polling for new messages ---------- */
  let lastUnread = null;
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1320].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(.15, ctx.currentTime + i * .18); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + i * .18 + .25); o.start(ctx.currentTime + i * .18); o.stop(ctx.currentTime + i * .18 + .3); });
    } catch { /* */ }
  }
  async function poll() {
    if ($('#adminApp').hidden) return;
    try {
      const s = await api('/api/admin/messages/summary');
      if (lastUnread != null && s.unread > lastUnread) {
        beep();
        toast(`📩 رسالة جديدة من ${s.latest ? s.latest.name : ''}`);
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && !(swReg && await swReg.pushManager.getSubscription())) {
          new Notification('رسالة جديدة — ' + (s.latest ? s.latest.name : ''), { body: s.latest && s.latest.machine || '', icon: '/assets/img/icon-192.png' });
        }
        await loadMessages();
      }
      lastUnread = s.unread;
    } catch { /* */ }
  }
  setInterval(poll, 20000);

  let colSearch = '', colCat = '';
  function viewCollection(v, id) {
    const S = SCHEMAS[id];
    const arr = storeOf(S)[S.path] || (storeOf(S)[S.path] = []);
    const tools = h('div', { class: 'toolbar' }, h('button', { class: 'a-btn a-btn-primary', onclick: () => addItem(id) }, ic('fa-solid fa-plus'), 'إضافة ' + S.single));
    let list = arr.map((it, i) => [it, i]);
    if (S.search) {
      const s = h('input', { class: 'inp', type: 'search', placeholder: 'بحث بالاسم أو الموديل...' });
      s.value = colSearch;
      s.oninput = () => { colSearch = s.value; const pos = s.selectionStart; render(); const n = $('.toolbar input[type=search]'); n.focus(); n.setSelectionRange(pos, pos); };
      tools.append(s);
      const q = colSearch.trim().toLowerCase();
      if (q) list = list.filter(([it]) => [ar(it.name), it.name && it.name.en, it.model].join(' ').toLowerCase().includes(q));
    }
    if (S.filterCat) {
      const c = h('select', { onchange: () => { colCat = c.value; render(); } }, h('option', { value: '' }, 'كل الأقسام'), ...catOptions().map(([val, l]) => h('option', { value: val }, l)));
      c.value = colCat; tools.append(c);
      if (colCat) list = list.filter(([it]) => it.cat === colCat);
    }
    tools.append(h('span', { class: 'count' }, `${list.length} ${S.single}`));
    v.append(tools);
    if (!list.length) { v.append(h('div', { class: 'empty' }, ic(S.icon), h('p', {}, 'لا توجد عناصر بعد'))); return; }
    const filtered = list.length !== arr.length;
    v.append(h('div', { class: 'rows' }, ...list.map(([it, i]) => {
      const th = S.thumb && S.thumb(it);
      return h('div', { class: 'row-item' },
        h('div', { class: 'row-thumb' }, th ? h('img', { src: th, alt: '' }) : ic((S.thumbIcon && S.thumbIcon(it)) || S.icon)),
        h('div', { class: 'row-main', onclick: () => edit(id, i) }, h('b', {}, S.titleOf(it), ...(S.pills ? S.pills(it).map(([l, c]) => h('span', { class: 'pill ' + c }, l)) : [])), h('small', {}, (S.subOf && S.subOf(it)) || '')),
        h('div', { class: 'row-actions' },
          h('button', { class: 'a-icon-btn', title: 'لأعلى', disabled: filtered || i === 0 || null, onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; setDirty(); render(); } }, ic('fa-solid fa-arrow-up')),
          h('button', { class: 'a-icon-btn', title: 'لأسفل', disabled: filtered || i === arr.length - 1 || null, onclick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; setDirty(); render(); } }, ic('fa-solid fa-arrow-down')),
          h('button', { class: 'a-icon-btn', title: 'نسخ', onclick: () => { const c = clone(it); if (c.id) c.id = uid(id === 'categories' ? 'cat' : 'm'); arr.splice(i + 1, 0, c); setDirty(); toast('تم إنشاء نسخة'); render(); } }, ic('fa-regular fa-copy')),
          h('button', { class: 'a-icon-btn keep', title: 'تعديل', onclick: () => edit(id, i) }, ic('fa-solid fa-pen')),
          h('button', { class: 'a-icon-btn danger keep', title: 'حذف', onclick: () => {
            if (S.beforeDelete && !S.beforeDelete(it)) return;
            if (!S.beforeDelete && !confirm(`حذف "${S.titleOf(it)}"؟`)) return;
            arr.splice(i, 1); setDirty(); toast('تم الحذف — اضغط حفظ لتأكيد التغيير'); render();
          } }, ic('fa-solid fa-trash'))));
    })));
  }
  function addItem(id) {
    const S = SCHEMAS[id];
    const arr = storeOf(S)[S.path] || (storeOf(S)[S.path] = []);
    arr.unshift(S.newItem());
    setDirty();
    edit(id, 0);
  }
  function edit(id, index) { current = id; editing = { index }; location.hash = id; render(); }

  function viewEditor(v, id, index) {
    const S = SCHEMAS[id];
    const item = storeOf(S)[S.path][index];
    if (!item) { editing = null; return render(); }
    $('#pageTitle').textContent = `${labelOf(id)} › ${S.titleOf(item)}`;
    v.append(h('div', { class: 'editor-head' },
      h('button', { class: 'a-btn', onclick: () => { editing = null; render(); } }, ic('fa-solid fa-arrow-right'), 'رجوع للقائمة'),
      h('h3', {}, 'تعديل ' + S.single),
      id === 'machines' && item.id ? h('a', { class: 'a-btn a-btn-ghost', href: '/#/machine/' + encodeURIComponent(item.id), target: '_blank', rel: 'noopener', style: 'margin-inline-start:auto' }, ic('fa-solid fa-eye'), 'معاينة (بعد الحفظ)') : null));
    v.append(h('div', { class: 'card' }, fieldsBox(S.fields(), item)));
    if (S.after) v.append(S.after(item));
    v.append(h('div', { style: 'display:flex;gap:10px' },
      h('button', { class: 'a-btn a-btn-primary', onclick: async () => { await save(); } }, ic('fa-solid fa-floppy-disk'), 'حفظ'),
      h('button', { class: 'a-btn', onclick: () => { editing = null; render(); } }, 'رجوع للقائمة')));
  }

  function viewForm(v, id) {
    const F = FORMS[id];
    const obj = F.get();
    for (const [title, icon, desc, fields] of F.cards) {
      const card = h('div', { class: 'card' }, h('h3', {}, ic(icon), title), desc ? h('p', { class: 'desc' }, desc) : h('div', { style: 'height:12px' }));
      if (fields[0].type === '__colors') {
        obj.colors = obj.colors || {};
        card.append(fieldsBox([{ key: 'primary', type: 'color', label: 'اللون الأساسي (الكحلي)' }, { key: 'secondary', type: 'color', label: 'اللون الثانوي (الأزرق الملكي)' }, { key: 'accent', type: 'color', label: 'لون التمييز (الأزرق الفاتح)' }], obj.colors));
        card.append(h('button', { class: 'a-btn a-btn-sm', style: 'margin-top:14px', onclick: () => { obj.colors = { primary: '#0D3B66', secondary: '#1E5AA8', accent: '#3B82F6' }; setDirty(); render(); } }, ic('fa-solid fa-rotate-left'), 'استعادة ألوان الهوية الأصلية'));
      } else if (fields[0].type === '__announce') {
        obj.announcement = obj.announcement || { enabled: false, text: { ar: '', en: '' }, link: '' };
        card.append(fieldsBox([{ key: 'enabled', type: 'bool', label: 'إظهار شريط الإعلان' }, { key: 'link', type: 'text', label: 'رابط عند الضغط', ltr: true, hint: LINK_HINT }, { key: 'text', type: 'bi', label: 'نص الإعلان', full: true }], obj.announcement));
      } else card.append(fieldsBox(fields, obj));
      v.append(card);
    }
  }

  function viewSections(v) {
    content.sections = content.sections || {};
    v.append(h('div', { class: 'alert info' }, ic('fa-solid fa-circle-info'), 'تحكم في ظهور كل قسم بالصفحة الرئيسية وعنوانه ووصفه.'));
    for (const [key, label] of SECTION_KEYS) {
      const s = content.sections[key] || (content.sections[key] = { show: true, title: { ar: '', en: '' }, subtitle: { ar: '', en: '' } });
      v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-table-cells-large'), label), h('div', { style: 'height:12px' }),
        fieldsBox([{ key: 'show', type: 'bool', label: 'إظهار هذا القسم', full: true }, { key: 'title', type: 'bi', label: 'العنوان', full: true }, { key: 'subtitle', type: 'bi', label: 'الوصف', full: true }], s)));
    }
  }

  const MENU_KEYS = [['home', 'الرئيسية', 'Home', '#/'], ['machines', 'الماكينات', 'Machines', '#/machines'], ['markets', 'الأسواق', 'Markets', '#/markets'], ['services', 'خدماتنا', 'Services', '#/services'], ['about', 'من نحن', 'About', '#/about'], ['contact', 'تواصل معنا', 'Contact', '#/contact']];
  function viewMenu(v) {
    content.nav = content.nav || {};
    v.append(h('div', { class: 'alert info' }, ic('fa-solid fa-circle-info'), h('div', {}, 'غيّر اسم أي صفحة كما يظهر في القائمة العلوية والتذييل وعنوان الصفحة، أو أخفها من القائمة. الصفحات التي أضفتها بنفسك تُعدّل أسماؤها من قسم ', h('a', { href: '#pages', style: 'text-decoration:underline;font-weight:700', onclick: e => { e.preventDefault(); go('pages'); } }, 'الصفحات'), '. ثم اضغط حفظ التغييرات.')));
    for (const [key, arName, enName, link] of MENU_KEYS) {
      const n = content.nav[key] || (content.nav[key] = { label: { ar: arName, en: enName }, show: true });
      if (n.show == null) n.show = true;
      v.append(h('div', { class: 'card' },
        h('h3', {}, ic('fa-solid fa-file'), 'صفحة: ' + arName, h('a', { href: '/' + link, target: '_blank', rel: 'noopener', class: 'pill', style: 'margin-inline-start:auto', dir: 'ltr' }, link)),
        h('div', { style: 'height:12px' }),
        fieldsBox([{ key: 'label', type: 'bi', label: 'اسم الصفحة', full: true }, { key: 'show', type: 'bool', label: key === 'home' ? 'إظهار في القائمة' : 'إظهار في القائمة العلوية' }], n)));
    }
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-file-lines'), 'الصفحات المضافة'),
      h('p', { class: 'desc' }, (content.pages || []).length ? 'اضغط على أي صفحة لتعديل اسمها ومحتواها:' : 'لا توجد صفحات مضافة بعد.'),
      h('div', { class: 'rows' }, ...(content.pages || []).map((p, i) => h('div', { class: 'row-item', style: 'cursor:pointer', onclick: () => edit('pages', i) }, h('div', { class: 'row-thumb' }, ic('fa-solid fa-file-lines')), h('div', { class: 'row-main' }, h('b', {}, ar(p.title) || '(بدون عنوان)'), h('small', {}, p.showInNav ? 'ظاهرة في القائمة العلوية' : 'غير ظاهرة في القائمة'))))),
      h('button', { class: 'a-btn a-btn-primary', style: 'margin-top:12px', onclick: () => { current = 'pages'; addItem('pages'); } }, ic('fa-solid fa-plus'), 'إضافة صفحة جديدة')));
  }

  /* ---------- translation ---------- */
  async function translateText(text, from, to) {
    const r = await api('/api/admin/translate', { method: 'POST', body: { text, from, to } });
    return r.text || '';
  }
  // fills empty languages of a {ar,en,zh} object; returns number of filled entries
  async function autoTranslateBi(v) {
    let n = 0;
    if (!v.en && v.ar) { v.en = await translateText(v.ar, 'ar', 'en'); n++; }
    if (!v.ar && v.en) { v.ar = await translateText(v.en, 'en', 'ar'); n++; }
    if (!v.zh && (v.en || v.ar)) { v.zh = v.en ? await translateText(v.en, 'en', 'zh') : await translateText(v.ar, 'ar', 'zh'); n++; }
    return n;
  }
  function collectBi(root) {
    const out = [];
    (function walk(o) {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === 'object') {
        if ('ar' in o && 'en' in o && typeof o.ar === 'string') { out.push(o); return; }
        Object.values(o).forEach(walk);
      }
    })(root);
    return out;
  }
  function viewTranslate(v) {
    const all = collectBi(content).filter(o => (o.ar || o.en || o.zh));
    const missZh = all.filter(o => !o.zh).length, missEn = all.filter(o => !o.en).length, missAr = all.filter(o => !o.ar).length;
    v.append(h('div', { class: 'alert info' }, ic('fa-solid fa-language'), h('div', {}, 'الموقع يعمل بثلاث لغات: ', h('b', {}, 'العربية، English، 中文'), '. كل نص في لوحة التحكم له ثلاث خانات، وبجانب كل نص زر ', h('b', {}, '"ترجمة"'), ' يملأ الخانات الفارغة تلقائياً. الترجمة الآلية تتم عبر خدمة MyMemory المجانية — راجعها دائماً قبل الحفظ.')));
    const prog = h('div', { class: 'desc', style: 'margin:10px 0 0' });
    const runBtn = h('button', { class: 'a-btn a-btn-primary', onclick: async () => {
      const todo = collectBi(content).filter(o => (o.ar || o.en) && (!o.zh || !o.en || !o.ar));
      if (!todo.length) return toast('كل النصوص مترجمة ✓');
      if (!confirm('سيتم ترجمة ' + todo.length + ' نص تلقائياً. قد يستغرق ذلك بضع دقائق. متابعة؟')) return;
      runBtn.disabled = true; let done = 0, fail = 0;
      for (const o of todo) {
        try { await autoTranslateBi(o); setDirty(); } catch (e) { fail++; if (/quota|limit|429/i.test(e.message)) { toast('تم الوصول للحد اليومي للترجمة المجانية — أكمل غداً', 'err'); break; } }
        done++; prog.textContent = 'جارٍ الترجمة: ' + done + ' / ' + todo.length + (fail ? ' (فشل ' + fail + ')' : '');
      }
      runBtn.disabled = false; toast('انتهت الترجمة — راجع النصوص ثم اضغط حفظ التغييرات'); render();
    } }, ic('fa-solid fa-wand-magic-sparkles'), 'ترجمة كل النصوص الناقصة تلقائياً');
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-chart-pie'), 'حالة ترجمة محتوى الموقع'),
      h('div', { class: 'kpis', style: 'margin:14px 0' },
        h('div', { class: 'kpi' }, ic('fa-solid fa-file-lines'), h('div', {}, h('b', {}, String(all.length)), h('span', {}, 'نص في الموقع'))),
        h('div', { class: 'kpi' }, ic('fa-solid fa-language'), h('div', {}, h('b', {}, String(missZh)), h('span', {}, 'ناقص بالصينية 中文'))),
        h('div', { class: 'kpi' }, ic('fa-solid fa-language'), h('div', {}, h('b', {}, String(missEn)), h('span', {}, 'ناقص بالإنجليزية'))),
        h('div', { class: 'kpi' }, ic('fa-solid fa-language'), h('div', {}, h('b', {}, String(missAr)), h('span', {}, 'ناقص بالعربية')))),
      runBtn, prog));

    // interface texts
    content.ui = content.ui || {};
    const UI = window.SM_UI || {};
    const q = h('input', { class: 'inp', type: 'search', placeholder: 'بحث في نصوص الواجهة...', style: 'max-width:320px;margin-bottom:12px' });
    const box = h('div', { class: 'ui-table' });
    const renderRows = () => {
      box.innerHTML = '';
      const s = q.value.trim().toLowerCase();
      Object.keys(UI).filter(k => !s || [k, UI[k].ar, UI[k].en, UI[k].zh].join(' ').toLowerCase().includes(s)).forEach(k => {
        const o = content.ui[k] || {};
        const cell = (l) => {
          const el = h('input', { class: 'inp', dir: l === 'ar' ? 'rtl' : 'ltr', placeholder: UI[k][l] || '' });
          el.value = o[l] != null ? o[l] : (UI[k][l] || '');
          el.oninput = () => {
            content.ui[k] = content.ui[k] || {};
            if (el.value === (UI[k][l] || '')) delete content.ui[k][l]; else content.ui[k][l] = el.value;
            if (!Object.keys(content.ui[k]).length) delete content.ui[k];
            setDirty();
          };
          return h('div', {}, h('span', { class: 'lang-tag' }, { ar: 'عربي', en: 'EN', zh: '中文' }[l]), el);
        };
        box.append(h('div', { class: 'ui-row' }, h('small', { class: 'ui-key', dir: 'ltr' }, k), h('div', { class: 'bi bi3' }, cell('ar'), cell('en'), cell('zh'))));
      });
    };
    q.oninput = renderRows;
    renderRows();
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-font'), 'نصوص الواجهة (الأزرار والعناوين الثابتة)'),
      h('p', { class: 'desc' }, 'هذه النصوص الثابتة في الموقع مثل "اطلب عرض سعر" و"إرسال" و"المواصفات الفنية". عدّل أي ترجمة ثم اضغط حفظ التغييرات. لإرجاع النص الأصلي امسح الخانة واكتب النص الأصلي الظاهر بلون باهت.'),
      q, box));
  }

  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
  }
  function viewBackup(v) {
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-download'), 'تنزيل نسخة احتياطية'),
      h('p', { class: 'desc' }, 'احفظ ملفاً بكل محتوى الموقع (النصوص والإعدادات وروابط الصور). يُنصح بتنزيل نسخة دورياً. ملاحظة: الصور نفسها محفوظة في مجلد uploads على السيرفر.'),
      h('button', { class: 'a-btn a-btn-primary', onclick: () => download(`suzhou-manhal-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(content, null, 2), 'application/json') }, ic('fa-solid fa-download'), 'تنزيل النسخة')));
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-upload'), 'استعادة من نسخة احتياطية'),
      h('p', { class: 'desc' }, 'اختر ملف نسخة احتياطية (JSON) لاستبدال المحتوى الحالي. لن يتم التطبيق إلا بعد الضغط على حفظ.'),
      h('button', { class: 'a-btn', onclick: async () => {
        const [f] = await pickFiles('application/json,.json');
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (!data || !data.settings) throw new Error('الملف غير صالح');
          content = data; setDirty(); toast('تم تحميل النسخة — اضغط حفظ للتطبيق'); render();
        } catch (e) { toast(e.message || 'ملف غير صالح', 'err'); }
      } }, ic('fa-solid fa-upload'), 'اختيار ملف')));
    v.append(h('div', { class: 'card' }, h('h3', {}, ic('fa-solid fa-rotate-left'), 'استعادة المحتوى الافتراضي'),
      h('p', { class: 'desc' }, 'إرجاع الموقع للمحتوى الأصلي الذي تم تسليمه. يتم حفظ نسخة من المحتوى الحالي على السيرفر قبل الاستعادة (مجلد data/backups).'),
      h('button', { class: 'a-btn a-btn-danger', onclick: async () => {
        if (!confirm('هل أنت متأكد؟ سيتم استبدال كل المحتوى الحالي بالمحتوى الافتراضي.')) return;
        try { await api('/api/admin/reset', { method: 'POST' }); content = await (await fetch('/api/content', { cache: 'no-store' })).json(); contentSnap = JSON.stringify(content); setDirty(false); toast('تمت الاستعادة'); render(); } catch (e) { toast(e.message, 'err'); }
      } }, ic('fa-solid fa-rotate-left'), 'استعادة الافتراضي')));
  }

  function viewSecurity(v) {
    const cur = h('input', { class: 'inp', type: 'password', dir: 'ltr', autocomplete: 'current-password' });
    const n1 = h('input', { class: 'inp', type: 'password', dir: 'ltr', autocomplete: 'new-password' });
    const n2 = h('input', { class: 'inp', type: 'password', dir: 'ltr', autocomplete: 'new-password' });
    v.append(h('div', { class: 'card', style: 'max-width:560px' }, h('h3', {}, ic('fa-solid fa-lock'), 'تغيير كلمة المرور'),
      h('p', { class: 'desc' }, 'استخدم كلمة مرور قوية (8 أحرف على الأقل، تجمع بين حروف وأرقام ورموز). سيتم تسجيل خروج أي جهاز آخر.'),
      h('div', { class: 'fields', style: 'grid-template-columns:1fr' },
        h('div', { class: 'f' }, h('label', {}, 'كلمة المرور الحالية'), cur),
        h('div', { class: 'f' }, h('label', {}, 'كلمة المرور الجديدة'), n1),
        h('div', { class: 'f' }, h('label', {}, 'تأكيد كلمة المرور الجديدة'), n2)),
      h('button', { class: 'a-btn a-btn-primary', style: 'margin-top:16px', onclick: async () => {
        if (n1.value.length < 8) return toast('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل', 'err');
        if (n1.value !== n2.value) return toast('كلمتا المرور غير متطابقتين', 'err');
        try { await api('/api/admin/password', { method: 'POST', body: { current: cur.value, next: n1.value } }); isDefaultPw = false; cur.value = n1.value = n2.value = ''; toast('تم تغيير كلمة المرور بنجاح'); }
        catch (e) { toast(e.message === 'Current password is wrong' ? 'كلمة المرور الحالية غير صحيحة' : e.message, 'err'); }
      } }, ic('fa-solid fa-key'), 'تغيير كلمة المرور')));
  }

  /* ---------- save / load ---------- */
  async function save() {
    if (privDirty && privSaver) { const ok = await privSaver(); if (!ok || !dirty) return; }
    if (!dirty) { toast('لا توجد تغييرات'); return; }
    const btn = $('#saveBtn'); btn.disabled = true;
    const opsNow = JSON.stringify(ops), contentNow = JSON.stringify(content);
    try {
      if (opsNow !== opsSnap) { await api('/api/admin/ops', { method: 'PUT', body: ops }); opsSnap = opsNow; }
      if (contentNow !== contentSnap) { await api('/api/admin/content', { method: 'PUT', body: content }); contentSnap = contentNow; }
      setDirty(false); toast('تم الحفظ — التعديلات ظاهرة في الموقع الآن');
    } catch (e) { btn.disabled = false; toast(trErr(e.message), 'err'); }
  }
  async function loadMessages(rerender) {
    try { messages = await api('/api/admin/messages'); } catch { messages = []; }
    lastUnread = messages.filter(x => !x.read).length;
    renderNav();
    if (rerender || (current === 'messages' && !openMsg) || current === 'dashboard') render();
  }
  function applyHash() {
    const hs = location.hash.slice(1);
    const [sec, sub] = hs.split('/');
    if (sec === 'messages' && sub) { current = 'messages'; openMsg = sub; return true; }
    if (sec && (SCHEMAS[sec] || FORMS[sec] || ['dashboard', 'messages', 'stats', 'notify', 'sections', 'menu', 'translate', 'backup', 'security'].includes(sec))) { current = sec; openMsg = null; return true; }
    return false;
  }
  async function boot() {
    content = await (await fetch('/api/content', { cache: 'no-store' })).json();
    // migrate old fields
    if (content.settings) delete content.settings.brandLine2;
    contentSnap = JSON.stringify(content);
    try { const o = await api('/api/admin/ops'); ops = { suppliers: o.suppliers || [], shipments: o.shipments || [], comparisons: o.comparisons || [] }; opsSnap = JSON.stringify(ops); } catch { /* keep empty */ }
    $('#login').hidden = true; $('#adminApp').hidden = false;
    applyHash();
    api('/api/admin/private').then(p => { privateCfg = p; if (current === 'dashboard') render(); }).catch(() => {});
    ensureSW().catch(() => {});
    await loadMessages();
    render();
    if (openMsg) openMessage(openMsg);
  }
  // open a message when the service worker (notification click) asks us
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.url) { location.hash = e.data.url.split('#')[1] || 'messages'; loadMessages().then(() => { applyHash(); openMsg ? openMessage(openMsg) : render(); }); }
  });
  function showLogin() {
    $('#adminApp').hidden = true; $('#login').hidden = false;
    setTimeout(() => $('#pw').focus(), 50);
  }

  /* ---------- events ---------- */
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#loginErr'); err.textContent = '';
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { err.textContent = r.status === 401 ? 'كلمة المرور غير صحيحة' : r.status === 429 ? 'محاولات كثيرة، حاول بعد 15 دقيقة' : (d.error || 'خطأ'); return; }
      isDefaultPw = d.isDefault; $('#pw').value = '';
      await boot();
    } catch { err.textContent = 'تعذر الاتصال بالسيرفر'; }
  });
  document.addEventListener('click', e => {
    const eye = e.target.closest('[data-eye]');
    if (eye) { const i = $('#pw'); i.type = i.type === 'password' ? 'text' : 'password'; }
    if (e.target.closest('[data-side-open]')) document.body.classList.add('side-open');
    if (e.target.closest('[data-side-close]')) document.body.classList.remove('side-open');
  });
  $('#saveBtn').addEventListener('click', save);
  $('#logoutBtn').addEventListener('click', async () => {
    if (dirty && !confirm('لديك تغييرات غير محفوظة. هل تريد الخروج بدون حفظ؟')) return;
    await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setDirty(false); showLogin();
  });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!$('#adminApp').hidden) save(); } });
  window.addEventListener('beforeunload', e => { if (dirty || privDirty) { e.preventDefault(); e.returnValue = ''; } });

  fetch('/api/session').then(r => r.json()).then(s => { isDefaultPw = s.isDefault; s.authed ? boot() : showLogin(); }).catch(showLogin);
})();
