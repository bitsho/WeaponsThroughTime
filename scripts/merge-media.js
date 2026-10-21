#!/usr/bin/env node
'use strict';
/* Merge a media manifest ({ id: { photo, cutout, credit, ... } }) into data/countries/<c>/aircraft.json */
const fs = require('fs');
const path = require('path');
const [manifest, country = 'usa'] = process.argv.slice(2);
if (!manifest) { console.error('usage: merge-media.js <media.json> [country]'); process.exit(1); }
const media = JSON.parse(fs.readFileSync(manifest, 'utf8'));
const file = path.join(__dirname, '..', 'data', 'countries', country, 'aircraft.json');
const list = JSON.parse(fs.readFileSync(file, 'utf8'));
let n = 0;
for (const a of list) if (media[a.id]) { a.media = media[a.id]; n++; }
fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
console.log(`merged media for ${n}/${list.length} aircraft`);
