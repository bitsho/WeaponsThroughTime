#!/usr/bin/env node
'use strict';
/* Bundle the timeline into ONE self-contained HTML file (dist/timeline-preview.html):
   inline CSS + JS + data, images embedded as data: URIs, fonts from Google Fonts. */
process.env.WTT_NO_WATCH = '1';
const fs = require('fs');
const path = require('path');
const { Store } = require('../server/store');
const { inWindow, conflictSpan } = require('../public/js/shared.js');
const ROOT = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const store = new Store();
const { taxonomy, countries, aircraft, lineage, conflicts } = store.state;
const from = 1935, to = 1950;
const dataURI = (rel) => {
  if (!rel) return rel;
  const f = path.join(ROOT, 'public', rel);
  if (!fs.existsSync(f)) return null;
  const ext = path.extname(f).slice(1).replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${fs.readFileSync(f).toString('base64')}`;
};
const ac = aircraft.filter((a) => a.country === 'usa' && a.basing === 'carrier' && inWindow(a, from, to)).map((a) => {
  if (!a.media) return a;
  const m = Object.assign({}, a.media);
  m.cutout = dataURI(m.cutout); m.photo = dataURI(m.photo); delete m.thumb;
  return Object.assign({}, a, { media: m });
});
const ids = new Set(ac.map((a) => a.id));
const bundle = { version: store.version, window: { from, to }, taxonomy, countries, aircraft: ac,
  lineage: lineage.filter((l) => ids.has(l.from) && ids.has(l.to)),
  conflicts: conflicts.filter((k) => (k.countries || []).includes('usa') && conflictSpan(k).start < to + 1 && conflictSpan(k).end >= from) };
const html = R('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src="js/shared.js">'));
const out = `<title>Carrier Aircraft Timeline</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;500;600;700&family=Saira+Stencil+One&family=Share+Tech+Mono&family=ZCOOL+QingKe+HuangYou&display=swap">
<style>${R('public/css/timeline.css')}</style>
${body}
<script>window.__WTT_BUNDLE__ = ${JSON.stringify(bundle)};</script>
<script>${R('public/js/shared.js')}</script>
<script>${R('public/js/i18n.js')}</script>
<script>${R('public/js/api.js')}</script>
<script>${R('public/js/timeline.js')}</script>
`;
const dest = path.join(ROOT, 'dist', 'timeline-preview.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('wrote', path.relative(process.cwd(), dest), (out.length / 1024 / 1024).toFixed(2) + ' MB');
