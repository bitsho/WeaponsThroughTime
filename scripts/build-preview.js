#!/usr/bin/env node
'use strict';
/* Bundle the hangar into ONE self-contained HTML file (dist/hangar-preview.html):
   inline CSS + JS + data, three.js from jsDelivr, fonts from Google Fonts. */
process.env.WTT_NO_WATCH = '1';
const fs = require('fs');
const path = require('path');
const { Store } = require('../server/store');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const store = new Store();
const { aircraft, models, taxonomy } = store.state;
const hangar = { version: store.version, taxonomy, maxProduction: Math.max(...aircraft.map((a) => a.production)),
  items: Object.keys(models).map((id) => ({ aircraft: aircraft.find((a) => a.id === id), model: models[id] })).filter((x) => x.aircraft) };
const html = R('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
const engine = R('public/js/air3d/engine.js');
const app = R('public/js/hangar.js').replace(/^import .*engine\.js';\s*$/m, '');
const THREE_V = '0.170.0';
const out = `<title>WTT Carrier Hangar</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;500;600;700&family=Saira+Stencil+One&family=Share+Tech+Mono&family=ZCOOL+QingKe+HuangYou&display=swap">
<style>${R('public/css/hangar.css')}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@${THREE_V}/build/three.module.min.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@${THREE_V}/examples/jsm/"}}</script>
${body}
<script>window.__WTT_HANGAR__ = ${JSON.stringify(hangar)};</script>
<script type="module">
${engine}
${app}
</script>
`;
const dest = path.join(__dirname, '..', 'dist', 'hangar-preview.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('wrote', path.relative(process.cwd(), dest), (out.length / 1024).toFixed(0) + ' KB');
