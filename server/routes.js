'use strict';
/**
 * REST API  —  /api/v1
 *
 *  GET    /health
 *  GET    /meta                         taxonomy + countries + data version
 *  GET    /bundle?country=usa&from&to   everything the timeline needs in one call
 *  GET    /aircraft                     filters: country, role, basing, branch, propulsion, from, to, q
 *  GET    /aircraft/:id                 one aircraft + lineage neighbours + conflicts
 *  GET    /conflicts                    filters: country, type, from, to
 *  GET    /lineage?country=usa
 *  GET    /stats/in-service?country&from&to&by=role
 *  GET    /stats/production?country&from&to   ranking by units built
 *  GET    /models                       ids of aircraft that have a 3D model (+ summary)
 *  GET    /models/:id                   procedural 3D model spec (geometry + liveries)
 *  GET    /hangar?ids=a,b               aircraft records + 3D specs in one call
 *
 *  Admin (header  Authorization: Bearer $WTT_ADMIN_TOKEN):
 *  POST   /aircraft          create / replace
 *  PATCH  /aircraft/:id      partial update
 *  DELETE /aircraft/:id
 *  POST   /conflicts         create / replace
 *  DELETE /conflicts/:id
 *  POST   /reload            reload JSON from disk
 *  GET    /validate          integrity report
 */
const express = require('express');
const { serviceSpan, conflictSpan, inWindow, inServiceByYear } = require('../public/js/shared.js');

