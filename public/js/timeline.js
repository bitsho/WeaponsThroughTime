/* Weapons Through Time — carrier-aircraft timeline */
(function () {
  'use strict';
  const S = window.WTTShared, I18N = window.WTT_I18N;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* unavailable */ } } };
  let lang = store.get('wtt-lang') || ((navigator.language || '').startsWith('zh') ? 'zh' : 'en');
  const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
  const L = (o) => (o ? o[lang] || o.en || '' : '');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const num = (n) => (n == null ? '—' : Number(n).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US'));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MONTHS = { en: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'] };
  const fmtDate = (v) => { if (!v) return '—'; const m = String(v).match(/^(\d{4})(?:-(\d{2}))?/); if (!m) return v; return m[2] ? (lang === 'zh' ? `${m[1]}年${+m[2]}月` : `${MONTHS.en[+m[2] - 1]} ${m[1]}`) : m[1]; };
  const yearOf = (v) => (v ? String(v).slice(0, 4) : '');

  /* ---------------- state ---------------- */
  const VIEW = { from: 1935, to: 1951 };          // visible window [from, to)
  const st = { ppy: 90, roles: new Set(), branches: new Set(['USN', 'USMC']), sel: null, selConflict: null, query: '' };
  let D = null, ROLE = {}, AC = [], BYID = {}, CF = [], LINKS = [], PMAX = 1, RANK = {};
  let geo = {};          // id → { x0, x1, top (world), barY (world) }
  const gutter = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 176;
  const PADL = 26;
  const X = (y) => gutter() + PADL + (y - VIEW.from) * st.ppy;
  const worldW = () => X(VIEW.to) + 80;

  /* ---------------- image helpers ---------------- */
  const media = (a) => a.media || {};
  const icon = (a) => { const m = media(a); return m.cutout ? { src: m.cutout, w: m.cutoutW, h: m.cutoutH, cut: true } : m.photo ? { src: m.thumb || m.photo, w: m.photoW || 16, h: m.photoH || 10, cut: false } : null; };
  const imgW = (a) => Math.round(62 + 178 * Math.sqrt(a.production / PMAX));
  const imgH = (a) => { const ic = icon(a); const w = imgW(a); return ic ? Math.min(Math.round(w * (ic.h / ic.w)), Math.round(w * 0.62)) : Math.round(w * 0.32); };

  /* ---------------- boot ---------------- */
  async function boot() {
    applyLang();
    const t0 = performance.now();
    const res = await WTTApi.loadBundle('usa');
    D = res.data;
    D.taxonomy.roles.forEach((r) => { ROLE[r.id] = r; st.roles.add(r.id); });
    AC = D.aircraft.filter((a) => a.basing === 'carrier');
    AC.forEach((a) => { BYID[a.id] = a; a._span = S.serviceSpan(a); });
    PMAX = Math.max(...AC.map((a) => a.production));
    [...AC].sort((a, b) => b.production - a.production).forEach((a, i) => { RANK[a.id] = i + 1; });
    CF = D.conflicts.map((c) => Object.assign({ _span: S.conflictSpan(c) }, c));
    LINKS = D.lineage.filter((l) => BYID[l.from] && BYID[l.to]);
    // preload icons (max 2.5 s), then reveal
    await Promise.race([Promise.all(AC.map((a) => new Promise((ok) => { const ic = icon(a); if (!ic) return ok(); const im = new Image(); im.onload = im.onerror = ok; im.src = ic.src; }))), new Promise((ok) => setTimeout(ok, 2500))]);
    const wait = Math.max(0, 1500 - (performance.now() - t0));
    setTimeout(() => {
      $('#boot').classList.add('done');
      buildChips(); fit(true); render(); bind();
      window.__WTT_READY__ = true;
    }, wait);
  }

  /* ---------------- language ---------------- */
  function scramble(node, text) {
    const glyphs = '█▓▒░<>/\\#%&*01ΔΣΩ';
    let f = 0; const n = 14;
    const run = () => { f++; node.textContent = text.split('').map((ch, i) => (ch === ' ' || i < (f / n) * text.length) ? ch : glyphs[(Math.random() * glyphs.length) | 0]).join(''); if (f < n) requestAnimationFrame(run); else node.textContent = text; };
    run();
  }
  function applyLang(animate) {
    document.documentElement.dataset.lang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    $$('[data-i18n]').forEach((n) => { const v = t(n.dataset.i18n); if (animate && n.hasAttribute('data-scramble')) scramble(n, v); else n.textContent = v; });
    $$('[data-i18n-ph]').forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
    $$('[data-i18n-title]').forEach((n) => { n.title = t(n.dataset.i18nTitle); });
  }

  /* ---------------- filters ---------------- */
  function buildChips() {
    const rc = $('#roleChips'); $$('.chip', rc).forEach((c) => c.remove());
    D.taxonomy.roles.forEach((r) => {
      const n = AC.filter((a) => a.role === r.id).length; if (!n) return;
      const b = el('button', 'chip' + (st.roles.has(r.id) ? ' on' : ''), `<i></i>${esc(L(r.label))}<b>${n}</b>`);
      b.style.setProperty('--c', r.color);
      b.onclick = () => { st.roles.has(r.id) ? st.roles.delete(r.id) : st.roles.add(r.id); if (!st.roles.size) D.taxonomy.roles.forEach((x) => st.roles.add(x.id)); buildChips(); render(); };
      rc.appendChild(b);
    });
    const bc = $('#branchChips'); $$('.chip', bc).forEach((c) => c.remove());
    D.taxonomy.branches.forEach((br) => {
      const b = el('button', 'chip' + (st.branches.has(br.id) ? ' on' : ''), `<i></i>${br.id}`);
      b.title = L(br.label); b.style.setProperty('--c', br.id === 'USMC' ? '#ffb547' : '#38e1ff');
      b.onclick = () => { st.branches.has(br.id) ? st.branches.delete(br.id) : st.branches.add(br.id); if (!st.branches.size) st.branches.add(br.id === 'USN' ? 'USMC' : 'USN'); buildChips(); applyDim(); };
      bc.appendChild(b);
    });
  }

  /* ---------------- layout ---------------- */
  function fit(initial) {
    const w = $('#scroller').clientWidth - gutter() - PADL - 40;
    st.ppy = Math.max(64, Math.min(220, w / (VIEW.to - VIEW.from)));
    if (!initial) render();
  }
  function packRows(items, startFn, endFn) {
    const rows = [];
    items.forEach((it) => {
      const s = startFn(it), e = endFn(it);
      let r = rows.findIndex((row) => row.end <= s);
      if (r < 0) { rows.push({ end: e, items: [] }); r = rows.length - 1; }
      rows[r].end = e; rows[r].items.push(it); it._row = r;
    });
    return rows;
  }
  const textW = (s, px = 6.6) => [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? px * 1.75 : px), 0);

  function render() {
    const world = $('#world'), bands = $('#bands');
    world.style.width = worldW() + 'px';
    bands.innerHTML = ''; geo = {};
    renderAxis();
    // conflicts band
    bands.appendChild(conflictBand());
    // lanes
    D.taxonomy.roles.forEach((r) => {
      const list = AC.filter((a) => a.role === r.id);
      if (!list.length) return;
      bands.appendChild(lane(r, list));
    });
    bands.appendChild(statsBand());
    // measure absolute positions for links
    renderEras();
    requestAnimationFrame(() => { measure(); drawLinks(); applyDim(); const cb = $('.band.conflicts'), sp = $('.eras .ww2 span'); if (cb && sp) sp.style.marginTop = (cb.offsetHeight + 4) + 'px'; });
  }
  function renderAxis() {
    const ax = $('#axis'); ax.innerHTML = '';
    ax.appendChild(el('div', 'corner', esc(t('corner'))));
    for (let y = VIEW.from; y <= VIEW.to; y++) {
      const tk = el('div', 'tick' + (y % 5 === 0 ? ' major' : ''), `<span>${y}</span>`);
      tk.style.left = X(y) + 'px'; tk.dataset.y = y; ax.appendChild(tk);
    }
  }
  function renderEras() {
    const er = $('#eras'); er.innerHTML = '';
    for (let y = VIEW.from; y <= VIEW.to; y++) { const l = el('i', 'yl'); l.style.left = X(y) + 'px'; er.appendChild(l); }
    const w = el('div', 'ww2', `<span>${esc(t('era_ww2'))}</span>`);
    const a = S.toYear('1941-12-07'), b = S.toYear('1945-09-02');
    w.style.left = X(a) + 'px'; w.style.width = (X(b) - X(a)) + 'px'; er.appendChild(w);
  }
  function bandShell(cls, label, sub, color, h) {
    const b = el('section', 'band ' + cls);
    b.style.height = h + 'px'; if (color) b.style.setProperty('--c', color);
    b.appendChild(el('div', 'lane-label', `<i class="lbar" style="--c:${color || 'var(--cyan)'}"></i><span class="ln" style="--c:${color || 'var(--cyan)'}">${esc(label)}</span><span class="ls">${esc(sub)}</span>`));
    const tr = el('div', 'lane-track'); b.appendChild(tr);
    return { b, tr };
  }
  function conflictBand() {
    const items = CF.map((c) => {
      const sp = c._span, x0 = X(Math.max(sp.start, VIEW.from)), x1 = sp.point ? x0 : X(Math.min(sp.end, VIEW.to));
      const label = L(c.name);
      const lw = textW(label, 6.2) + (sp.point ? 22 : 18);
      return { c, x0, x1, w: sp.point ? lw : Math.max(x1 - x0, lw), end: sp.point ? x0 + lw + 10 : Math.max(x1, x0 + lw) + 8 };
    }).sort((a, b) => a.x0 - b.x0);
    const rows = packRows(items, (i) => i.x0 - 4, (i) => i.end);
    const RH = 22, H = rows.length * RH + 20;
    const { b, tr } = bandShell('conflicts', t('band_conflicts'), t('band_conflicts_sub'), '#ff6b4a', H);
    items.forEach((it, i) => {
      const c = it.c, sp = c._span;
      const e = el('div', `cf ${c.type}${c.type === 'war' && (c.magnitude || 1) < 2 ? ' minor' : ''}`);
      e.style.left = it.x0 + 'px'; e.style.top = (12 + it._row * RH + (c.type === 'war' ? 3 : 0)) + 'px';
      if (sp.point) {
        const s = 8 + (c.magnitude || 1) * 3;
        e.innerHTML = c.type === 'milestone' ? `<i class="dia"></i><span>${esc(L(c.name))}</span>` : `<i class="star" style="--s:${s}px;--d:${(i * 0.37) % 3}s"></i><span>${esc(L(c.name))}</span>`;
      } else { e.style.width = it.w + 'px'; e.innerHTML = `<i class="span" style="width:${Math.max(it.x1 - it.x0, 6)}px"></i><span>${esc(L(c.name))}</span>`; }
      e.dataset.cid = c.id;
      e.addEventListener('mouseenter', (ev) => tipConflict(c, ev));
      e.addEventListener('mousemove', moveTip); e.addEventListener('mouseleave', hideTip);
      e.addEventListener('click', (ev) => { ev.stopPropagation(); selectConflict(c.id); });
      tr.appendChild(e);
    });
    return b;
  }
  function lane(r, list) {
    const visible = st.roles.has(r.id);
    const items = list.map((a) => {
      const sp = a._span;
      const x0 = X(Math.max(sp.start, VIEW.from)), x1 = X(Math.min(sp.end, VIEW.to)), xf = X(Math.min(sp.frontlineEnd, VIEW.to));
      const w = imgW(a), h = imgH(a);
      const label = `${a.designation}  ${L(a.nickname)}  ${num(a.production)}`;
      return { a, x0, x1, xf, w, h, end: Math.max(x1 + (sp.end > VIEW.to ? 14 : 0), x0 + w + 6, x0 + textW(label)) + 16 };
    }).sort((p, q) => p.x0 - q.x0 || q.a.production - p.a.production);
    const rows = packRows(items, (i) => i.x0 - 6, (i) => i.end);
    const rowH = rows.map((row) => Math.max(...row.items.map((i) => i.h)) + 44);
    const H = rowH.reduce((s, h) => s + h, 0) + 16;
    const { b, tr } = bandShell('lane', L(r.label), `${list.length} ${t('types')}`, r.color, H);
    if (!visible) b.classList.add('hidden-lane');
    b.dataset.role = r.id;
    const tops = []; rowH.reduce((acc, h, i) => { tops[i] = acc; return acc + h; }, 10);
    items.forEach((it, k) => {
      const a = it.a, sp = a._span, ic = icon(a);
      const node = el('div', 'ac'); node.dataset.id = a.id;
      node.style.setProperty('--c', r.color);
      node.style.setProperty('--delay', (0.15 + (sp.start - VIEW.from) * 0.05 + k * 0.03).toFixed(2) + 's');
      node.style.setProperty('--bob', (-(k * 1.37) % 6).toFixed(2) + 's');
      node.style.left = it.x0 + 'px'; node.style.top = tops[it._row] + 'px';
      node.style.width = Math.max(it.w, it.x1 - it.x0) + 'px'; node.style.height = rowH[it._row] - 8 + 'px';
      const pre = sp.start < VIEW.from, cont = sp.end > VIEW.to;
      const imgHtml = ic ? `<img src="${esc(ic.src)}" alt="${esc(L(a.name))}" loading="lazy" decoding="async">` : `<span class="lg-ac l" style="display:block;width:100%;height:${it.h}px;background:var(--c);opacity:.5"></span>`;
      node.innerHTML = `
        <div class="img${ic && !ic.cut ? ' photo' : ''}" style="width:${it.w}px">${imgHtml}</div>
        <i class="ring" style="width:${it.w + 16}px;height:${it.h + 12}px"></i>
        <div class="bar${pre ? ' pre' : ''}" style="width:${Math.max(4, it.x1 - it.x0)}px"><i class="fr" style="width:${Math.max(0, it.xf - it.x0)}px"></i>${cont ? '<i class="cont"></i>' : ''}</div>
        <div class="lbl"><b>${esc(a.designation)}</b><em>${esc(L(a.nickname))}</em><span class="n">${num(a.production)}</span>${pre ? `<span class="n">· ${t('since')} ${yearOf(a.service.start)}</span>` : ''}${cont ? `<span class="n">→ ${yearOf(a.service.end)}</span>` : ''}</div>`;
      node.addEventListener('mouseenter', (ev) => tipAircraft(a, ev));
      node.addEventListener('mousemove', moveTip); node.addEventListener('mouseleave', hideTip);
      node.addEventListener('click', (ev) => { ev.stopPropagation(); selectAircraft(a.id); });
      tr.appendChild(node);
      geo[a.id] = { x0: it.x0, x1: it.x1, node, h: it.h, w: it.w };
    });
    return b;
  }
  function statsBand() {
    const rows = S.inServiceByYear(AC.filter((a) => st.roles.has(a.role)), VIEW.from, VIEW.to - 1, (a) => a.role);
    const max = Math.max(...rows.map((r) => r.total), 1);
    const H = 150, unit = (H - 64) / max;
    const { b, tr } = bandShell('stats', t('band_stats'), t('band_stats_sub'), '#3dff9e', H);
    rows.forEach((row, i) => {
      const c = el('div', 'col');
      const w = Math.max(10, st.ppy * 0.42);
      c.style.left = (X(row.year + 0.5) - w / 2) + 'px'; c.style.width = w + 'px';
      c.style.setProperty('--delay', (0.6 + i * 0.04) + 's');
      D.taxonomy.roles.forEach((r) => { const n = row.by[r.id] || 0; if (!n) return; const seg = el('i'); seg.style.height = n * unit - 1 + 'px'; seg.style.setProperty('--c', r.color); seg.title = `${L(r.label)} · ${n}`; c.appendChild(seg); });
      c.appendChild(el('span', 'cnt', String(row.total)));
      c.title = `${row.year} · ${row.total} ${t('types')} ${t('in_service_at')}`;
      tr.appendChild(c);
    });
    return b;
  }
  function measure() {
    const wr = $('#world').getBoundingClientRect();
    Object.values(geo).forEach((g) => {
      const r = g.node.getBoundingClientRect();
      const lane = g.node.closest('.band');
      g.visible = !lane.classList.contains('hidden-lane');
      g.top = r.top - wr.top; g.bottom = r.bottom - wr.top;
      g.barY = g.bottom - 19;   // centre of the 6px bar (bar sits 16px above the node bottom)
    });
  }

  /* ---------------- lineage links ---------------- */
  function drawLinks() {
    const svg = $('#links');
    const W = worldW(), H = $('#world').scrollHeight;
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    LINKS.forEach((l) => {
      const A = geo[l.from], B = geo[l.to]; if (!A || !B || !A.visible || !B.visible) return;
      const ex = B.x0, ey = B.barY;
      let sx = Math.min(A.x1, Math.max(A.x0 + 8, ex - 40)), sy = A.barY;
      const dx = Math.max(30, Math.abs(ex - sx) * 0.5);
      const d = `M${sx} ${sy} C${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}`;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); p.setAttribute('class', l.type); p.dataset.from = l.from; p.dataset.to = l.to;
      p.style.setProperty('--c', ROLE[BYID[l.to].role].color);
      svg.appendChild(p);
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', ex); c.setAttribute('cy', ey); c.setAttribute('r', 2.4); c.setAttribute('class', 'arrow'); svg.appendChild(c);
    });
  }
  function chain(id) {
    const set = new Set([id]);
    const walk = (k, dir) => LINKS.forEach((l) => { const [a, b] = dir > 0 ? [l.from, l.to] : [l.to, l.from]; if (a === k && !set.has(b)) { set.add(b); walk(b, dir); } });
    walk(id, 1); walk(id, -1);
    return set;
  }

  /* ---------------- highlight state ---------------- */
  function applyDim() {
    const q = st.query.trim().toLowerCase();
    let focus = null;
    if (st.sel) focus = chain(st.sel);
    if (st.selConflict) focus = new Set(AC.filter((a) => (a.conflicts || []).includes(st.selConflict)).map((a) => a.id));
    $$('.ac').forEach((n) => {
      const a = BYID[n.dataset.id];
      const branchOk = (a.branches || []).some((b) => st.branches.has(b));
      const hit = q && [a.designation, a.id, L(a.name), a.name.en, a.name.zh, L(a.nickname), a.nickname && a.nickname.en, a.manufacturer && a.manufacturer.en].filter(Boolean).some((s) => s.toLowerCase().includes(q));
      n.classList.toggle('hit', !!hit);
      n.classList.toggle('sel', st.sel === a.id);
      n.classList.toggle('dim', !branchOk || (focus && !focus.has(a.id)) || (q && !hit));
    });
    $$('#links path').forEach((p) => {
      const on = st.sel && focus.has(p.dataset.from) && focus.has(p.dataset.to);
      p.classList.toggle('on', !!on); p.classList.toggle('off', !!((st.sel || st.selConflict) && !on));
    });
    const selA = st.sel && BYID[st.sel];
    $$('.cf').forEach((n) => {
      const id = n.dataset.cid;
      n.classList.toggle('sel', st.selConflict === id || !!(selA && (selA.conflicts || []).includes(id)));
      n.classList.toggle('dim', !!((st.selConflict && st.selConflict !== id) || (selA && !(selA.conflicts || []).includes(id))));
    });
  }
  function selectAircraft(id) {
    st.sel = st.sel === id && $('#panel').classList.contains('open') ? null : id; st.selConflict = null;
    hideGuide(); applyDim();
    if (st.sel) openPanel(panelAircraft(BYID[id])); else closePanel();
  }
  function selectConflict(id) {
    st.selConflict = st.selConflict === id ? null : id; st.sel = null;
    applyDim();
    if (st.selConflict) { const c = CF.find((x) => x.id === id); showGuide(c); openPanel(panelConflict(c)); } else { hideGuide(); closePanel(); }
  }
  function showGuide(c) {
    const g = $('#guide'), sp = c._span;
    const x0 = X(Math.max(sp.start, VIEW.from)), x1 = sp.point ? x0 + 1 : X(Math.min(sp.end, VIEW.to));
    g.className = 'guide' + (sp.point ? ' point' : '');
    g.style.left = x0 + 'px'; g.style.width = Math.max(1, x1 - x0) + 'px';
    void g.offsetWidth; g.classList.add('on');
  }
  function hideGuide() { $('#guide').classList.remove('on'); }

  /* ---------------- tooltip ---------------- */
  const tip = $('#tooltip');
  function tipAircraft(a, ev) {
    const r = ROLE[a.role];
    tip.style.setProperty('--tc', r.color);
    tip.innerHTML = `<div class="tt-k">${esc(L(r.label))}</div><div class="tt-t">${esc(L(a.name))}</div>
      <div class="tt-r"><span>${t('service')}</span><b>${yearOf(a.service.start)}–${yearOf(a.service.end)}</b></div>
      <div class="tt-r"><span>${t('built')}</span><b>${num(a.production)}</b></div>
      <div class="tt-r"><span>${t('production_rank')}</span><b>#${RANK[a.id]} / ${AC.length}</b></div>
      <div class="tt-h">${t('tip_click')}</div>`;
    tip.classList.add('on'); moveTip(ev);
  }
  function tipConflict(c, ev) {
    const sp = c._span;
    tip.style.setProperty('--tc', c.type === 'milestone' ? '#9b8cff' : '#ff6b4a');
    const n = AC.filter((a) => (a.conflicts || []).includes(c.id)).length;
    tip.innerHTML = `<div class="tt-k">${esc(L((D.taxonomy.conflictTypes.find((x) => x.id === c.type) || {}).label))}</div><div class="tt-t">${esc(L(c.name))}</div>
      <div class="tt-r"><span>${t('dates')}</span><b>${sp.point ? fmtDate(c.date) : fmtDate(c.start) + ' – ' + fmtDate(c.end)}</b></div>
      ${n ? `<div class="tt-r"><span>${t('aircraft_in')}</span><b>${n}</b></div>` : ''}<div class="tt-h">${t('tip_click')}</div>`;
    tip.classList.add('on'); moveTip(ev);
  }
  function moveTip(ev) { const w = tip.offsetWidth, h = tip.offsetHeight; let x = ev.clientX + 16, y = ev.clientY + 16; if (x + w > innerWidth - 8) x = ev.clientX - w - 16; if (y + h > innerHeight - 8) y = ev.clientY - h - 16; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
  function hideTip() { tip.classList.remove('on'); }

  /* ---------------- panel ---------------- */
  function openPanel(html) { const p = $('#panel'); $('#panelBody').innerHTML = ''; $('#panelBody').appendChild(html); p.classList.add('open'); p.setAttribute('aria-hidden', 'false'); p.scrollTop = 0; requestAnimationFrame(() => $$('.pbar i', p).forEach((i) => { i.style.width = i.dataset.w + '%'; })); }
  function closePanel() { const p = $('#panel'); p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); }
  function credit(m) {
    if (!m || !m.credit) return '';
    const c = m.credit;
    return `<p class="p-credit">${t('photo')}: ${esc(c.author || '—')} · ${esc(c.license || '')}${c.year ? ' · ' + esc(c.year) : ''} · <a href="${esc(c.source)}" target="_blank" rel="noopener">${t('source')}</a></p>`;
  }
  function panelAircraft(a) {
    const r = ROLE[a.role], sp = a.specs || {}, m = media(a);
    const box = el('div'); box.style.setProperty('--c', r.color);
    $('#panelBody').style.setProperty('--c', r.color);
    const total = AC.reduce((s, x) => s + x.production, 0);
    const from = LINKS.filter((l) => l.to === a.id), to = LINKS.filter((l) => l.from === a.id);
    const chip = (id, extra) => { const x = BYID[id]; return `<button class="p-chip" data-go="${id}" style="--cc:${ROLE[x.role].color}">${esc(x.designation)} <small>${esc(L(x.nickname))}${extra ? ' · ' + esc(extra) : ''}</small></button>`; };
    const linkType = (id) => L((D.taxonomy.linkTypes.find((x) => x.id === id) || {}).label);
    const cfs = CF.filter((c) => (a.conflicts || []).includes(c.id)).sort((p, q) => p._span.start - q._span.start);
    box.innerHTML = `
      ${m.photo ? `<div class="p-photo"><img src="${esc(m.photo)}" alt="${esc(L(a.name))}"><i class="scan"></i></div>${credit(m)}` : ''}
      <div class="p-role">${esc(L(r.label))}<span class="tag">⚓ ${t('basing_carrier')}</span><span class="tag">${(a.branches || []).join(' / ')}</span><span class="tag">${esc(L((D.taxonomy.propulsion.find((x) => x.id === a.propulsion) || {}).label))}</span></div>
      <div class="p-name">${esc(L(a.name))}</div>
      <div class="p-sub">${esc(a.designation)}${L(a.nickname) ? ' · “' + esc(L(a.nickname)) + '”' : ''} · ${esc(L(a.manufacturer))}</div>
      <div class="p-grid">
        <div><label>${t('service')}</label><b>${yearOf(a.service.start)}–${yearOf(a.service.end)}</b></div>
        <div><label>${t('fl_until')}</label><b>${fmtDate(a.service.frontlineEnd)}</b></div>
        <div class="wide"><label>${t('built')} · ${t('production_rank')} #${RANK[a.id]}/${AC.length}</label><b>${num(a.production)}</b><div class="pbar"><i data-w="${(a.production / PMAX * 100).toFixed(1)}"></i></div>${a.productionNote ? `<div class="p-note">${esc(L(a.productionNote))}</div>` : ''}</div>
        <div><label>${t('first_flight')}</label><b>${fmtDate(a.firstFlight)}</b></div>
        <div><label>${t('max_speed')}</label><b>${num(sp.maxSpeed)} ${t('kmh')}</b></div>
        <div><label>${t('range')}</label><b>${sp.range ? num(sp.range) + ' ' + t('km') : '—'}</b></div>
        <div><label>${t('ceiling')}</label><b>${sp.ceiling ? num(sp.ceiling) + ' ' + t('m') : '—'}</b></div>
        <div><label>${t('length')} / ${t('span')}</label><b>${sp.length} / ${sp.span} ${t('m')}</b></div>
        <div><label>${t('crew')}</label><b>${sp.crew ?? '—'}</b></div>
      </div>
      <div class="p-row"><label>${t('engine')}</label><span>${esc(L(sp.engine))}</span></div>
      <div class="p-row"><label>${t('armament')}</label><span>${esc(L(sp.armament))}</span></div>
      <h4>${t('combat')}</h4>
      ${cfs.length ? `<div class="p-chips">${cfs.map((c) => `<button class="p-chip" data-cf="${c.id}" style="--cc:${c.type === 'milestone' ? '#9b8cff' : '#ff6b4a'}">${esc(L(c.name))} <small>${yearOf(c.date || c.start)}</small></button>`).join('')}</div>` : `<div class="p-note">${t('no_combat')}</div>`}
      ${from.length || to.length ? `<h4>${t('lineage')}</h4>
        ${from.length ? `<div class="p-row"><label>${t('predecessors')}</label><div class="p-chips">${from.map((l) => chip(l.from, linkType(l.type))).join('')}</div></div>` : ''}
        ${to.length ? `<div class="p-row"><label>${t('successors')}</label><div class="p-chips">${to.map((l) => chip(l.to, linkType(l.type))).join('')}</div></div>` : ''}` : ''}
      <h4>${t('history')}</h4>
      <div class="p-desc">${esc(L(a.desc))}</div>
      ${a.wiki ? `<a class="p-link" href="${esc(a.wiki[lang] || a.wiki.en)}" target="_blank" rel="noopener">${t('wiki')} →</a>` : ''}`;
    box.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { selectAircraft(b.dataset.go); scrollToAircraft(b.dataset.go); }));
    box.querySelectorAll('[data-cf]').forEach((b) => b.addEventListener('click', () => selectConflict(b.dataset.cf)));
    return box;
  }
  function panelConflict(c) {
    const color = c.type === 'milestone' ? '#9b8cff' : '#ff6b4a';
    const box = el('div'); $('#panelBody').style.setProperty('--c', color);
    const list = AC.filter((a) => (a.conflicts || []).includes(c.id)).sort((p, q) => q.production - p.production);
    const sp = c._span;
    box.innerHTML = `
      <div class="p-role" style="margin-top:56px">${esc(L((D.taxonomy.conflictTypes.find((x) => x.id === c.type) || {}).label))}</div>
      <div class="p-name">${esc(L(c.name))}</div>
      <div class="p-sub">${sp.point ? fmtDate(c.date) : fmtDate(c.start) + ' – ' + fmtDate(c.end)}</div>
      <h4>${t('event')}</h4><div class="p-desc">${esc(L(c.desc))}</div>
      ${list.length ? `<h4>${t('aircraft_in')} · ${list.length}</h4><div class="p-chips">${list.map((a) => `<button class="p-chip" data-go="${a.id}" style="--cc:${ROLE[a.role].color}">${esc(a.designation)} <small>${esc(L(a.nickname))}</small></button>`).join('')}</div>` : ''}`;
    box.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { selectAircraft(b.dataset.go); scrollToAircraft(b.dataset.go); }));
    return box;
  }
  function scrollToAircraft(id) {
    const g = geo[id]; if (!g) return;
    const sc = $('#scroller');
    sc.scrollTo({ left: Math.max(0, g.x0 - gutter() - 120), top: Math.max(0, g.top - 140), behavior: 'smooth' });
  }

  /* ---------------- ranking drawer ---------------- */
  function openRank() {
    const ol = $('#rankList'); ol.innerHTML = '';
    [...AC].sort((a, b) => b.production - a.production).forEach((a, i) => {
      const ic = icon(a), li = el('li');
      li.style.setProperty('--c', ROLE[a.role].color);
      li.innerHTML = `<span class="rk">${i + 1}</span><span class="th">${ic ? `<img src="${esc(ic.src)}" alt="">` : ''}</span><div class="rb"><div class="rn"><span>${esc(a.designation)} ${esc(L(a.nickname))}</span><b>${num(a.production)}</b></div><div class="rbar"><i data-w="${(a.production / PMAX * 100).toFixed(1)}"></i></div></div>`;
      li.onclick = () => { $('#rank').classList.remove('open'); selectAircraft(a.id); scrollToAircraft(a.id); };
      ol.appendChild(li);
    });
    $('#rank').classList.add('open');
    requestAnimationFrame(() => $$('#rankList .rbar i').forEach((i, k) => setTimeout(() => { i.style.width = i.dataset.w + '%'; }, k * 30)));
  }

  /* ---------------- interaction ---------------- */
  function zoomTo(ppy, clientX) {
    const sc = $('#scroller'), rect = sc.getBoundingClientRect();
    const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const year = VIEW.from + (sc.scrollLeft + px - gutter() - PADL) / st.ppy;
    st.ppy = Math.max(48, Math.min(420, ppy));
    render();
    sc.scrollLeft = X(year) - px;
  }
  function bind() {
    const sc = $('#scroller');
    $('#zoomIn').onclick = () => zoomTo(st.ppy * 1.3);
    $('#zoomOut').onclick = () => zoomTo(st.ppy / 1.3);
    $('#zoomFit').onclick = () => { fit(); sc.scrollLeft = 0; };
    $('#panelClose').onclick = () => { st.sel = null; st.selConflict = null; hideGuide(); applyDim(); closePanel(); };
    $('#rankBtn').onclick = openRank;
    $('#rankClose').onclick = () => $('#rank').classList.remove('open');
    $('#langBtn').onclick = () => { lang = lang === 'zh' ? 'en' : 'zh'; store.set('wtt-lang', lang); applyLang(true); buildChips(); render(); if (st.sel) openPanel(panelAircraft(BYID[st.sel])); else if (st.selConflict) openPanel(panelConflict(CF.find((c) => c.id === st.selConflict))); };
    let qt; $('#search').addEventListener('input', (e) => { st.query = e.target.value; applyDim(); clearTimeout(qt); qt = setTimeout(() => { const first = $('.ac.hit'); if (first) scrollToAircraft(first.dataset.id); }, 350); });
    sc.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomTo(st.ppy * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX); } }, { passive: false });
    // drag to pan
    let drag = null;
    sc.addEventListener('pointerdown', (e) => { if (e.button !== 0 || e.target.closest('.ac,.cf,.col')) return; drag = { x: e.clientX, y: e.clientY, l: sc.scrollLeft, t: sc.scrollTop, moved: false }; });
    window.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; sc.classList.add('dragging'); } sc.scrollLeft = drag.l - dx; sc.scrollTop = drag.t - dy; });
    window.addEventListener('pointerup', () => { if (drag && !drag.moved && (st.sel || st.selConflict)) { st.sel = null; st.selConflict = null; hideGuide(); applyDim(); closePanel(); } drag = null; sc.classList.remove('dragging'); });
    // year cursor
    const cur = $('#cursor'), lab = $('.cursor-label', cur);
    let lastTick = null;
    sc.addEventListener('mousemove', (e) => {
      const rect = sc.getBoundingClientRect();
      const x = e.clientX - rect.left + sc.scrollLeft;
      if (x < X(VIEW.from) || x > X(VIEW.to)) { cur.classList.remove('on'); return; }
      const y = VIEW.from + (x - gutter() - PADL) / st.ppy, yr = Math.floor(y), mo = Math.min(11, Math.floor((y - yr) * 12));
      const n = AC.filter((a) => st.roles.has(a.role) && a._span.start <= y && a._span.end > y).length;
      cur.style.left = x + 'px'; cur.classList.add('on');
      lab.textContent = `${lang === 'zh' ? `${yr}年${mo + 1}月` : `${MONTHS.en[mo]} ${yr}`} · ${n} ${t('types')}`;
      const tk = $(`.tick[data-y="${yr}"]`); if (tk !== lastTick) { lastTick && lastTick.classList.remove('hot'); tk && tk.classList.add('hot'); lastTick = tk; }
    });
    sc.addEventListener('mouseleave', () => cur.classList.remove('on'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { st.sel = null; st.selConflict = null; hideGuide(); applyDim(); closePanel(); $('#rank').classList.remove('open'); } });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { render(); }, 200); });
  }

  boot().catch((e) => { console.error(e); $('#boot .boot-lines').insertAdjacentHTML('beforeend', `<li style="color:#ff6b4a;opacity:1">ERROR: ${esc(e.message)}</li>`); });
})();
