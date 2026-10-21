#!/usr/bin/env node
'use strict';
/**
 * Export the API bundle to public/data/bundle-<country>.json so the front end
 * also works without the Node server (GitHub Pages, file://, any static host).
 * The app tries /api/v1/bundle first and falls back to this file.
 */
process.env.WTT_NO_WATCH = '1';
const path = require('path');
const { Store, writeJSONAtomic } = require('../server/store');
const { inWindow, conflictSpan } = require('../public/js/shared.js');

const store = new Store();
const { taxonomy, countries, aircraft, lineage, conflicts } = store.state;
for (const c of countries.filter((x) => x.enabled)) {
  const { from, to } = c.range;
  const ac = aircraft.filter((a) => a.country === c.id && inWindow(a, from, to));
  const ids = new Set(ac.map((a) => a.id));
  const bundle = {
    version: store.version, window: { from, to }, taxonomy, countries, aircraft: ac,
    lineage: lineage.filter((l) => ids.has(l.from) && ids.has(l.to)),
    conflicts: conflicts.filter((k) => (k.countries || []).includes(c.id) && conflictSpan(k).start < to + 1 && conflictSpan(k).end >= from)
  };
  const out = path.join(__dirname, '..', 'public', 'data', `bundle-${c.id}.json`);
  writeJSONAtomic(out, bundle);
  console.log(`wrote ${path.relative(process.cwd(), out)}  (${ac.length} aircraft)`);
}
// hangar bundle (aircraft that have 3D models)
const models = store.state.models;
const items = Object.keys(models).map((id) => ({ aircraft: aircraft.find((a) => a.id === id), model: models[id] })).filter((x) => x.aircraft);
const hangarOut = path.join(__dirname, '..', 'public', 'data', 'hangar.json');
writeJSONAtomic(hangarOut, { version: store.version, taxonomy, maxProduction: Math.max(...aircraft.map((a) => a.production)), items });
console.log(`wrote ${path.relative(process.cwd(), hangarOut)}  (${items.length} 3D models)`);
