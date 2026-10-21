/* Weapons Through Time — 3D hangar (demo for the timeline's aircraft dossiers) */
import { renderThumbnail, InspectionViewer } from './air3d/engine.js';

const T = {
  en: {
    title: 'WEAPONS THROUGH TIME', subtitle: 'US Navy carrier aviation', kicker: '3D Hangar · preview',
    headline: 'Three airframes, built from their drawings',
    lede: 'Every aircraft here is generated in the browser from its real dimensions — lofted fuselage stations, NACA wing sections, gull bends, canopy frames, propellers — then painted in documented historical schemes. Drag to orbit, switch liveries, spin up the engine.',
    status: (n) => `${n} AIRFRAMES ONLINE`, foot1: 'Original procedural models — no third-party game assets',
    foot2: 'Geometry from published manufacturer dimensions and three-view drawings',
    inspect: 'Inspect', service: 'Service', built: 'Built', ff: 'First flight', speed: 'Max speed', range: 'Range', ceiling: 'Ceiling',
    length: 'Length', span: 'Span', crew: 'Crew', engine: 'Powerplant', armament: 'Armament', livery: 'Livery',
    v_side: 'SIDE', v_top: 'TOP', v_front: 'FRONT', v_rear: 'REAR', t_spin: 'ENGINE', t_rotate: 'ORBIT', t_blue: 'BLUEPRINT',
    hint: 'DRAG · ROTATE   WHEEL · ZOOM   1–5 · VIEWS   ESC · CLOSE', specs: 'Specifications', history: 'History', model: 'Model',
    rendering: 'RENDERING', now: 'now', wiki: 'Wikipedia →', src_api: 'Data: live API', src_static: 'Data: static export', src_inline: 'Data: inline',
    rank: (r, n) => `#${r} of ${n} by units built`
  },
  zh: {
    title: '兵器演进', subtitle: '美国海军舰载航空兵', kicker: '3D 机库 · 预览',
    headline: '三架战机，按图纸逐站重建',
    lede: '这里的每一架飞机都是浏览器根据真实尺寸实时生成的——机身逐站放样、NACA 翼型、倒海鸥翼折角、座舱框架、螺旋桨——再按有据可查的历史涂装上色。拖动旋转、切换涂装、启动发动机。',
    status: (n) => `${n} 架机体已上线`, foot1: '原创程序化模型——未使用任何第三方游戏素材',
    foot2: '几何依据原厂公开尺寸与三视图',
    inspect: '检视', service: '服役', built: '产量', ff: '首飞', speed: '最大速度', range: '航程', ceiling: '升限',
    length: '机长', span: '翼展', crew: '乘员', engine: '动力', armament: '武器', livery: '涂装',
    v_side: '侧视', v_top: '俯视', v_front: '正视', v_rear: '后视', t_spin: '发动机', t_rotate: '环绕', t_blue: '蓝图',
    hint: '拖拽 · 旋转   滚轮 · 缩放   1–5 · 视角   ESC · 关闭', specs: '技术参数', history: '服役史', model: '模型',
    rendering: '渲染中', now: '至今', wiki: '维基百科 →', src_api: '数据：实时 API', src_static: '数据：静态导出', src_inline: '数据：内嵌',
    rank: (r, n) => `产量第 ${r} / ${n}`
  }
};
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
let lang = store.get('wtt-lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en');
const t = (k, ...a) => { const v = T[lang][k]; return typeof v === 'function' ? v(...a) : v; };
const L = (o) => (o ? o[lang] || o.en : '');
const $ = (s, r = document) => r.querySelector(s);
const num = (n) => n == null ? '—' : n.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
const yr = (d) => (d ? String(d).slice(0, 4) : '');

let DATA, SOURCE;
const thumbCache = new Map();
const state = { livery: {}, viewer: null, current: null };

