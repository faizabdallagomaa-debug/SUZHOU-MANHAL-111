/* Suzhou Manhal — 3D globe for the hero (Three.js r128).
   Dotted continents, soft atmosphere, animated supply routes from Suzhou to every target market,
   gentle markers, light mouse parallax and labels in the current language.
   API: window.SMGlobe.mount(heroEl, slotEl, { origin:{lat,lon,label}, targets:[{lat,lon,label,show}], legend:[a,b,c] }) */
(function () {
  'use strict';
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mx = 0, my = 0;
  addEventListener('pointermove', e => { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; }, { passive: true });

  /* rough continent outlines (lon,lat) used to place land dots */
  const POLY = [
    [[-17,15],[-17,21],[-13,28],[-6,36],[10,37],[11,33],[20,31],[25,32],[32,31],[34,28],[38,18],[43,12],[51,12],[48,4],[41,-2],[40,-10],[40,-16],[35,-24],[33,-28],[27,-34],[20,-35],[18,-32],[15,-27],[12,-18],[13,-10],[9,-1],[9,4],[5,5],[-3,5],[-8,4],[-12,7],[-15,11]],
    [[33,31],[36,36],[42,37],[48,30],[50,26],[52,24],[56,26],[59,22],[57,18],[52,16],[45,13],[43,13],[39,21],[35,28]],
    [[-10,36],[-9,43],[-2,44],[-5,48],[2,51],[8,54],[8,57],[5,58],[5,62],[14,68],[25,71],[40,68],[60,69],[70,73],[80,73],[100,77],[115,74],[140,72],[160,70],[180,68],[180,65],[170,60],[163,58],[156,51],[155,59],[143,59],[137,54],[141,48],[133,43],[129,40],[129,35],[126,35],[126,38],[122,40],[121,37],[119,35],[121,31],[122,28],[117,23],[110,21],[108,19],[106,17],[109,12],[105,9],[100,13],[100,8],[103,2],[101,3],[98,8],[98,16],[94,17],[92,22],[87,21],[80,15],[77,8],[73,17],[72,21],[67,24],[61,25],[57,26],[52,28],[50,30],[48,30],[44,37],[36,36],[28,37],[26,40],[23,37],[20,40],[16,38],[12,44],[8,44],[3,43],[0,39],[-2,37],[-6,36]],
    [[-5,50],[1,51],[2,53],[-2,56],[-2,58],[-5,58],[-6,55],[-3,54],[-5,52]],
    [[-168,66],[-162,70],[-140,70],[-125,70],[-110,73],[-95,72],[-80,73],[-65,62],[-60,55],[-55,50],[-66,45],[-70,42],[-75,38],[-76,35],[-81,31],[-80,25],[-82,27],[-84,30],[-89,30],[-94,29],[-97,26],[-97,22],[-94,18],[-90,21],[-87,21],[-88,16],[-84,15],[-83,10],[-80,8],[-78,9],[-80,7],[-83,8],[-86,12],[-92,14],[-96,16],[-105,20],[-110,23],[-114,30],[-117,32],[-121,35],[-124,40],[-124,46],[-123,49],[-130,54],[-135,58],[-140,60],[-150,61],[-155,58],[-165,55],[-160,59],[-165,62]],
    [[-55,60],[-43,60],[-22,70],[-18,77],[-20,82],[-40,83],[-60,82],[-72,78],[-58,75],[-52,68]],
    [[-77,8],[-72,12],[-62,11],[-52,5],[-50,0],[-44,-2],[-35,-6],[-35,-9],[-39,-15],[-41,-22],[-48,-26],[-53,-34],[-58,-38],[-62,-40],[-65,-45],[-68,-50],[-69,-55],[-74,-52],[-74,-44],[-73,-37],[-71,-30],[-70,-18],[-76,-14],[-81,-6],[-80,-1],[-78,2]],
    [[114,-22],[114,-34],[118,-35],[124,-33],[131,-31],[135,-35],[138,-35],[140,-38],[146,-39],[150,-37],[153,-31],[153,-25],[149,-20],[146,-19],[142,-11],[141,-17],[136,-12],[131,-11],[126,-14],[122,-18]],
    [[130,31],[132,34],[135,34],[140,35],[142,40],[141,45],[144,44],[140,41],[139,38],[136,36],[132,35]],
    [[95,5],[98,4],[104,-2],[106,-6],[102,-5],[95,2]], [[109,1],[110,-3],[116,-4],[119,1],[117,7],[115,5]],
    [[131,-1],[141,-3],[150,-10],[141,-9],[138,-8],[132,-3]], [[105,-6],[114,-7],[114,-8],[106,-7]],
    [[44,-25],[47,-25],[50,-15],[49,-12],[44,-16]]
  ].map(v => { const b = [999, 999, -999, -999]; v.forEach(p => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }); return { v, b }; });
  function pip(x, y, v) { let r = false; for (let i = 0, j = v.length - 1; i < v.length; j = i++) { const a = v[i], c = v[j]; if ((a[1] > y) !== (c[1] > y) && x < (c[0] - a[0]) * (y - a[1]) / (c[1] - a[1]) + a[0]) r = !r; } return r; }
  function land(lat, lon) { if (lat < -72) return true; for (const p of POLY) { if (lon < p.b[0] || lon > p.b[2] || lat < p.b[1] || lat > p.b[3]) continue; if (pip(lon, lat, p.v)) return true; } return false; }

  let G = null;
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  let threeLoading = null;

  function build(opts) {
    const T = window.THREE, D = Math.PI / 180, V = T.Vector3;
    const canvas = document.createElement('canvas'); canvas.className = 'g3d'; canvas.setAttribute('aria-hidden', 'true');
    const lab = document.createElement('div'); lab.className = 'glbl'; lab.setAttribute('aria-hidden', 'true');
    const leg = document.createElement('div'); leg.className = 'glg'; leg.setAttribute('aria-hidden', 'true');
    let R;
    try { R = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { return null; }
    const PR = Math.min(devicePixelRatio || 1, 1.75); R.setPixelRatio(PR); R.setClearColor(0, 0);
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(35, 1, 0.1, 200); cam.position.set(0, 0, 10);
    const root = new T.Group(), tilt = new T.Group(), globe = new T.Group(); scene.add(root); root.add(tilt); tilt.add(globe);
    const ll = (lat, lon, r = 1) => { const p = (90 - lat) * D, t = (lon + 180) * D; return new V(-r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t)); };
    const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, 'rgba(210,230,255,.9)'); g.addColorStop(0.55, 'rgba(96,165,250,.28)'); g.addColorStop(1, 'rgba(59,130,246,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c); })();
    const VV = 'varying vec3 vN;varying vec3 vV;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}';
    // core + atmosphere
    globe.add(new T.Mesh(new T.SphereGeometry(0.995, 64, 64), new T.ShaderMaterial({ vertexShader: VV, fragmentShader: 'varying vec3 vN;varying vec3 vV;void main(){float f=1.-max(dot(vN,vV),0.);vec3 c=mix(vec3(.015,.07,.17),vec3(.10,.30,.62),pow(f,2.2));gl_FragColor=vec4(c,1.);}' })));
    tilt.add(new T.Mesh(new T.SphereGeometry(1.24, 64, 64), new T.ShaderMaterial({ vertexShader: VV, fragmentShader: 'varying vec3 vN;varying vec3 vV;void main(){float i=pow(clamp(-dot(vN,vV),0.,1.),2.2)*2.4;gl_FragColor=vec4(vec3(.32,.6,1.)*i,i);}', side: T.BackSide, blending: T.AdditiveBlending, transparent: true, depthWrite: false })));
    // land dots (fibonacci sphere)
    const N = 18000, pos = [], rnd = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) { const y = 1 - 2 * (i + 0.5) / N, lat = Math.asin(y) / D, lon = ((i * ga / D) % 360 + 540) % 360 - 180; if (land(lat, lon)) { const p = ll(lat, lon, 1.002); pos.push(p.x, p.y, p.z); rnd.push(Math.random()); } }
    const dg = new T.BufferGeometry(); dg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); dg.setAttribute('rnd', new T.Float32BufferAttribute(rnd, 1));
    const dotU = { uT: { value: 0 }, uPx: { value: 3 }, uC: { value: new T.Color('#bcdcff') } };
    globe.add(new T.Points(dg, new T.ShaderMaterial({ uniforms: dotU, transparent: true, depthWrite: false,
      vertexShader: 'attribute float rnd;uniform float uT,uPx;varying float vA;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vec3 n=normalize(normalMatrix*position);float f=dot(n,normalize(-mv.xyz));vA=smoothstep(.0,.45,f)*(.9+.1*sin(uT*1.2+rnd*6.283));gl_PointSize=uPx*(.8+.4*rnd);gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'uniform vec3 uC;varying float vA;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(uC,vA*smoothstep(.5,.05,d));}' })));
    // grid lines
    const lm = new T.LineBasicMaterial({ color: 0x5b9cf0, transparent: true, opacity: 0.05 });
    for (let la = -60; la <= 60; la += 30) { const p = []; for (let lo = -180; lo <= 180; lo += 4) p.push(ll(la, lo, 1.003)); globe.add(new T.Line(new T.BufferGeometry().setFromPoints(p), lm)); }
    for (let lo = -180; lo < 180; lo += 30) { const p = []; for (let la = -90; la <= 90; la += 4) p.push(ll(la, lo, 1.003)); globe.add(new T.Line(new T.BufferGeometry().setFromPoints(p), lm)); }
    // routes
    class Arc extends T.Curve {
      constructor(a, b) { super(); this.a = a; this.b = b; this.w = a.angleTo(b); this.h = 0.06 + this.w * 0.3; }
      getPoint(t, o = new V()) { const w = this.w, s = Math.sin(w); o.copy(this.a).multiplyScalar(Math.sin((1 - t) * w) / s).addScaledVector(this.b, Math.sin(t * w) / s); return o.multiplyScalar(1 + this.h * Math.sin(Math.PI * t)); }
    }
    const a0 = ll(opts.origin.lat, opts.origin.lon), arcs = [], rings = [];
    const ringG = new T.RingGeometry(0.011, 0.016, 40);
    function marker(p, col, big) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: col, blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.position.copy(p).multiplyScalar(1.01); sp.scale.setScalar(big ? 0.16 : 0.075); globe.add(sp);
      const m = new T.Mesh(ringG, new T.MeshBasicMaterial({ color: col, transparent: true, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
      m.position.copy(p).multiplyScalar(1.006); m.quaternion.setFromUnitVectors(new V(0, 0, 1), p.clone().normalize()); globe.add(m); rings.push({ m, o: Math.random(), big });
    }
    marker(a0, new T.Color('#ffd27a'), 1);
    const arcVS = 'varying float vT;void main(){vT=uv.x;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
    const arcFS = 'uniform float uH,uD;uniform vec3 uC;varying float vT;void main(){float d=uH-vT;float tr=step(0.,d)*(1.-smoothstep(0.,.3,d));float a=.16*step(vT,uD)+tr*.95;gl_FragColor=vec4(mix(uC,vec3(1.,.95,.85),pow(tr,3.)),a);}';
    (opts.targets || []).forEach((c, i) => {
      const b = ll(c.lat, c.lon); marker(b, new T.Color(c.focus ? '#8ec5ff' : '#a9c4ee'));
      const cv = new Arc(a0, b);
      const u = { uH: { value: -1 }, uD: { value: RM ? 1 : 0 }, uC: { value: new T.Color(c.focus ? '#6fb0ff' : '#9db8e8') } };
      globe.add(new T.Mesh(new T.TubeGeometry(cv, 72, 0.0042, 6, false), new T.ShaderMaterial({ uniforms: u, vertexShader: arcVS, fragmentShader: arcFS, transparent: true, depthWrite: false, blending: T.AdditiveBlending })));
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xfff3d6, blending: T.AdditiveBlending, depthWrite: false, transparent: true })); sp.scale.setScalar(0.085); sp.visible = false; globe.add(sp);
      arcs.push({ cv, u, sp, o: i * 0.37 % 1.6, s: 0.26 + (i % 4) * 0.03 });
    });
    // labels
    const labels = [];
    function setLabels(o) {
      lab.innerHTML = ''; labels.length = 0;
      const add = (lat, lon, txt, cls) => { const el = document.createElement('div'); el.className = 'gl ' + cls; const b = document.createElement('b'); b.textContent = txt; el.appendChild(b); lab.appendChild(el); labels.push({ el, p: ll(lat, lon, 1.01) }); };
      add(o.origin.lat, o.origin.lon, o.origin.label, 'o t');
      (o.targets || []).filter(t => t.show).forEach(t => add(t.lat, t.lon, t.label, t.cls || 'b'));
      leg.innerHTML = (o.legend || []).length ? `<span><i class="o"></i>${esc(o.legend[0])}</span><span><i></i>${esc(o.legend[1])}</span><span><i class="ln"></i>${esc(o.legend[2])}</span>` : '';
    }
    setLabels(opts);
    const _w = new V(), _c = new V(), _n = new V(), _k = new V();
    function placeLabels(t) {
      _c.setFromMatrixPosition(globe.matrixWorld);
      labels.forEach(l => {
        _w.copy(l.p).applyMatrix4(globe.matrixWorld); _n.copy(_w).sub(_c).normalize(); _k.copy(cam.position).sub(_w).normalize();
        const f = _n.dot(_k); _w.project(cam);
        l.el.style.transform = 'translate3d(' + ((_w.x + 1) / 2 * W).toFixed(1) + 'px,' + ((1 - _w.y) / 2 * H).toFixed(1) + 'px,0)';
        l.el.classList.toggle('v', f > 0.3 && (RM || t > 2.6));
      });
    }
    // view centred on China ↔ Middle East
    const LON = 78, LAT = 26, baseRY = -(LON + 90) * D, baseRX = LAT * D;
    let W = 1, H = 1, S = 1, bx = 0, by = 0, wide = true;
    function layout() {
      if (!G || !G.hero) return;
      const r = G.hero.getBoundingClientRect(), s = G.slot ? G.slot.getBoundingClientRect() : null;
      W = Math.max(1, r.width); H = Math.max(1, r.height); R.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
      const wpp = 2 * Math.tan(17.5 * D) * 10 / H;
      let cx, cy, rad;
      wide = W > 900;
      if (s && s.width > 10 && s.height > 10) { cx = s.left + s.width / 2 - r.left; cy = s.top + s.height / 2 - r.top; rad = Math.min(s.width * 0.42, s.height * 0.38, 270); }
      else { rad = Math.min(W * 0.4, 220); cx = W / 2; cy = H - rad - 120; }
      leg.style.left = cx + 'px'; leg.style.top = (cy + rad + 30) + 'px';
      bx = (cx - W / 2) * wpp; by = -(cy - H / 2) * wpp; S = rad * wpp;
      dotU.uPx.value = Math.max(2, Math.min(4.2, rad / 70)) * PR;
      if (RM) draw(0);
    }
    const t0 = performance.now() / 1000;
    const ease = x => 1 - Math.pow(1 - x, 3);
    function draw(t) {
      const k = RM ? 1 : ease(Math.min(1, t / 2.8)), sc = Math.min(1, scrollY / H);
      root.position.set(bx, by + sc * S * (wide ? 0.9 : 0.3), 0); root.scale.setScalar(S * (0.72 + 0.28 * k));
      tilt.rotation.x += (my * 0.06 - tilt.rotation.x) * 0.04; tilt.rotation.y += (mx * 0.1 - tilt.rotation.y) * 0.04;
      globe.rotation.set(baseRX, baseRY - (1 - k) * 2.6 + (RM ? 0 : Math.sin(t * 0.15) * 0.2) + sc * 0.9, 0);
      dotU.uT.value = t;
      arcs.forEach((a, i) => {
        if (!RM) a.u.uD.value = Math.max(0, Math.min(1, (t - 1 - i * 0.12) / 1.2));
        const hd = RM ? -1 : ((t * a.s + a.o) % 1.7) - 0.15; a.u.uH.value = hd;
        if (hd >= 0 && hd <= 1 && t > 1.5) { a.sp.visible = true; a.cv.getPoint(hd, a.sp.position); } else a.sp.visible = false;
      });
      rings.forEach(rg => { const p = RM ? 0.3 : (t * 0.55 + rg.o) % 1; rg.m.scale.setScalar(1 + p * (rg.big ? 2.5 : 1.5)); rg.m.material.opacity = 1 - p; });
      R.render(scene, cam); placeLabels(t);
    }
    let vis = true;
    function loop() { requestAnimationFrame(loop); if (!vis || document.hidden || RM || !G.hero || !G.hero.isConnected) return; draw(performance.now() / 1000 - t0); }
    const io = new IntersectionObserver(e => { vis = e[0].isIntersecting; }, { threshold: 0 });
    const ro = new ResizeObserver(() => layout());
    return { canvas, lab, leg, io, ro, layout, setLabels, draw, start() { draw(RM ? 0 : 0.001); const show = () => canvas.classList.add('on'); requestAnimationFrame(show); setTimeout(show, 400); loop(); } };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  window.SMGlobe = {
    supported() {
      if (!window.THREE) return false;
      try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; }
    },
    mount(hero, slot, opts) {
      // Three.js is loaded on demand (only when a page with the globe is shown)
      if (!window.THREE) {
        if (!threeLoading) threeLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = THREE_URL; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
        threeLoading.then(() => { if (hero.isConnected) this.mount(hero, slot, opts); }).catch(() => hero.classList.add('no3d'));
        return false;
      }
      if (!this.supported()) { hero.classList.add('no3d'); return false; }
      if (!G) {
        const g = build(opts);
        if (!g) { hero.classList.add('no3d'); return false; }
        G = g; G.hero = hero; G.slot = slot;
        hero.prepend(G.leg); hero.prepend(G.lab); hero.prepend(G.canvas);
        G.io.observe(hero); G.ro.observe(hero);
        G.layout(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(G.layout);
        G.start();
        return true;
      }
      // re-mount into a freshly rendered hero (SPA navigation / language change)
      G.hero = hero; G.slot = slot; G.setLabels(opts);
      hero.prepend(G.leg); hero.prepend(G.lab); hero.prepend(G.canvas);
      G.io.disconnect(); G.io.observe(hero); G.ro.disconnect(); G.ro.observe(hero); G.layout();
      return true;
    }
  };
})();