module.exports = function api(store) {
  const r = express.Router();
  const S = () => store.state;

  const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
  const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);
  const windowOf = (q) => {
    const c = S().countries.find((x) => x.id === (q.country || 'usa'));
    const def = (c && c.range) || { from: 1935, to: 1950 };
    return { from: num(q.from, def.from), to: num(q.to, def.to) };
  };

  function filterAircraft(q) {
    const { from, to } = windowOf(q);
    const countries = list(q.country), roles = list(q.role), basing = list(q.basing), branches = list(q.branch), prop = list(q.propulsion);
    const text = q.q ? String(q.q).toLowerCase() : null;
    return S().aircraft.filter((a) =>
      (!countries || countries.includes(a.country)) &&
      (!roles || roles.includes(a.role)) &&
      (!basing || basing.includes(a.basing)) &&
      (!prop || prop.includes(a.propulsion)) &&
      (!branches || (a.branches || []).some((b) => branches.includes(b))) &&
      inWindow(a, from, to) &&
      (!text || [a.id, a.designation, a.name.en, a.name.zh, a.nickname && a.nickname.en, a.nickname && a.nickname.zh, a.manufacturer && a.manufacturer.en]
        .filter(Boolean).some((s) => s.toLowerCase().includes(text))));
  }
  function filterConflicts(q) {
    const { from, to } = windowOf(q);
    const countries = list(q.country), types = list(q.type);
    return S().conflicts.filter((c) => {
      const s = conflictSpan(c);
      return (!countries || (c.countries || []).some((x) => countries.includes(x))) &&
        (!types || types.includes(c.type)) && s.start < to + 1 && s.end >= from;
    });
  }

  const cache = (res) => res.set('Cache-Control', 'public, max-age=60').set('ETag', `W/"${store.version}"`);

  r.get('/health', (req, res) => res.json({ ok: true, version: store.version, loadedAt: S().loadedAt }));

  r.get('/meta', (req, res) => { cache(res); res.json({ version: store.version, taxonomy: S().taxonomy, countries: S().countries }); });

  r.get('/bundle', (req, res) => {
    cache(res);
    const aircraft = filterAircraft(req.query);
    const ids = new Set(aircraft.map((a) => a.id));
    res.json({
      version: store.version,
      window: windowOf(req.query),
      taxonomy: S().taxonomy,
      countries: S().countries,
      aircraft,
      lineage: S().lineage.filter((l) => ids.has(l.from) && ids.has(l.to)),
      conflicts: filterConflicts(req.query)
    });
  });

  r.get('/aircraft', (req, res) => { cache(res); const items = filterAircraft(req.query); res.json({ count: items.length, items }); });

  r.get('/aircraft/:id', (req, res) => {
    const a = S().aircraft.find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: 'not_found' });
    cache(res);
    const byId = (id) => S().aircraft.find((x) => x.id === id);
    const brief = (x) => x && { id: x.id, designation: x.designation, name: x.name, role: x.role };
    res.json({
      aircraft: a,
      span: serviceSpan(a),
      predecessors: S().lineage.filter((l) => l.to === a.id).map((l) => ({ type: l.type, note: l.note, aircraft: brief(byId(l.from)) })),
      successors: S().lineage.filter((l) => l.from === a.id).map((l) => ({ type: l.type, note: l.note, aircraft: brief(byId(l.to)) })),
      conflicts: S().conflicts.filter((c) => (a.conflicts || []).includes(c.id)),
      productionRank: [...S().aircraft].filter((x) => x.country === a.country).sort((x, y) => y.production - x.production).findIndex((x) => x.id === a.id) + 1
    });
  });

  r.get('/conflicts', (req, res) => { cache(res); const items = filterConflicts(req.query); res.json({ count: items.length, items }); });
  r.get('/lineage', (req, res) => { cache(res); const c = list(req.query.country); res.json(S().lineage.filter((l) => !c || c.includes(l.country))); });

  r.get('/stats/in-service', (req, res) => {
    const { from, to } = windowOf(req.query);
    const by = req.query.by || 'role';
    res.json({ from, to, by, rows: inServiceByYear(filterAircraft(req.query), from, to, (a) => a[by] || 'other') });
  });

  r.get('/stats/production', (req, res) => {
    const items = filterAircraft(req.query).sort((a, b) => b.production - a.production)
      .map((a, i) => ({ rank: i + 1, id: a.id, designation: a.designation, name: a.name, role: a.role, production: a.production }));
    res.json({ total: items.reduce((s, a) => s + a.production, 0), items });
  });

  r.get('/models', (req, res) => {
    cache(res);
    res.json(Object.values(S().models).map((m) => ({ id: m.id, variant: m.variant, liveries: m.liveries.map((l) => ({ id: l.id, name: l.name, year: l.year })) })));
  });
  r.get('/models/:id', (req, res) => {
    const m = S().models[req.params.id];
    if (!m) return res.status(404).json({ error: 'not_found' });
    cache(res); res.json(m);
  });
  r.get('/hangar', (req, res) => {
    cache(res);
    const ids = list(req.query.ids) || Object.keys(S().models);
    const items = ids.map((id) => ({ aircraft: S().aircraft.find((a) => a.id === id), model: S().models[id] })).filter((x) => x.aircraft && x.model);
    const maxProduction = Math.max(...S().aircraft.map((a) => a.production));
    res.json({ version: store.version, taxonomy: S().taxonomy, maxProduction, items });
  });

  /* ---------- admin ---------- */
  function admin(req, res, next) {
    const token = process.env.WTT_ADMIN_TOKEN;
    if (!token) return res.status(403).json({ error: 'admin_disabled', hint: 'set WTT_ADMIN_TOKEN to enable write endpoints' });
    if ((req.get('authorization') || '') !== `Bearer ${token}`) return res.status(401).json({ error: 'unauthorized' });
    next();
  }
  const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message, details: e.details }); } };

  r.post('/aircraft', admin, wrap((req, res) => res.status(201).json(store.upsertAircraft(req.body))));
  r.patch('/aircraft/:id', admin, wrap((req, res) => {
    if (!S().aircraft.some((a) => a.id === req.params.id)) return res.status(404).json({ error: 'not_found' });
    res.json(store.upsertAircraft(Object.assign({}, req.body, { id: req.params.id }), { partial: true }));
  }));
  r.delete('/aircraft/:id', admin, wrap((req, res) => (store.deleteAircraft(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'not_found' }))));
  r.post('/conflicts', admin, wrap((req, res) => res.status(201).json(store.upsertConflict(req.body))));
  r.delete('/conflicts/:id', admin, wrap((req, res) => (store.deleteConflict(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'not_found' }))));
  r.post('/reload', admin, wrap((req, res) => { store.load(); res.json({ ok: true, version: store.version }); }));
  r.get('/validate', admin, (req, res) => { const errors = store.validate(); res.status(errors.length ? 422 : 200).json({ ok: !errors.length, errors }); });

  return r;
};
