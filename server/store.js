'use strict';
/**
 * JSON file store.
 *   data/taxonomy.json            roles, basing, branches, ...
 *   data/countries.json           enabled countries
 *   data/conflicts.json           wars, battles, milestones
 *   data/countries/<id>/aircraft.json
 *   data/countries/<id>/lineage.json
 * Adding a country = add an entry to countries.json + a folder.
 * Files are cached in memory and reloaded automatically when edited on disk.
 */
const fs = require('fs');
const path = require('path');
const { validateAircraft, validateConflict, validateLink } = require('./schema');

const DATA_DIR = process.env.WTT_DATA_DIR || path.join(__dirname, '..', 'data');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (fallback !== undefined && err.code === 'ENOENT') return fallback; throw new Error(`Failed to read ${file}: ${err.message}`); }
}
function writeJSONAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

class Store {
  constructor(dir = DATA_DIR) {
    this.dir = dir;
    this.load();
    this.watch();
  }
  p(...parts) { return path.join(this.dir, ...parts); }

  load() {
    const taxonomy = readJSON(this.p('taxonomy.json'));
    const countries = readJSON(this.p('countries.json'));
    const conflicts = readJSON(this.p('conflicts.json'), []);
    const aircraft = [], lineage = [];
    for (const c of countries) {
      readJSON(this.p('countries', c.id, 'aircraft.json'), []).forEach((a) => aircraft.push(Object.assign({ country: c.id }, a)));
      readJSON(this.p('countries', c.id, 'lineage.json'), []).forEach((l) => lineage.push(Object.assign({ country: c.id }, l)));
    }
    // 3D model specs: data/models/<aircraft-id>.json
    const models = {};
    const mdir = this.p('models');
    if (fs.existsSync(mdir)) for (const f of fs.readdirSync(mdir)) if (f.endsWith('.json')) { const m = readJSON(path.join(mdir, f)); models[m.id] = m; }
    this.state = { taxonomy, countries, conflicts, aircraft, lineage, models, loadedAt: new Date().toISOString() };
    this.version = Date.now().toString(36);
    return this.state;
  }

  watch() {
    if (process.env.WTT_NO_WATCH) return;
    let t = null;
    try {
      fs.watch(this.dir, { recursive: true }, () => {
        clearTimeout(t);
        t = setTimeout(() => { try { this.load(); console.log('[store] data reloaded'); } catch (e) { console.error('[store]', e.message); } }, 150);
      });
    } catch { /* recursive watch unsupported on this platform — manual reload via API */ }
  }

  /** Full integrity check across all files. */
  validate() {
    const { taxonomy, aircraft, conflicts, lineage } = this.state;
    const errors = [];
    const ids = new Set();
    for (const a of aircraft) {
      if (ids.has(a.id)) errors.push(`aircraft ${a.id}: duplicate id`);
      ids.add(a.id);
      validateAircraft(a, taxonomy).forEach((m) => errors.push(`aircraft ${a.id}: ${m}`));
    }
    const cids = new Set(conflicts.map((c) => c.id));
    for (const c of conflicts) validateConflict(c, taxonomy).forEach((m) => errors.push(`conflict ${c.id}: ${m}`));
    for (const a of aircraft) (a.conflicts || []).forEach((cid) => { if (!cids.has(cid)) errors.push(`aircraft ${a.id}: unknown conflict ${cid}`); });
    for (const l of lineage) validateLink(l, ids, taxonomy).forEach((m) => errors.push(m));
    for (const [id, m] of Object.entries(this.state.models)) {
      if (!ids.has(id)) errors.push(`model ${id}: no aircraft with this id`);
      if (!m.fuselage || !Array.isArray(m.fuselage.stations) || m.fuselage.stations.length < 3) errors.push(`model ${id}: fuselage.stations missing`);
      if (!Array.isArray(m.liveries) || !m.liveries.length) errors.push(`model ${id}: at least one livery required`);
    }
    return errors;
  }

  /* ---------- mutations (persisted to disk) ---------- */
  _aircraftFile(country) { return this.p('countries', country, 'aircraft.json'); }

  upsertAircraft(input, { partial = false } = {}) {
    const { taxonomy, countries } = this.state;
    const existing = this.state.aircraft.find((a) => a.id === input.id);
    const merged = partial && existing ? Object.assign({}, existing, input) : input;
    const errs = validateAircraft(merged, taxonomy);
    if (!countries.some((c) => c.id === merged.country)) errs.push(`unknown country ${merged.country}`);
    if (errs.length) { const err = new Error('Validation failed'); err.status = 400; err.details = errs; throw err; }
    const file = this._aircraftFile(merged.country);
    const list = readJSON(file, []);
    const i = list.findIndex((a) => a.id === merged.id);
    if (i >= 0) list[i] = merged; else list.push(merged);
    writeJSONAtomic(file, list);
    this.load();
    return merged;
  }

  deleteAircraft(id) {
    const a = this.state.aircraft.find((x) => x.id === id);
    if (!a) return false;
    const file = this._aircraftFile(a.country);
    writeJSONAtomic(file, readJSON(file, []).filter((x) => x.id !== id));
    const lf = this.p('countries', a.country, 'lineage.json');
    writeJSONAtomic(lf, readJSON(lf, []).filter((l) => l.from !== id && l.to !== id));
    this.load();
    return true;
  }

  upsertConflict(input) {
    const errs = validateConflict(input, this.state.taxonomy);
    if (errs.length) { const err = new Error('Validation failed'); err.status = 400; err.details = errs; throw err; }
    const list = readJSON(this.p('conflicts.json'), []);
    const i = list.findIndex((c) => c.id === input.id);
    if (i >= 0) list[i] = input; else list.push(input);
    writeJSONAtomic(this.p('conflicts.json'), list);
    this.load();
    return input;
  }

  deleteConflict(id) {
    const list = readJSON(this.p('conflicts.json'), []);
    if (!list.some((c) => c.id === id)) return false;
    writeJSONAtomic(this.p('conflicts.json'), list.filter((c) => c.id !== id));
    this.load();
    return true;
  }
}

module.exports = { Store, DATA_DIR, readJSON, writeJSONAtomic };
