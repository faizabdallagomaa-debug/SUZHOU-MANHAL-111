/* Suzhou Manhal — public site (multilingual SPA: Arabic / English / Chinese) */
(function () {
  'use strict';
  const C = window.__CONTENT__ || {};
  const S = C.settings || {};
  const CT = C.contact || {};
  const app = document.getElementById('app');

  const LANGS = window.SM_LANGS || [{ code: 'ar', name: 'العربية', short: 'ع', dir: 'rtl' }, { code: 'en', name: 'English', short: 'EN', dir: 'ltr' }];
  const CODES = LANGS.map(l => l.code);
  let lang = (() => { try { return localStorage.getItem('sm_lang'); } catch { return null; } })() || S.defaultLang || 'ar';
  if (!CODES.includes(lang)) lang = 'ar';
  const UI = window.SM_UI || {};
  // overrides from Admin › Translation — interface words never need markup, so strip anything that could form a tag or break an attribute
  const UIO = {};
  Object.entries(C.ui || {}).forEach(([k, o]) => { if (o && typeof o === 'object') { UIO[k] = {}; Object.entries(o).forEach(([l, v]) => { UIO[k][l] = String(v == null ? '' : v).replace(/[<>"`]/g, ''); }); } });
  const u = k => { const o = UIO[k], d = UI[k]; return (o && o[lang]) || (d && d[lang]) || (o && (o.en || o.ar)) || (d && (d.en || d.ar)) || k; };
  const t = v => (v == null ? '' : typeof v === 'string' || typeof v === 'number' ? String(v) : v[lang] || (lang === 'ar' ? v.en : v.en || v.ar) || v.ar || '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tx = v => esc(t(v));
  /* Rich text: paragraphs, "•"/"-" bullet lists, **bold** */
  function rich(v) {
    const lines = esc(t(v)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
    let out = '', list = false, para = [];
    const flush = () => { if (para.length) { out += `<p>${para.join('<br>')}</p>`; para = []; } };
    for (const raw of lines) {
      const l = raw.trim();
      const m = l.match(/^(?:•|-|\*|–)\s+(.*)$/);
      if (m) { flush(); if (!list) { out += '<ul>'; list = true; } out += `<li><span>${m[1]}</span></li>`; continue; }
      if (list) { out += '</ul>'; list = false; }
      if (!l) flush(); else para.push(l);
    }
    if (list) out += '</ul>';
    flush();
    return `<div class="rich">${out}</div>`;
  }
  const safeUrl = url => {
    const s = String(url || '').trim();
    if (!s) return '#';
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(s)) return s;
    if (/^[\w.-]+\.[a-z]{2,}/i.test(s)) return 'https://' + s;
    return '#';
  };
  // a URL placed inside CSS url('…'): only http(s) or site paths, and no characters that could close the string
  const cssUrl = s => { const v = safeUrl(s); return v === '#' ? '' : v.replace(/['"()\\\s]/g, encodeURIComponent); };
  const icon = cls => `<i class="${esc(cls || 'fa-solid fa-circle')}" aria-hidden="true"></i>`;
  const digits = s => String(s || '').replace(/[^\d]/g, '');
  function waLink(extra) {
    const msg = (t(CT.whatsappMessage) + (extra ? ' ' + extra : '')).trim();
    return `https://wa.me/${digits(CT.whatsapp)}${msg ? '?text=' + encodeURIComponent(msg) : ''}`;
  }
  const linkOf = l => (l === 'whatsapp' ? waLink() : safeUrl(l));
  const extAttr = l => (/^https?:/i.test(l) ? ' target="_blank" rel="noopener"' : '');
  const cats = C.categories || [];
  const machines = C.machines || [];
  const markets = C.markets || [];
  const pages = C.pages || [];
  const catById = id => cats.find(c => c.id === id);
  const machineCount = id => machines.filter(m => m.cat === id).length;
  const logo = S.logo || '/assets/img/logo-mark.png';
  const logoWhite = S.logoWhite || logo;
  const flag = (code, w = 80) => code ? `<img src="https://flagcdn.com/w${w}/${esc(String(code).toLowerCase())}.png" srcset="https://flagcdn.com/w${w * 2}/${esc(String(code).toLowerCase())}.png 2x" alt="" loading="lazy">` : '';
  const arrow = `<i class="fa-solid fa-arrow-left flip-x" aria-hidden="true"></i>`;
  const tel = n => 'tel:' + String(n || '').replace(/[^\d+]/g, '');

  if (S.colors) {
    const r = document.documentElement.style;
    ['primary', 'secondary', 'accent'].forEach(k => S.colors[k] && r.setProperty('--' + k, S.colors[k]));
  }

  /* ---------- layout ---------- */
  const brandHTML = (white) => `<a href="#/" class="brand" aria-label="${tx(S.siteName)}">
      <img src="${esc(white ? logoWhite : logo)}" alt="">
      <span class="brand-text"><span class="brand-en">${esc(S.brandLine1 || 'SUZHOU MANHAL')}</span><span class="brand-ar">${esc((S.siteName && (lang === 'zh' ? S.siteName.zh : S.siteName.ar)) || 'سوجو منهل')}</span></span></a>`;
  const socialsHTML = () => (C.socials || []).filter(s => s.show && s.url).map(s => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener" aria-label="${esc(s.platform)}">${icon(s.icon)}</a>`).join('');
  function navItems() {
    const items = [['#/', 'home'], ['#/machines', 'machines'], ['#/markets', 'markets'], ['#/services', 'services'], ['#/about', 'about']];
    const list = items.filter(([, k]) => navShown(k)).map(([h, k]) => [h, navLabel(k)]);
    pages.filter(p => p.showInNav && p.slug).forEach(p => list.push(['#/page/' + encodeURIComponent(p.slug), t(p.title)]));
    if (navShown('contact')) list.push(['#/contact', navLabel('contact')]);
    return list;
  }
  /* page names editable from admin (content.nav) */
  function navLabel(k) { const n = (C.nav || {})[k]; return (n && t(n.label)) || u(k); }
  function navShown(k) { const n = (C.nav || {})[k]; return !n || n.show !== false; }
  function pageTitle(k, fallbackKey) { const n = (C.nav || {})[k]; const custom = n && t(n.label); return custom && custom !== u(k) ? custom : u(fallbackKey || k); }

  function shell() {
    const ann = S.announcement && S.announcement.enabled && t(S.announcement.text);
    const nav = navItems();
    app.innerHTML = `
      <a class="skip-link" href="#main" data-skip>${u('skip')}</a>
      ${ann ? `<div style="background:var(--primary);color:#fff;text-align:center;font-size:.85rem;padding:7px 16px;font-weight:600;position:relative;z-index:51"><a href="${esc(linkOf(S.announcement.link))}">${esc(ann)}</a></div>` : ''}
      <div class="header-wrap" id="hwrap"><div class="container"><header class="header">
        ${brandHTML()}
        <nav class="nav" aria-label="main">${nav.map(([h, l]) => `<a href="${h}" data-nav="${h}">${esc(l)}</a>`).join('')}</nav>
        <div class="header-actions">
          <div class="lang-wrap"><button class="icon-btn" data-langmenu aria-label="language">${esc((LANGS.find(l => l.code === lang) || LANGS[0]).short)}</button><div class="lang-pop">${LANGS.map(l => `<button data-setlang="${l.code}" class="${l.code === lang ? 'on' : ''}">${esc(l.name)}</button>`).join('')}</div></div>
          <a href="#/contact" class="btn btn-primary btn-sm hide-sm" style="height:44px">${u('quote')}</a>
          <button class="icon-btn menu-btn" data-menu aria-label="${u('menu')}">${icon('fa-solid fa-bars')}</button>
        </div>
      </header></div></div>
      <div class="drawer-back" data-close></div>
      <aside class="drawer" aria-label="${u('menu')}">
        <div class="drawer-head">${brandHTML()}<button class="icon-btn" data-close aria-label="close">${icon('fa-solid fa-xmark')}</button></div>
        ${nav.map(([h, l]) => `<a href="${h}" class="navlink" data-nav="${h}">${esc(l)}</a>`).join('')}
        <a href="#/contact" class="btn btn-primary" style="margin-top:14px">${u('quote')}</a>
        ${CT.whatsapp ? `<a href="${esc(waLink())}" target="_blank" rel="noopener" class="btn btn-wa" style="margin-top:8px">${icon('fa-brands fa-whatsapp')} ${u('whatsapp')}</a>` : ''}
        <div class="lang-row">${LANGS.map(l => `<button class="btn btn-sm ${l.code === lang ? 'btn-primary' : 'btn-outline'}" data-setlang="${l.code}">${esc(l.name)}</button>`).join('')}</div>
        <div class="socials" style="margin-top:16px">${socialsHTML()}</div>
      </aside>
      <main id="main" tabindex="-1"></main>
      ${footerHTML()}
      ${CT.floatingWhatsapp !== false && CT.whatsapp ? `<a class="fab-wa" href="${esc(waLink())}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('fa-brands fa-whatsapp')}</a>` : ''}
      <button class="to-top" aria-label="top">${icon('fa-solid fa-arrow-up')}</button>
      <div class="cmp-bar" id="cmpBar" hidden><span>${icon('fa-solid fa-scale-balanced')} ${u('compareTitle')} (<b data-cmp-count>0</b>)</span>
        <a class="btn btn-primary btn-sm" href="#/compare">${u('compareNow')}</a><button type="button" class="cmp-x" data-cmp-clear aria-label="${u('compareClear')}">${icon('fa-solid fa-xmark')}</button></div>
      <nav class="m-bar" aria-label="${u('quickLinks')}">
        ${(CT.phones || [])[0] ? `<a href="${tel(CT.phones[0].number)}">${icon('fa-solid fa-phone')}<span>${u('call')}</span></a>` : ''}
        ${CT.whatsapp ? `<a class="wa" href="${esc(waLink())}" target="_blank" rel="noopener">${icon('fa-brands fa-whatsapp')}<span>${u('whatsapp')}</span></a>` : ''}
        <a class="q" href="#/contact">${icon('fa-solid fa-file-invoice')}<span>${u('quote')}</span></a>
      </nav>`;
    updateClocks();
  }

  function footerHTML() {
    const socials = (C.socials || []).filter(s => s.show && s.url);
    return `<footer class="footer footer-simple">
      <div class="container">
        <div class="footer-grid">
          <div class="f-brand">
            <div style="margin-bottom:14px">${brandHTML(true)}</div>
            <p class="f-tag">${tx(S.tagline)}</p>
            ${socials.length ? `<div class="f-social-icons">${socials.map(s => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener" class="sc-${esc(s.platform)}" aria-label="${esc(s.platform)}">${icon(s.icon)}</a>`).join('')}</div>` : ''}
          </div>
          <div><h4>${u('quickLinks')}</h4><ul>${navItems().map(([h, l]) => `<li><a href="${h}">${esc(l)}</a></li>`).join('')}
            ${pages.filter(p => p.showInFooter && !p.showInNav && p.slug).map(p => `<li><a href="#/page/${encodeURIComponent(p.slug)}">${tx(p.title)}</a></li>`).join('')}</ul>
            <button class="admin-btn" data-admin type="button" title="3×">${icon('fa-solid fa-lock')} ${u('adminBtn')}</button></div>
          <div><h4>${u('contactInfo')}</h4><ul class="f-contact">
            ${(CT.phones || []).map(p => `<li>${icon('fa-solid fa-phone')}<a class="ltr" href="${tel(p.number)}">${esc(p.number)}</a></li>`).join('')}
            ${(CT.emails || []).map(e => `<li>${icon('fa-regular fa-envelope')}<a href="mailto:${esc(e.value)}">${esc(e.value)}</a></li>`).join('')}
            ${(CT.offices || []).map(o => `<li>${icon('fa-solid fa-location-dot')}<span>${tx(o.name)}</span></li>`).join('')}
          </ul></div>
        </div>
        <div class="footer-bottom">
          <span>${tx(S.copyright)} ${new Date().getFullYear()}</span>
          <span class="f-langs">${LANGS.map(l => `<button data-setlang="${l.code}" class="${l.code === lang ? 'on' : ''}">${esc(l.name)}</button>`).join('')}</span>
        </div>
      </div>
    </footer>`;
  }
  function updateClocks() {
    const loc = lang === 'ar' ? 'ar-SA-u-nu-latn' : lang === 'zh' ? 'zh-CN' : 'en-GB';
    document.querySelectorAll('[data-tz]').forEach(el => {
      try { el.textContent = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: el.dataset.tz }).format(new Date()); } catch { /* old browser */ }
    });
  }
  setInterval(updateClocks, 30000);

  /* ---------- components ---------- */
  function media(m) {
    const img = (m.images || [])[0];
    const c = catById(m.cat);
    if (img) return `<img src="${esc(img)}" alt="${tx(m.name)}" loading="lazy">`;
    return `<div class="ph">${icon(c ? c.icon : 'fa-solid fa-industry')}<img class="ph-logo" src="${esc(logo)}" alt=""></div>`;
  }
  const store = {
    get(k) { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v.filter(id => machines.some(m => m.id === id)) : []; } catch { return []; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
  };
  const cmpList = () => store.get('sm_cmp');
  function toggleCompare(id) {
    let l = cmpList();
    if (l.includes(id)) l = l.filter(x => x !== id);
    else { if (l.length >= 3) l.shift(); l.push(id); }
    store.set('sm_cmp', l);
    document.querySelectorAll('[data-cmp]').forEach(b => b.classList.toggle('on', l.includes(b.dataset.cmp)));
    updateCmpBar();
  }
  function updateCmpBar() {
    const bar = document.getElementById('cmpBar'); if (!bar) return;
    const l = cmpList();
    bar.hidden = !l.length || location.hash.startsWith('#/compare');
    bar.querySelector('[data-cmp-count]').textContent = l.length;
  }
  function addRecent(id) { store.set('sm_recent', [id, ...store.get('sm_recent').filter(x => x !== id)].slice(0, 8)); }

  function machineCard(m) {
    const c = catById(m.cat);
    const href = `#/machine/${encodeURIComponent(m.id)}`;
    return `<article class="m-card reveal">
      <a href="${href}" class="m-media"><div class="m-badges">${t(m.badge) ? `<span class="badge hot">${tx(m.badge)}</span>` : '<span></span>'}${m.model ? `<span class="badge dark">${esc(m.model)}</span>` : ''}</div>${media(m)}</a>
      <div class="m-body">
        ${c ? `<span class="m-cat">${tx(c.name)}</span>` : ''}
        <h3><a href="${href}">${tx(m.name)}</a></h3>
        ${t(m.capacity) ? `<div class="m-cap">${icon('fa-solid fa-gauge-high')}<span>${tx(m.capacity)}</span></div>` : ''}
        <div class="m-actions"><a href="${href}" class="btn btn-outline btn-sm">${u('details')} ${arrow}</a>
          <button type="button" class="cmp-btn ${cmpList().includes(m.id) ? 'on' : ''}" data-cmp="${esc(m.id)}" title="${u('compareAdd')}" aria-label="${u('compareAdd')}">${icon('fa-solid fa-scale-balanced')}</button>
          <a href="${esc(waLink(t(m.name) + (m.model ? ' (' + m.model + ')' : '')))}" target="_blank" rel="noopener" class="wa-round" aria-label="WhatsApp">${icon('fa-brands fa-whatsapp')}</a></div>
      </div></article>`;
  }
  const secOn = k => !C.sections || !C.sections[k] || C.sections[k].show !== false;
  const sec = k => (C.sections || {})[k] || {};
  function head(s, opts = {}) {
    return `<div class="sec-head ${opts.center ? 'center' : ''} reveal"><div class="txt">
      <span class="eyebrow">${icon(opts.icon || 'fa-solid fa-circle')} ${esc(opts.eyebrow || S.brandLine1 || '')}</span>
      <h2>${tx(s.title)}</h2>${t(s.subtitle) ? `<p>${tx(s.subtitle)}</p>` : ''}</div>${opts.right || ''}</div>`;
  }
  function searchForm(selCat, q) {
    return `<form class="search-form" data-search>
      <select name="cat" aria-label="${u('allCats')}"><option value="">${u('allCats')}</option>${cats.map(c => `<option value="${esc(c.id)}" ${c.id === selCat ? 'selected' : ''}>${tx(c.name)}</option>`).join('')}</select>
      <input name="q" type="search" value="${esc(q || '')}" placeholder="${u('searchPh')}" aria-label="${u('search')}">
      <button class="btn btn-primary btn-sm" type="submit">${icon('fa-solid fa-magnifying-glass')} ${u('search')}</button></form>`;
  }
  function quoteForm(prefill) {
    return `<form class="form" data-quote novalidate>
      <div class="field"><label>${u('name')} *</label><input name="name" required autocomplete="name"></div>
      <div class="field"><label>${u('company')}</label><input name="company" autocomplete="organization"></div>
      <div class="field"><label>${u('phone')} *</label><input name="phone" type="tel" dir="ltr" autocomplete="tel" placeholder="+966 5x xxx xxxx"></div>
      <div class="field"><label>${u('email')}</label><input name="email" type="email" dir="ltr" autocomplete="email"></div>
      <div class="field"><label>${u('country')}</label><select name="country"><option value="">${u('select')}</option>${markets.map(m => `<option>${tx(m.name)}</option>`).join('')}<option>${u('other')}</option></select></div>
      <div class="field"><label>${u('interest')}</label><input name="machine" value="${esc(prefill || '')}"></div>
      <div class="field full"><label>${u('message')}</label><textarea name="message"></textarea></div>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="form-msg" role="status"></div>
      <div class="full" style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" type="submit">${icon('fa-solid fa-paper-plane')} ${u('send')}</button>
        ${CT.whatsapp ? `<a class="btn btn-wa" href="${esc(waLink(prefill || ''))}" target="_blank" rel="noopener">${icon('fa-brands fa-whatsapp')} ${u('whatsapp')}</a>` : ''}
      </div></form>`;
  }
  function ctaHTML() {
    if (!secOn('cta')) return '';
    const s = sec('cta');
    return `<section class="cta"><div class="container"><div class="cta-box reveal">
      <div><h2>${tx(s.title)}</h2><p>${tx(s.subtitle)}</p></div>
      <div class="actions">${CT.whatsapp ? `<a href="${esc(waLink())}" target="_blank" rel="noopener" class="btn btn-wa">${icon('fa-brands fa-whatsapp')} ${u('talkExpert')}</a>` : ''}<a href="#/contact" class="btn btn-light">${u('quote')}</a></div>
    </div></div></section>`;
  }
  function pageHero(title, lead, crumbs) {
    return `<section class="page-hero"><div class="container">
      <div class="crumbs"><a href="#/">${navLabel('home')}</a>${(crumbs || []).map(c => `<span>/</span>${c[1] ? `<a href="${c[1]}">${esc(c[0])}</a>` : `<span>${esc(c[0])}</span>`}`).join('')}</div>
      <h1>${esc(title)}</h1>${lead ? `<p>${esc(lead)}</p>` : ''}</div></section>`;
  }

  /* ---------- sections ---------- */
  function heroHTML() {
    const slides = C.hero || [];
    const firstWord = s => { const w = t(s).split(' '); return w.length > 3 ? `${esc(w.slice(0, -2).join(' '))} <span class="grad">${esc(w.slice(-2).join(' '))}</span>` : esc(t(s)); };
    const isBg = sl => sl.image && sl.imageAsBackground, isPhoto = sl => sl.image && !sl.imageAsBackground;
    return `<section class="hero hero3d" id="hero3d">
      <div class="hero-bgs">${slides.map((sl, i) => isBg(sl) ? `<div class="hero-bg ${i === 0 ? 'active' : ''}" data-slide="${i}" style="background-image:url('${esc(cssUrl(sl.image))}')"></div>` : '').join('')}</div>
      <div class="container hero-grid">
        <div class="hero-text">
          ${slides.map((sl, i) => `<div class="hero-slide ${i === 0 ? 'active' : ''}" data-slide="${i}" data-photo="${isPhoto(sl) ? 1 : ''}" data-bg="${isBg(sl) ? 1 : ''}">
            ${t(sl.badge) ? `<span class="kicker">${tx(sl.badge)}</span>` : ''}
            <h1>${firstWord(sl.title)}</h1>
            <p class="lead">${tx(sl.subtitle)}</p>
            <div class="hero-actions">
              ${t(sl.btn1Text) ? `<a class="btn btn-accent" href="${esc(linkOf(sl.btn1Link))}"${extAttr(linkOf(sl.btn1Link))}>${tx(sl.btn1Text)} ${arrow}</a>` : ''}
              ${t(sl.btn2Text) ? `<a class="btn btn-glass" href="${esc(linkOf(sl.btn2Link))}"${extAttr(linkOf(sl.btn2Link))}>${sl.btn2Link === 'whatsapp' ? icon('fa-brands fa-whatsapp') : ''} ${tx(sl.btn2Text)}</a>` : ''}
            </div>
          </div>`).join('')}
          ${slides.length > 1 ? `<div class="hero-dots">${slides.map((_, k) => `<button class="${k === 0 ? 'active' : ''}" data-dot="${k}" aria-label="slide ${k + 1}"></button>`).join('')}</div>` : ''}
        </div>
        <div class="globe-slot" id="globeSlot">
          ${slides.map((sl, i) => isPhoto(sl) ? `<img class="slot-photo ${i === 0 ? 'active' : ''}" data-slide="${i}" src="${esc(sl.image)}" alt="">` : '').join('')}
          <div class="globe-fallback"><img src="${esc(logoWhite)}" alt=""></div>
        </div>
      </div>
      <svg class="hero-wave" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true">
        <path class="w1" d="M0 40C240 90 480 0 720 30s480 70 720 10v80H0z"/>
        <path class="w2" d="M0 70C260 20 520 110 780 70s440-40 660 0v50H0z"/>
        <path class="w3" d="M0 92c300-40 560 30 820 8s420-30 620-6v26H0z"/>
        <path class="w4" d="M0 104c320-24 640 16 960 4s360-10 480-4v16H0z"/>
      </svg>
    </section>`;
  }
  function stripHTML() {
    return `${markets.length ? `<div class="mstrip"><div class="container"><a href="#/markets" class="mstrip-title">${icon('fa-solid fa-location-crosshairs')}<span>${u('weServe')}:</span></a>
      <div class="marquee"><div class="marquee-track">${[...markets, ...markets].map(m => `<a href="#/markets" class="mchip">${flag(m.code, 40)}${tx(m.name)}</a>`).join('')}</div></div></div></div>` : ''}`;
  }

  const mkFlag = (m, w) => m.code ? flag(m.code, w) : `<span class="mk-globe">${icon(m.icon || 'fa-solid fa-earth-americas')}</span>`;
  function marketsGrid(full) {
    if (!markets.length) return '';
    if (!full) {
      return `<div class="mk-compact">${markets.map(m => `<a href="#/markets" class="mk-mini reveal">${mkFlag(m, 80)}<b>${tx(m.name)}</b><small>${tx(m.note)}</small></a>`).join('')}</div>
        <div class="mk-banner reveal"><ul>${['ship1', 'ship2', 'ship3'].map(k => `<li>${icon('fa-solid fa-circle-check')}${esc(u(k))}</li>`).join('')}</ul><a href="#/markets" class="btn btn-light btn-sm">${u('viewAll')} ${arrow}</a></div>`;
    }
    const groups = [['gcc', u('gcc')], ['mena', u('mena')], ['world', u('world')]];
    const card = m => `<div class="mk-card reveal">
      <div class="mk-head">${mkFlag(m, 80)}<div><h3>${tx(m.name)}</h3>${t(m.note) ? `<small>${icon('fa-solid fa-anchor')} ${tx(m.note)}</small>` : ''}</div></div>
      ${t(m.desc) ? `<p>${tx(m.desc)}</p>` : ''}
      ${t(m.sectors) ? `<div><small style="color:var(--muted);font-weight:700;font-size:.78rem">${u('demand')}</small><div class="chips" style="margin-top:6px">${t(m.sectors).split(/[،,]/).map(x => x.trim()).filter(Boolean).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>` : ''}
    </div>`;
    const known = new Set(groups.map(g => g[0]));
    let html = groups.map(([g, title]) => { const list = markets.filter(m => (m.region || 'gcc') === g); return list.length ? `<h3 class="region-title">${title}</h3><div class="mk-grid">${list.map(card).join('')}</div>` : ''; }).join('');
    const rest = markets.filter(m => m.region && !known.has(m.region));
    if (rest.length) html += `<div class="mk-grid">${rest.map(card).join('')}</div>`;
    return html;
  }

  function processHTML(soft) {
    if (!secOn('process') || !(C.process || []).length) return '';
    return `<section class="section ${soft ? 'soft' : ''}"><div class="container">${head(sec('process'), { icon: 'fa-solid fa-route', center: true })}
      <div class="tl3d"><i class="tl-line" aria-hidden="true"></i>${C.process.map((p, i) => `<div class="tl-step reveal ${i % 2 ? 'even' : ''}"><span class="tl-num" aria-hidden="true"></span>
        <div class="tl-body"><span class="tl-count">${String(i + 1).padStart(2, '0')}</span><div class="step-icon">${icon(p.icon)}</div><div><h3>${tx(p.title)}</h3><p>${tx(p.desc)}</p></div></div></div>`).join('')}</div>
    </div></section>`;
  }
  function servicesHTML(soft) {
    if (!secOn('services') || !(C.services || []).length) return '';
    return `<section class="section ${soft ? 'soft' : ''}"><div class="container">${head(sec('services'), { icon: 'fa-solid fa-briefcase', right: `<a href="#/services" class="btn btn-outline">${u('viewAll')} ${arrow}</a>` })}
      <div class="svc-grid">${C.services.map(s => `<div class="svc reveal"><div class="svc-icon">${icon(s.icon)}</div><h3>${tx(s.title)}</h3><p>${tx(s.desc)}</p></div>`).join('')}</div></div></section>`;
  }
  function whyHTML(soft) {
    if (!secOn('why') || !(C.why || []).length) return '';
    return `<section class="section ${soft ? 'soft' : ''}"><div class="container">${head(sec('why'), { icon: 'fa-solid fa-award', center: true })}
      <div class="why-grid">${C.why.map(w => `<div class="why reveal">${icon(w.icon)}<h3>${tx(w.title)}</h3><p>${tx(w.desc)}</p></div>`).join('')}</div></div></section>`;
  }
  function testimonialsHTML() {
    if (!secOn('testimonials') || !(C.testimonials || []).length) return '';
    return `<section class="section"><div class="container">${head(sec('testimonials'), { icon: 'fa-solid fa-quote-right' })}
      <div class="testi-grid">${C.testimonials.map(x => `<div class="testi reveal"><div class="stars">${'★'.repeat(Math.max(0, Math.min(5, +x.rating || 5)))}</div>${rich(x.text)}<b>${tx(x.name)}</b><small>${tx(x.role)}</small></div>`).join('')}</div></div></section>`;
  }
  function faqHTML() {
    if (!secOn('faq') || !(C.faq || []).length) return '';
    const s = sec('faq');
    return `<section class="section soft"><div class="container faq-wrap">
      <div class="sec-head reveal" style="margin:0"><div class="txt"><span class="eyebrow">${icon('fa-solid fa-circle-question')} FAQ</span><h2>${tx(s.title)}</h2><p>${t(s.subtitle) ? tx(s.subtitle) : u('faqLead')}</p>
        ${CT.whatsapp ? `<a href="${esc(waLink())}" target="_blank" rel="noopener" class="btn btn-wa" style="margin-top:20px">${icon('fa-brands fa-whatsapp')} ${u('whatsapp')}</a>` : ''}</div></div>
      <div class="faq">${C.faq.map((f, i) => `<details class="reveal" ${i === 0 ? 'open' : ''}><summary>${tx(f.q)}${icon('fa-solid fa-plus')}</summary><div>${rich(f.a)}</div></details>`).join('')}</div>
    </div></section>`;
  }

  /* ---------- pages ---------- */
  function pageHome() {
    const stats = C.stats || [];
    const featured = machines.filter(m => m.featured);
    const featCats = cats.filter(c => featured.some(m => m.cat === c.id));
    return `${heroHTML()}
    <div class="search-wrap" id="after-hero"><div class="container"><div class="search-card">${searchForm()}
      ${stats.length ? `<div class="stats">${stats.map(st => `<div class="stat"><b>${tx(st.value)}</b><span>${tx(st.label)}</span></div>`).join('')}</div>` : ''}</div></div></div>
    <div style="height:10px"></div>

    ${secOn('categories') ? `<section class="section"><div class="container">
      ${head(sec('categories'), { icon: 'fa-solid fa-layer-group', right: `<a href="#/machines" class="btn btn-outline">${u('viewAll')} ${arrow}</a>` })}
      <div class="cat-grid">${cats.map(c => `<a class="cat-card reveal" href="#/machines?cat=${encodeURIComponent(c.id)}">
        <div class="cat-top"><span class="cat-icon">${c.image ? `<img src="${esc(c.image)}" alt="">` : icon(c.icon)}</span><span class="cat-count">${machineCount(c.id)}</span></div>
        <h3>${tx(c.name)}</h3><p>${tx(c.desc)}</p></a>`).join('')}</div></div></section>` : ''}

    ${secOn('featured') && featured.length ? `<section class="section soft"><div class="container">
      ${head(sec('featured'), { icon: 'fa-solid fa-star', right: `<div class="tabs" data-feat-tabs><button class="tab active" data-feat="">${u('all')}</button>${featCats.map(c => `<button class="tab" data-feat="${esc(c.id)}">${tx(c.name)}</button>`).join('')}</div>` })}
      <div class="m-grid" data-feat-grid>${featured.map(machineCard).join('')}</div>
      <div style="text-align:center;margin-top:36px"><a href="#/machines" class="btn btn-primary">${u('machinesFull')} ${arrow}</a></div>
    </div></section>` : ''}

    ${secOn('markets') && markets.length ? `<section class="section markets-sec"><div class="container">${head(sec('markets'), { icon: 'fa-solid fa-earth-asia' })}${marketsGrid(false)}</div></section>` : ''}
    ${processHTML(true)}
    ${servicesHTML(false)}
    ${whyHTML(true)}
    ${testimonialsHTML()}
    ${faqHTML()}
    <div style="height:100px"></div>
    ${ctaHTML()}`;
  }

  function pageMachines(params) {
    const catId = params.get('cat') || '';
    const q = (params.get('q') || '').trim().toLowerCase();
    const c = catById(catId);
    const list = machines.filter(m => (!catId || m.cat === catId) && (!q || [t(m.name), m.name && m.name.ar, m.name && m.name.en, m.model, m.desc && m.desc.ar, m.desc && m.desc.en].join(' ').toLowerCase().includes(q)));
    const link = id => `#/machines${id ? '?cat=' + encodeURIComponent(id) : ''}`;
    return `${pageHero(c ? t(c.name) : pageTitle('machines', 'machinesFull'), c ? t(c.desc) : u('machinesLead'), [[navLabel('machines'), c ? '#/machines' : ''], ...(c ? [[t(c.name), '']] : [])])}
    <section class="section" style="padding-top:44px"><div class="container catalog">
      <aside class="sidebar"><h4>${u('sectors')}</h4>
        <a class="side-link ${!catId ? 'active' : ''}" href="${link('')}">${icon('fa-solid fa-layer-group')} ${u('allCats')}<span class="count">${machines.length}</span></a>
        ${cats.map(x => `<a class="side-link ${x.id === catId ? 'active' : ''}" href="${link(x.id)}">${icon(x.icon)} ${tx(x.name)}<span class="count">${machineCount(x.id)}</span></a>`).join('')}</aside>
      <div>
        <div class="cat-chips"><a class="tab ${!catId ? 'active' : ''}" href="${link('')}">${u('all')}</a>${cats.map(x => `<a class="tab ${x.id === catId ? 'active' : ''}" href="${link(x.id)}">${tx(x.name)}</a>`).join('')}</div>
        <div class="catalog-bar">${searchForm(catId, params.get('q'))}<span class="results">${list.length} ${u('results')}</span></div>
        ${list.length ? `<div class="m-grid">${list.map(machineCard).join('')}</div>` : `<div class="empty">${icon('fa-solid fa-magnifying-glass')}<p>${u('noResults')}</p>${CT.whatsapp ? `<a href="${esc(waLink(q))}" target="_blank" rel="noopener" class="btn btn-wa">${icon('fa-brands fa-whatsapp')} ${u('whatsapp')}</a>` : ''}</div>`}
      </div></div></section>${ctaHTML()}`;
  }

  function videoEmbed(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    const m = s.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
    if (m) return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(m[1])}" allowfullscreen loading="lazy" title="video"></iframe></div>`;
    if (/\.mp4(\?|$)/i.test(s)) return `<div class="video"><video src="${esc(safeUrl(s))}" controls preload="metadata"></video></div>`;
    return `<a class="btn btn-outline" href="${esc(safeUrl(s))}" target="_blank" rel="noopener">${icon('fa-solid fa-play')} ${u('video')}</a>`;
  }

  function pageMachine(id) {
    const m = machines.find(x => x.id === id);
    if (!m) return pageNotFound();
    const c = catById(m.cat);
    const imgs = m.images || [];
    const related = machines.filter(x => x.cat === m.cat && x.id !== m.id).slice(0, 3);
    machines.filter(x => x.featured && x.id !== m.id && !related.includes(x)).forEach(x => { if (related.length < 3) related.push(x); });
    const recent = store.get('sm_recent').filter(x => x !== m.id).slice(0, 4).map(x => machines.find(y => y.id === x)).filter(Boolean);
    const ph0 = (CT.phones || [])[0], em0 = (CT.emails || [])[0];
    const label = t(m.name) + (m.model ? ' (' + m.model + ')' : '');
    const ph = (CT.phones || [])[0];
    document.title = t(m.name) + ' | ' + t(S.siteName);
    return `${pageHero(c ? t(c.name) : u('machinesFull'), c ? t(c.desc) : '', [[navLabel('machines'), '#/machines'], ...(c ? [[t(c.name), '#/machines?cat=' + encodeURIComponent(c.id)]] : []), [t(m.name), '']])}
    <section class="section" style="padding-top:48px"><div class="container">
      <div class="print-only print-head"><img src="${esc(logo)}" alt=""><div><b>${esc(S.brandLine1 || '')} · ${tx(S.siteName)}</b><small>${tx(S.tagline)}</small></div>
        <div class="ph-contact">${ph0 ? `<span>${esc(ph0.number)}</span>` : ''}${em0 ? `<span>${esc(em0.value)}</span>` : ''}<span>${esc(location.host)}</span></div></div>
      <div class="detail">
        <div>
          <div class="gallery-main" data-gmain>${imgs[0] ? `<img src="${esc(imgs[0])}" alt="${tx(m.name)}">` : media(m)}</div>
          ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((src, i) => `<button class="${i === 0 ? 'active' : ''}" data-thumb="${esc(src)}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        </div>
        <div class="d-info">
          <div class="d-tags">${c ? `<a class="tag" href="#/machines?cat=${encodeURIComponent(c.id)}">${icon(c.icon)} ${tx(c.name)}</a>` : ''}${m.model ? `<span class="tag model">${u('model')}: ${esc(m.model)}</span>` : ''}${t(m.badge) ? `<span class="tag hot">${tx(m.badge)}</span>` : ''}</div>
          <h1>${tx(m.name)}</h1>
          <div class="kv">
            ${t(m.capacity) ? `<div>${icon('fa-solid fa-gauge-high')}<span><small>${u('capacity')}</small><b>${tx(m.capacity)}</b></span></div>` : ''}
            <div>${icon('fa-solid fa-tag')}<span><small>${u('price')}</small><b>${t(m.price) ? tx(m.price) : u('priceOnReq')}</b></span></div>
          </div>
          <div class="d-desc">${rich(m.desc)}</div>
          <div class="assure"><div>${icon('fa-solid fa-circle-check')} ${u('a1')}</div><div>${icon('fa-solid fa-circle-check')} ${u('a2')}</div><div>${icon('fa-solid fa-circle-check')} ${u('a3')}</div><div>${icon('fa-solid fa-circle-check')} ${u('a4')}</div></div>
          <div class="d-actions">
            ${CT.whatsapp ? `<a class="btn btn-wa" href="${esc(waLink(label))}" target="_blank" rel="noopener">${icon('fa-brands fa-whatsapp')} ${u('waQuote')}</a>` : ''}
            <a class="btn btn-primary" href="#quote" data-scroll="quote">${icon('fa-solid fa-file-invoice')} ${u('quote')}</a>
            ${ph ? `<a class="btn btn-outline" href="${tel(ph.number)}">${icon('fa-solid fa-phone')} ${u('call')}</a>` : ''}
            <button type="button" class="btn btn-outline" data-print>${icon('fa-solid fa-file-pdf')} ${u('downloadPdf')}</button>
            <button type="button" class="btn btn-outline cmp-btn-wide ${cmpList().includes(m.id) ? 'on' : ''}" data-cmp="${esc(m.id)}">${icon('fa-solid fa-scale-balanced')} ${u('compareAdd')}</button>
            ${m.brochure ? `<a class="btn btn-outline" href="${esc(safeUrl(m.brochure))}" target="_blank" rel="noopener">${icon('fa-solid fa-book-open')} ${u('brochure')}</a>` : ''}
          </div>
        </div>
      </div>
      <div class="detail-lower">
        <div class="stack">
          ${(m.specs || []).length ? `<div class="panel"><h2>${icon('fa-solid fa-list-check')} ${u('specs')}</h2><table class="specs"><tbody>${m.specs.map(sp => `<tr><th>${tx(sp.k)}</th><td dir="${/[؀-ۿ]/.test(t(sp.v)) ? 'rtl' : 'ltr'}">${tx(sp.v)}</td></tr>`).join('')}</tbody></table></div>` : ''}
          ${(m.sections || []).filter(x => t(x.title) || t(x.text)).map(x => `<div class="panel">${t(x.title) ? `<h2>${icon('fa-solid fa-circle-info')} ${tx(x.title)}</h2>` : ''}${x.image ? `<img src="${esc(x.image)}" alt="" style="border-radius:14px;margin-bottom:14px">` : ''}${rich(x.text)}</div>`).join('')}
          ${m.video ? `<div class="panel"><h2>${icon('fa-solid fa-circle-play')} ${u('video')}</h2>${videoEmbed(m.video)}</div>` : ''}
        </div>
        <div class="panel sticky" id="quote"><h2>${icon('fa-solid fa-envelope-open-text')} ${u('inquiry')}</h2><p style="color:var(--muted);font-size:.92rem">${u('inquiryHint')}</p>${quoteForm(label)}</div>
      </div>
      ${related.length ? `<div class="no-print" style="margin-top:64px"><div class="sec-head"><div class="txt"><h2>${u('suggested')}</h2></div></div><div class="m-grid">${related.map(machineCard).join('')}</div></div>` : ''}
      ${recent.length ? `<div class="no-print" style="margin-top:48px"><div class="sec-head"><div class="txt"><h2>${u('recentViewed')}</h2></div></div><div class="m-grid m-grid-sm">${recent.map(machineCard).join('')}</div></div>` : ''}
      <div class="print-only print-foot">${tx(S.siteName)} · ${ph0 ? esc(ph0.number) + ' · ' : ''}${em0 ? esc(em0.value) + ' · ' : ''}${new Date().toISOString().slice(0, 10)}</div>
    </div></section>`;
  }

  function pageCompare() {
    const list = cmpList().map(id => machines.find(m => m.id === id)).filter(Boolean);
    const head = pageHero(u('compareTitle'), u('compareLead'), [[navLabel('machines'), '#/machines'], [u('compareTitle'), '']]);
    if (list.length < 2) return `${head}<section class="section"><div class="container"><div class="empty">${icon('fa-solid fa-scale-balanced')}<p>${u('compareEmpty')}</p><a class="btn btn-primary" href="#/machines">${navLabel('machines')} ${arrow}</a></div></div></section>`;
    const keys = [];
    const shown = [u('capacity'), u('price'), u('model')];
    list.forEach(m => (m.specs || []).forEach(sp => { const k = t(sp.k); if (k && !keys.includes(k) && !shown.includes(k)) keys.push(k); }));
    const val = (m, k) => { const sp = (m.specs || []).find(s => t(s.k) === k); return sp ? tx(sp.v) : '—'; };
    const cell = (m, html) => `<td>${html}</td>`;
    return `${head}<section class="section" style="padding-top:44px"><div class="container">
      <div class="cmp-wrap"><table class="cmp-table"><colgroup><col class="c-label">${list.map(() => '<col>').join('')}</colgroup>
        <thead><tr><th></th>${list.map(m => `<th><a href="#/machine/${encodeURIComponent(m.id)}" class="cmp-media">${media(m)}</a><a href="#/machine/${encodeURIComponent(m.id)}" class="cmp-name">${tx(m.name)}</a>
          <button type="button" class="cmp-remove" data-cmp="${esc(m.id)}">${icon('fa-solid fa-xmark')} ${u('compareRemove')}</button></th>`).join('')}</tr></thead>
        <tbody>
          <tr><th>${u('sectors')}</th>${list.map(m => cell(m, tx((catById(m.cat) || {}).name)))}</tr>
          <tr><th>${u('model')}</th>${list.map(m => cell(m, m.model ? `<span class="ltr">${esc(m.model)}</span>` : '—'))}</tr>
          <tr><th>${u('capacity')}</th>${list.map(m => cell(m, t(m.capacity) ? tx(m.capacity) : '—'))}</tr>
          <tr><th>${u('price')}</th>${list.map(m => cell(m, t(m.price) ? tx(m.price) : u('priceOnReq')))}</tr>
          ${keys.map(k => `<tr><th>${esc(k)}</th>${list.map(m => cell(m, val(m, k)))}</tr>`).join('')}
          <tr class="cmp-act"><th></th>${list.map(m => cell(m, CT.whatsapp ? `<a class="btn btn-wa btn-sm" href="${esc(waLink(t(m.name) + (m.model ? ' (' + m.model + ')' : '')))}" target="_blank" rel="noopener">${icon('fa-brands fa-whatsapp')} ${u('waQuote')}</a>` : ''))}</tr>
        </tbody></table></div>
      <div style="text-align:center;margin-top:20px"><button type="button" class="btn btn-outline btn-sm" data-cmp-clear>${icon('fa-solid fa-trash')} ${u('compareClear')}</button></div>
    </div></section>${ctaHTML()}`;
  }

  function pageMarkets() {
    const s = sec('markets');
    return `${pageHero(t(s.title) || navLabel('markets'), t(s.subtitle), [[navLabel('markets'), '']])}
      <section class="section" style="padding-top:50px"><div class="container">${marketsGrid(true)}
      <div class="mk-banner reveal"><ul>${['ship1', 'ship2', 'ship3'].map(k => `<li>${icon('fa-solid fa-circle-check')}${esc(u(k))}</li>`).join('')}</ul><a href="#/contact" class="btn btn-light btn-sm">${u('quote')}</a></div>
      </div></section>${processHTML(true)}${ctaHTML()}`;
  }
  function pageServices() { return `${pageHero(navLabel('services'), u('servicesLead'), [[navLabel('services'), '']])}${servicesHTML(false)}${processHTML(true)}${whyHTML(false)}${ctaHTML()}`; }

  function pageAbout() {
    const A = C.about || {};
    return `${pageHero(t(A.title) || navLabel('about'), t(A.intro), [[navLabel('about'), '']])}
    <section class="section"><div class="container about-grid">
      <div class="about-visual reveal">${A.image ? `<img class="photo" src="${esc(A.image)}" alt="">` : `<img class="mark" src="${esc(logoWhite)}" alt="">`}</div>
      <div class="reveal"><span class="eyebrow">${icon('fa-solid fa-book-open')} ${u('story')}</span><h2 style="font-size:2rem">${tx(S.siteName)}</h2>${rich(A.story)}
        <div class="mv-grid"><div class="mv"><h3>${icon('fa-solid fa-bullseye')} ${u('mission')}</h3><p>${tx(A.mission)}</p></div><div class="mv"><h3>${icon('fa-solid fa-eye')} ${u('vision')}</h3><p>${tx(A.vision)}</p></div></div></div>
    </div></section>
    ${(A.values || []).length ? `<section class="section soft"><div class="container">${head({ title: u('ourValues') }, { icon: 'fa-solid fa-gem', center: true })}
      <div class="why-grid">${A.values.map(v => `<div class="why reveal">${icon(v.icon)}<h3>${tx(v.title)}</h3><p>${tx(v.desc)}</p></div>`).join('')}</div></div></section>` : ''}
    ${whyHTML(false)}${ctaHTML()}`;
  }

  function pageContact() {
    return `${pageHero(navLabel('contact'), u('contactLead'), [[navLabel('contact'), '']])}
    <section class="section" style="padding-top:50px"><div class="container"><div class="contact-grid">
      <div class="c-cards">
        ${CT.whatsapp ? `<div class="c-card">${icon('fa-brands fa-whatsapp')}<div><h4>${u('whatsapp')}</h4><a class="ltr" href="${esc(waLink())}" target="_blank" rel="noopener">+${esc(digits(CT.whatsapp))}</a></div></div>` : ''}
        ${(CT.phones || []).length ? `<div class="c-card">${icon('fa-solid fa-phone')}<div><h4>${u('phones')}</h4>${CT.phones.map(p => `<a href="${tel(p.number)}"><small>${tx(p.label)}:</small> <span class="ltr">${esc(p.number)}</span></a>`).join('')}</div></div>` : ''}
        ${(CT.emails || []).length ? `<div class="c-card">${icon('fa-regular fa-envelope')}<div><h4>${u('emails')}</h4>${CT.emails.map(e => `<a href="mailto:${esc(e.value)}">${esc(e.value)}</a>`).join('')}</div></div>` : ''}
        ${(CT.offices || []).map(o => `<div class="c-card">${icon('fa-solid fa-location-dot')}<div><h4>${tx(o.name)}</h4><span>${tx(o.address)}</span>${o.mapUrl ? `<a href="${esc(safeUrl(o.mapUrl))}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700">${icon('fa-solid fa-map')} Google Maps</a>` : ''}</div></div>`).join('')}
        ${t(CT.hours) ? `<div class="c-card">${icon('fa-regular fa-clock')}<div><h4>${u('hours')}</h4><span>${tx(CT.hours)}</span></div></div>` : ''}
        ${socialsHTML() ? `<div class="c-card">${icon('fa-solid fa-share-nodes')}<div><h4>${u('followUs')}</h4><div class="socials" style="margin-top:6px">${socialsHTML()}</div></div></div>` : ''}
      </div>
      <div class="panel"><h2>${icon('fa-solid fa-envelope-open-text')} ${u('inquiry')}</h2><p style="color:var(--muted);font-size:.92rem">${u('inquiryHint')}</p>${quoteForm('')}</div>
    </div>
    ${CT.mapEmbed && /^https:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(CT.mapEmbed) ? `<div class="map"><iframe src="${esc(CT.mapEmbed)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="map"></iframe></div>` : ''}
    </div></section>`;
  }

  function pageCustom(slug) {
    const p = pages.find(x => x.slug === slug);
    if (!p) return pageNotFound();
    const blocks = (p.blocks || []).map(b => {
      const btn = t(b.buttonText) ? `<a class="btn btn-primary" style="margin-top:8px" href="${esc(linkOf(b.buttonLink))}"${extAttr(linkOf(b.buttonLink))}>${b.buttonLink === 'whatsapp' ? icon('fa-brands fa-whatsapp') : ''} ${tx(b.buttonText)}</a>` : '';
      if (b.type === 'image') return b.image ? `<figure class="block-full reveal" style="margin:34px 0"><img src="${esc(b.image)}" alt="">${t(b.heading) ? `<figcaption>${tx(b.heading)}</figcaption>` : ''}</figure>` : '';
      if (b.type === 'cta') return `<div class="cta-box reveal" style="margin:34px 0"><div><h2>${tx(b.heading)}</h2>${rich(b.text)}</div><div class="actions">${t(b.buttonText) ? `<a class="btn btn-light" href="${esc(linkOf(b.buttonLink))}"${extAttr(linkOf(b.buttonLink))}>${tx(b.buttonText)}</a>` : ''}</div></div>`;
      if (b.type === 'machines') { const list = machines.filter(m => !b.category || m.cat === b.category).slice(0, 6); return `<div style="margin:34px 0">${t(b.heading) ? `<h2>${tx(b.heading)}</h2>` : ''}<div class="m-grid">${list.map(machineCard).join('')}</div></div>`; }
      return `<div class="block reveal ${b.image ? '' : 'noimg'}"><div>${t(b.heading) ? `<h2>${tx(b.heading)}</h2>` : ''}${rich(b.text)}${btn}</div>${b.image ? `<div class="block-img"><img src="${esc(b.image)}" alt=""></div>` : ''}</div>`;
    }).join('');
    return `${pageHero(t(p.title), t(p.subtitle), [[t(p.title), '']])}<section class="section" style="padding-top:30px"><div class="container">${blocks}</div></section>${ctaHTML()}`;
  }
  const pageNotFound = () => `${pageHero(u('notFound'), '', [])}<section class="section"><div class="container" style="text-align:center"><a class="btn btn-primary" href="#/">${u('backHome')}</a></div></section>`;

  /* ---------- router ---------- */
  let sliderTimer = null;
  function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    if (hash === 'quote' || hash === 'main') return;
    const [p, qs] = hash.split('?');
    const params = new URLSearchParams(qs || '');
    const main = document.getElementById('main');
    clearInterval(sliderTimer);
    document.title = t(S.seoTitle) || t(S.siteName);
    let html, navKey = '#/';
    if (p === '/' || p === '') html = pageHome();
    else if (p === '/machines') { html = pageMachines(params); navKey = '#/machines'; }
    else if (p.startsWith('/machine/')) { html = pageMachine(decodeURIComponent(p.slice(9))); navKey = '#/machines'; }
    else if (p === '/markets') { html = pageMarkets(); navKey = '#/markets'; }
    else if (p === '/services') { html = pageServices(); navKey = '#/services'; }
    else if (p === '/about') { html = pageAbout(); navKey = '#/about'; }
    else if (p === '/contact') { html = pageContact(); navKey = '#/contact'; }
    else if (p === '/compare') { html = pageCompare(); navKey = '#/machines'; }
    else if (p.startsWith('/page/')) { const slug = decodeURIComponent(p.slice(6)); html = pageCustom(slug); navKey = '#/page/' + encodeURIComponent(slug); }
    else html = pageNotFound();
    const apply = () => {
    main.innerHTML = html;
    if (p !== '/' && p !== '' && !p.startsWith('/machine/')) { const h1 = main.querySelector('.page-hero h1'); if (h1) document.title = h1.textContent + ' | ' + t(S.siteName); }
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
    document.body.classList.remove('drawer-open');
    document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); document.documentElement.style.scrollBehavior = '';
    initPage();
    setPageLd(p.startsWith('/machine/') ? machineLd(decodeURIComponent(p.slice(9))) : null);
    if (p.startsWith('/machine/')) addRecent(decodeURIComponent(p.slice(9)));
    updateCmpBar();
    trackView(p || '/', p.startsWith('/machine/') ? decodeURIComponent(p.slice(9)) : '');
    };
    // update the page immediately (always reliable), then play a short fade-in
    apply();
    if (booted) { main.classList.remove('page-enter'); void main.offsetWidth; main.classList.add('page-enter'); }
    booted = true;
  }
  let booted = false;
  /* anonymous visit counter: no cookies, no IP stored; respects "Do Not Track" */
  let firstView = true;
  function trackView(path, machineId) {
    try {
      if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
      let vid = ''; try { vid = localStorage.getItem('sm_vid') || ''; if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('sm_vid', vid); } } catch { /* private mode */ }
      let ref = '';
      if (firstView && document.referrer) { try { const h0 = new URL(document.referrer).hostname; if (h0 && h0 !== location.hostname) ref = h0; } catch { /* */ } }
      firstView = false;
      const body = JSON.stringify({ p: path, m: machineId, tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), l: lang, r: ref, d: matchMedia('(max-width: 760px)').matches ? 'm' : 'd', v: vid });
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch { /* never break the page */ }
  }
  /* structured data (schema.org) for search engines */
  function absUrl(u0) { try { return new URL(u0, location.origin).href; } catch { return u0; } }
  function machineLd(id) {
    const m = machines.find(x => x.id === id);
    if (!m) return null;
    const cat = catById(m.cat);
    return { '@context': 'https://schema.org', '@type': 'Product', name: t(m.name), description: t(m.desc), sku: m.model || undefined, category: cat ? t(cat.name) : undefined,
      brand: { '@type': 'Brand', name: (S.siteName && S.siteName.en) || 'Suzhou Manhal' }, image: (m.images || []).map(absUrl), url: location.origin + '/#/machine/' + encodeURIComponent(m.id) };
  }
  function setPageLd(obj) {
    let s = document.getElementById('ld-page');
    if (!obj) { if (s) s.remove(); return; }
    if (!s) { s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'ld-page'; document.head.appendChild(s); }
    s.textContent = JSON.stringify(obj);
  }
  function initPage() {
    const slides = document.querySelectorAll('.hero-slide');
    const hero = document.getElementById('hero3d');
    const showSlide = i => {
      document.querySelectorAll('#hero3d [data-slide]').forEach(el => el.classList.toggle('active', +el.dataset.slide === i));
      document.querySelectorAll('#hero3d [data-dot]').forEach(d => d.classList.toggle('active', +d.dataset.dot === i));
      const s = slides[i];
      if (hero && s) { hero.classList.toggle('show-photo', !!s.dataset.photo); hero.classList.toggle('show-bg', !!s.dataset.bg); }
    };
    if (slides.length) showSlide(0);
    if (slides.length > 1) {
      let i = 0;
      const go = n => { i = (n + slides.length) % slides.length; showSlide(i); };
      document.querySelectorAll('[data-dot]').forEach(d => d.addEventListener('click', () => { go(+d.dataset.dot); restart(); }));
      const restart = () => { clearInterval(sliderTimer); sliderTimer = setInterval(() => go(i + 1), 7000); };
      restart();
    }
    const grid = document.querySelector('[data-feat-grid]');
    document.querySelectorAll('[data-feat]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('[data-feat]').forEach(x => x.classList.toggle('active', x === b));
      grid.innerHTML = machines.filter(m => m.featured && (!b.dataset.feat || m.cat === b.dataset.feat)).map(machineCard).join('');
      [...grid.children].forEach((ch, i) => ch.style.setProperty('--d', (i % 8) * 0.07 + 's'));
      reveal();
    }));
    document.querySelectorAll('[data-thumb]').forEach(b => b.addEventListener('click', () => {
      document.querySelector('[data-gmain]').innerHTML = `<img src="${esc(b.dataset.thumb)}" alt="">`;
      document.querySelectorAll('[data-thumb]').forEach(x => x.classList.toggle('active', x === b));
    }));
    reveal();
    enhance3d();
  }

  /* ---------- 3D layer ---------- */
  const GEO = { sa: [24.7, 46.7], ae: [25.2, 55.3], qa: [25.3, 51.5], kw: [29.4, 48.0], om: [23.6, 58.4], bh: [26.2, 50.6], iq: [33.3, 44.4], eg: [30.0, 31.2], jo: [31.9, 35.9], ye: [15.4, 44.2], lb: [33.9, 35.5], sy: [33.5, 36.3], ps: [31.9, 35.2], ly: [32.9, 13.2], tn: [36.8, 10.2], dz: [36.7, 3.1], ma: [33.6, -7.6], sd: [15.6, 32.5], so: [2.0, 45.3], dj: [11.6, 43.1], mr: [18.1, -15.9], tr: [41.0, 28.9], ir: [35.7, 51.4], pk: [24.9, 67.0], et: [9.0, 38.7], ke: [-1.3, 36.8], ng: [6.5, 3.4], cn: [31.2, 121.5] };
  const REGION_GEO = { 'fa-earth-africa': [-1.3, 36.8], 'fa-earth-asia': [-6.2, 106.8], 'fa-earth-europe': [50.1, 8.7], 'fa-earth-americas': [19.4, -99.1] };
  const LABEL_SIDE = {}; // only the company's own location (Suzhou) is labelled on the globe
  function globeOptions() {
    const targets = markets.map(m => {
      const key = m.code || ((m.icon || '').match(/fa-earth-[a-z]+/) || [''])[0];
      const g = m.code ? GEO[String(m.code).toLowerCase()] : REGION_GEO[key];
      if (!g) return null;
      return { lat: g[0], lon: g[1], label: t(m.name), focus: m.region !== 'world', show: !!LABEL_SIDE[key], cls: LABEL_SIDE[key] || 'b' };
    }).filter(Boolean);
    return { origin: { lat: 31.3, lon: 120.6, label: u('globeOrigin') }, targets, legend: [] };
  }
  function enhance3d() {
    document.querySelectorAll('.cat-grid,.m-grid,.svc-grid,.why-grid,.mk-grid,.mk-compact,.testi-grid,.faq').forEach(g => [...g.children].forEach((ch, i) => ch.style.setProperty('--d', (i % 8) * 0.07 + 's')));
    const hero = document.getElementById('hero3d');
    if (hero && window.SMGlobe) window.SMGlobe.mount(hero, document.getElementById('globeSlot'), globeOptions());
    else if (hero) hero.classList.add('no3d');
    countUp();
    onScroll3d();
  }
  /* numbers in the stats bar count up once when they come into view */
  function countUp() {
    const els = [...document.querySelectorAll('.stat b')].filter(el => !el.dataset.counted);
    if (!els.length || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ob = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target; ob.unobserve(el); el.dataset.counted = '1';
      const m = el.textContent.match(/^(\D*)(\d[\d,]*)(.*)$/);
      if (!m) return;
      const end = parseInt(m[2].replace(/,/g, ''), 10), t0 = performance.now(), dur = 1400;
      // timer-based (not frame-based) so it also runs smoothly on slow or throttled devices
      const step = () => { const p = Math.max(0, Math.min(1, (performance.now() - t0) / dur)), v = Math.round(end * (1 - Math.pow(1 - p, 3))); el.textContent = m[1] + v.toLocaleString('en-US') + m[3]; if (p < 1) setTimeout(step, 30); };
      step();
    }), { threshold: 0.6 });
    els.forEach(el => ob.observe(el));
  }
  const sprog = document.createElement('div'); sprog.className = 'sprog'; document.body.appendChild(sprog);
  function onScroll3d() {
    const h = document.documentElement.scrollHeight - innerHeight;
    sprog.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0).toFixed(4) + ')';
    const tl = document.querySelector('.tl3d');
    if (tl) {
      const r = tl.getBoundingClientRect(), mark = innerHeight * 0.62;
      tl.style.setProperty('--p', Math.max(0, Math.min(1, (mark - r.top) / r.height)).toFixed(4));
      tl.querySelectorAll('.tl-step').forEach(d => { const b = d.getBoundingClientRect(); d.classList.toggle('on', b.top + b.height / 2 < mark); });
    }
  }
  addEventListener('scroll', onScroll3d, { passive: true });
  addEventListener('resize', onScroll3d, { passive: true });
  // tilt
  const FINE = matchMedia('(hover:hover) and (pointer:fine)'), RMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const TILT = '.cat-card,.m-card,.svc,.why,.tl-body,.mk-card,.mk-mini,.testi,.c-card,.mv,.search-card';
  const syncTilt = () => document.body.classList.remove('tilt-on'); // tilt disabled for a calmer design
  syncTilt(); FINE.addEventListener && FINE.addEventListener('change', syncTilt);
  let tiltEl = null;
  const tiltOff = el => { el.classList.remove('tl'); el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); };
  addEventListener('pointermove', e => {
    if (!document.body.classList.contains('tilt-on')) return;
    const el = e.target.closest && e.target.closest(TILT);
    if (tiltEl && tiltEl !== el) tiltOff(tiltEl);
    tiltEl = el;
    if (!el || (el.classList.contains('reveal') && !el.classList.contains('in'))) return;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const m = r.width > 600 ? 3 : 10;
    el.classList.add('tl');
    el.style.setProperty('--rx', ((0.5 - y) * m).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((x - 0.5) * m).toFixed(2) + 'deg');
    el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
  }, { passive: true });
  document.addEventListener('pointerleave', () => { if (tiltEl) tiltOff(tiltEl); tiltEl = null; });
  let io;
  function reveal() {
    const els = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    io = io || new IntersectionObserver(en => en.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -30px 0px' });
    els.forEach(e => io.observe(e));
  }

  /* ---------- events ---------- */
  let adminClicks = 0, adminTimer = null;
  document.addEventListener('click', e => {
    const cmpBtn = e.target.closest('[data-cmp]');
    if (cmpBtn) { e.preventDefault(); toggleCompare(cmpBtn.dataset.cmp); if (location.hash.startsWith('#/compare')) route(); return; }
    if (e.target.closest('[data-cmp-clear]')) { store.set('sm_cmp', []); document.querySelectorAll('[data-cmp]').forEach(b => b.classList.remove('on')); updateCmpBar(); if (location.hash.startsWith('#/compare')) route(); return; }
    if (e.target.closest('[data-print]')) { window.print(); return; }
    const skip = e.target.closest('[data-skip]');
    if (skip) { e.preventDefault(); const m0 = document.getElementById('main'); m0.focus(); m0.scrollIntoView(); return; }
    const el = e.target.closest('[data-setlang],[data-langmenu],[data-menu],[data-close],.to-top,[data-scroll],[data-admin]');
    document.querySelectorAll('.lang-wrap.open').forEach(w => { if (!el || !w.contains(el)) w.classList.remove('open'); });
    if (!el) return;
    if (el.hasAttribute('data-admin')) {
      adminClicks++; clearTimeout(adminTimer);
      adminTimer = setTimeout(() => (adminClicks = 0), 900);
      if (adminClicks >= 3) { adminClicks = 0; location.href = '/admin/'; }
      return;
    }
    if (el.hasAttribute('data-langmenu')) { el.parentElement.classList.toggle('open'); return; }
    if (el.hasAttribute('data-setlang')) {
      lang = el.dataset.setlang;
      try { localStorage.setItem('sm_lang', lang); } catch { /* */ }
      applyLang(); shell(); bindScroll(); route();
    } else if (el.hasAttribute('data-menu')) document.body.classList.add('drawer-open');
    else if (el.hasAttribute('data-close')) document.body.classList.remove('drawer-open');
    else if (el.classList.contains('to-top')) window.scrollTo({ top: 0, behavior: 'smooth' });
    else if (el.dataset.scroll) { e.preventDefault(); document.getElementById(el.dataset.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  document.addEventListener('submit', async e => {
    const f = e.target;
    if (f.matches('[data-search]')) {
      e.preventDefault();
      const p = new URLSearchParams();
      if (f.cat.value) p.set('cat', f.cat.value);
      if (f.q.value.trim()) p.set('q', f.q.value.trim());
      location.hash = '#/machines' + (p.toString() ? '?' + p : '');
    }
    if (f.matches('[data-quote]')) {
      e.preventDefault();
      const msg = f.querySelector('.form-msg');
      const data = Object.fromEntries(new FormData(f).entries());
      data.lang = lang;
      if (!data.name.trim() || (!data.phone.trim() && !data.email.trim())) { msg.className = 'form-msg err'; msg.textContent = u('required'); return; }
      const btn = f.querySelector('button[type=submit]');
      const old = btn.innerHTML; btn.disabled = true; btn.textContent = u('sending');
      try {
        const r = await fetch('/api/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!r.ok) throw new Error();
        msg.className = 'form-msg ok'; msg.textContent = u('sent'); f.reset();
      } catch { msg.className = 'form-msg err'; msg.textContent = u('sendErr'); }
      btn.disabled = false; btn.innerHTML = old;
    }
  });
  function bindScroll() {
    const top = document.querySelector('.to-top');
    const hw = document.getElementById('hwrap');
    window.onscroll = () => { top.classList.toggle('show', scrollY > 600); if (hw) hw.classList.toggle('scrolled', scrollY > 40); };
  }
  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = (LANGS.find(l => l.code === lang) || {}).dir || 'ltr';
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
  }
  const st = document.createElement('style');
  st.textContent = '@media (max-width:640px){.hide-sm{display:none!important}}';
  document.head.appendChild(st);
  /* text protection: no selecting / copying / right-click on site content (form fields still work) */
  document.body.classList.add('no-copy');
  const isField = el => !!(el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]'));
  ['copy', 'cut'].forEach(ev => document.addEventListener(ev, e => { if (!isField(e.target)) e.preventDefault(); }));
  document.addEventListener('contextmenu', e => { if (!isField(e.target)) e.preventDefault(); });
  document.addEventListener('selectstart', e => { if (!isField(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', e => { if (e.target && e.target.tagName === 'IMG') e.preventDefault(); });
  document.addEventListener('keydown', e => {
    if (isField(e.target)) return;
    const k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'a', 's', 'u', 'p'].includes(k)) e.preventDefault();
  });
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', route);
  applyLang(); shell(); bindScroll(); route();
})();