async function loadData() {
  if (window.__WTT_HANGAR__) { SOURCE = 'inline'; return window.__WTT_HANGAR__; }
  try { const r = await fetch('api/v1/hangar'); if (!r.ok) throw 0; SOURCE = 'api'; return await r.json(); }
  catch { const r = await fetch('data/hangar.json'); SOURCE = 'static'; return r.json(); }
}
const roleOf = (id) => DATA.taxonomy.roles.find((r) => r.id === id) || { color: '#38e1ff', label: { en: id, zh: id } };

/* ---------------- i18n ---------------- */
function applyLang() {
  document.documentElement.dataset.lang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $('#status').textContent = t('status', DATA ? DATA.items.length : 0);
  $('#srcNote').textContent = SOURCE ? t('src_' + SOURCE) : '';
  if (DATA) { renderCards(true); if (state.current) renderPanel(); }
}
$('#langBtn').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; store.set('wtt-lang', lang); applyLang(); });

/* ---------------- cards ---------------- */
function swatch(lv) { const s = lv.scheme; return s.type === 'solid' ? s.color : s.type === 'two' ? `linear-gradient(${s.top} 50%, ${s.low} 50%)` : `linear-gradient(${s.top} 33%, ${s.mid} 33% 66%, ${s.low} 66%)`; }
function renderCards(keepImages) {
  const host = $('#cards');
  const imgs = {};
  if (keepImages) host.querySelectorAll('.card').forEach((c) => { imgs[c.dataset.id] = c.querySelector('.shot img'); });
  host.innerHTML = '';
  const n = DATA.items.length;
  const ranks = [...DATA.items].sort((a, b) => b.aircraft.production - a.aircraft.production).map((x) => x.aircraft.id);
  DATA.items.forEach(({ aircraft: a, model: m }, i) => {
    const role = roleOf(a.role);
    const lv = state.livery[a.id] || m.liveries[0].id;
    state.livery[a.id] = lv;
    const card = document.createElement('article');
    card.className = 'card'; card.dataset.id = a.id;
    card.style.setProperty('--rc', role.color); card.style.setProperty('--i', keepImages ? 0 : i);
    if (keepImages) card.style.animation = 'none', card.style.opacity = 1, card.style.transform = 'none';
    const s = a.service || {};
    card.innerHTML = `
      <div class="card-head">
        <div><div class="role">${L(role.label)}</div><div class="desig">${m.variant}</div><div class="aname"><b>${L(a.name)}</b></div></div>
        <div class="svc">${t('service')}<b>${yr(s.start)}–${s.end && +yr(s.end) <= 2026 ? yr(s.end) : t('now')}</b></div>
      </div>
      <div class="shot" role="button" tabindex="0" aria-label="${t('inspect')} ${m.variant}">
        <div class="loading">${t('rendering')}</div><div class="scanbar"></div>
        <i class="brk tl"></i><i class="brk tr"></i><i class="brk bl"></i><i class="brk br"></i>
        <span class="tag">${L(m.liveries.find((x) => x.id === lv).name)}</span>
      </div>
      <div class="liveries">${m.liveries.map((x) => `<button class="liv${x.id === lv ? ' on' : ''}" data-l="${x.id}" title="${L(x.note)}"><i style="background:${swatch(x)}"></i>${L(x.name)}</button>`).join('')}</div>
      <div class="stats">
        <div class="stat"><label>${t('built')}</label><b>${num(a.production)}</b><div class="pbar"><i data-w="${Math.max(3, Math.sqrt(a.production / DATA.maxProduction) * 100)}"></i></div></div>
        <div class="stat"><label>${t('ff')}</label><b>${yr(a.firstFlight)}</b></div>
        <div class="stat"><label>${t('speed')}</label><b>${num(a.specs.maxSpeed)}<small>km/h</small></b></div>
        <div class="stat"><label>${t('span')}</label><b>${m.span.toFixed(2)}<small>m</small></b></div>
      </div>
      <div class="card-foot"><span class="nick">${t('rank', ranks.indexOf(a.id) + 1, n)}</span>
        <button class="inspect">${t('inspect')}<svg viewBox="0 0 16 16"><path d="M2 8h11M9 4l4 4-4 4"/></svg></button></div>`;
    host.appendChild(card);
    const shot = card.querySelector('.shot');
    if (imgs[a.id]) { const img = imgs[a.id]; img.classList.remove('in'); shot.appendChild(img); shot.querySelector('.loading').remove(); }
    shot.addEventListener('click', () => openBay(a.id));
    shot.addEventListener('keydown', (e) => { if (e.key === 'Enter') openBay(a.id); });
    card.querySelector('.inspect').addEventListener('click', () => openBay(a.id));
    card.querySelectorAll('.liv').forEach((b) => b.addEventListener('click', () => setCardLivery(a.id, b.dataset.l)));
    requestAnimationFrame(() => card.querySelectorAll('.pbar i').forEach((el) => { el.style.width = el.dataset.w + '%'; }));
  });
}
async function thumb(id, lv) {
  const key = id + ':' + lv;
  if (!thumbCache.has(key)) {
    const m = DATA.items.find((x) => x.aircraft.id === id).model;
    thumbCache.set(key, renderThumbnail(m, lv, { width: 1280, height: 720 }));
  }
  return thumbCache.get(key);
}
async function showThumb(id) {
  const card = document.querySelector(`.card[data-id="${id}"]`); if (!card) return;
  const shot = card.querySelector('.shot');
  const url = await thumb(id, state.livery[id]);
  const old = shot.querySelector('img');
  const img = new Image(); img.alt = id; img.src = url; img.className = 'in';
  await img.decode().catch(() => {});
  shot.appendChild(img);
  shot.querySelector('.loading')?.remove();
  if (old) { old.style.opacity = 0; setTimeout(() => old.remove(), 450); }
}
async function setCardLivery(id, lv) {
  state.livery[id] = lv;
  const card = document.querySelector(`.card[data-id="${id}"]`);
  card.querySelectorAll('.liv').forEach((b) => b.classList.toggle('on', b.dataset.l === lv));
  const m = DATA.items.find((x) => x.aircraft.id === id).model;
  card.querySelector('.tag').textContent = L(m.liveries.find((x) => x.id === lv).name);
  await showThumb(id);
  if (state.current === id && state.viewer) { state.viewer.load(m, lv); renderPanel(); renderBayLiveries(); }
}

/* ---------------- inspection bay ---------------- */
const bay = $('#bay');
function item(id) { return DATA.items.find((x) => x.aircraft.id === id); }
async function openBay(id) {
  state.current = id;
  const { aircraft: a, model: m } = item(id);
  bay.style.setProperty('--rc', roleOf(a.role).color);
  bay.hidden = false; bay.classList.remove('open'); void bay.offsetWidth; bay.classList.add('open');
  document.body.style.overflow = 'hidden';
  $('#hudTitle').innerHTML = `<div class="k">${L(roleOf(a.role).label)} · ${a.branches.join(' / ')}</div><div class="d">${m.variant}</div><div class="n">${L(a.name)}</div>`;
  renderPanel(); renderBayLiveries();
  $('#bayLoading').classList.add('on');
  if (!state.viewer) {
    state.viewer = new InspectionViewer($('#bayStage'), {
      onFrame: ({ az, el, dist }) => { $('#hudRead').innerHTML = `AZ <b>${String(Math.round(az)).padStart(3, '0')}°</b><br>EL <b>${el.toFixed(0).padStart(2, '0')}°</b><br>RNG <b>${dist.toFixed(1)} m</b>`; }
    });
    $('#bayStage').prepend(state.viewer.canvas);
  }
  await new Promise((r) => requestAnimationFrame(r));
  state.viewer.resize();
  state.viewer.spec = null;
  await state.viewer.load(m, state.livery[id]);
  $('#bayLoading').classList.remove('on');
  setSeg('wt');
}
function closeBay() { bay.hidden = true; document.body.style.overflow = ''; state.current = null; }
$('#bayClose').addEventListener('click', closeBay);
function renderBayLiveries() {
  const { model: m } = item(state.current);
  $('#bayLiv').innerHTML = m.liveries.map((x) => `<button class="liv${x.id === state.livery[state.current] ? ' on' : ''}" data-l="${x.id}"><i style="background:${swatch(x)}"></i>${L(x.name)}</button>`).join('');
  $('#bayLiv').querySelectorAll('.liv').forEach((b) => b.addEventListener('click', () => setCardLivery(state.current, b.dataset.l)));
}
function renderPanel() {
  const { aircraft: a, model: m } = item(state.current);
  const lv = m.liveries.find((x) => x.id === state.livery[a.id]);
  const s = a.service || {}, sp = a.specs || {};
  const role = roleOf(a.role);
  $('#bayPanel').style.setProperty('--rc', role.color);
  $('#bayPanel').innerHTML = `
    <div class="p-role">${L(role.label)}</div>
    <div class="p-name">${L(a.name)}</div>
    <div class="p-nick">${m.variant}${a.nickname && L(a.nickname) ? ' · “' + L(a.nickname) + '”' : ''} · ${L(a.manufacturer)}</div>
    <div class="p-note"><b>${t('livery')} · ${L(lv.name)}</b>${L(lv.note)}</div>
    <h3>${t('specs')}</h3>
    <div class="p-grid">
      <div><label>${t('service')}</label><b>${yr(s.start)}–${+yr(s.end) <= 2026 ? yr(s.end) : t('now')}</b></div>
      <div><label>${t('built')}</label><b>${num(a.production)}</b></div>
      <div><label>${t('ff')}</label><b>${a.firstFlight || '—'}</b></div>
      <div><label>${t('speed')}</label><b>${num(sp.maxSpeed)} km/h</b></div>
      <div><label>${t('range')}</label><b>${num(sp.range)} km</b></div>
      <div><label>${t('ceiling')}</label><b>${num(sp.ceiling)} m</b></div>
      <div><label>${t('length')}</label><b>${m.length.toFixed(2)} m</b></div>
      <div><label>${t('span')}</label><b>${m.span.toFixed(2)} m</b></div>
    </div>
    <div class="p-row"><label>${t('engine')}</label><span>${L(sp.engine)}</span></div>
    <div class="p-row"><label>${t('armament')}</label><span>${L(sp.armament)}</span></div>
    <div class="p-row"><label>${t('crew')}</label><span>${sp.crew ?? '—'}</span></div>
    <h3>${t('history')}</h3>
    <div class="p-desc">${L(a.desc)}</div>
    <h3>${t('model')}</h3>
    <div class="p-ref">${L(m.refs)}</div>
    ${a.wiki ? `<a class="p-link" href="${a.wiki[lang] || a.wiki.en}" target="_blank" rel="noopener">${t('wiki')}</a>` : ''}`;
}
function setSeg(v) { document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v)); }
document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => { state.viewer?.setView(b.dataset.view); setSeg(b.dataset.view); }));
const tog = (id, fn) => { const b = $(id); b.addEventListener('click', () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); fn(on); }); };
tog('#tSpin', (on) => state.viewer?.setSpin(on));
tog('#tRotate', (on) => state.viewer?.setAutoRotate(on));
tog('#tBlue', (on) => state.viewer?.setBlueprint(on));
document.addEventListener('keydown', (e) => {
  if (bay.hidden) return;
  if (e.key === 'Escape') closeBay();
  const v = { 1: 'wt', 2: 'side', 3: 'top', 4: 'front', 5: 'rear' }[e.key];
  if (v) { state.viewer?.setView(v); setSeg(v); }
});

/* ---------------- boot ---------------- */
(async function boot() {
  DATA = await loadData();
  applyLang();
  renderCards(false);
  for (const { aircraft: a } of DATA.items) await showThumb(a.id);   // sequential: one GPU context
  window.__WTT_READY__ = true;
})();
