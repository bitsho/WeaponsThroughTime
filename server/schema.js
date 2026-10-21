'use strict';
/**
 * Lightweight validators (no dependencies). Each returns an array of
 * human-readable error strings; empty array = valid.
 */
const { toYear } = require('../public/js/shared.js');

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isI18n = (v) => v && typeof v === 'object' && isStr(v.en) && isStr(v.zh);
const isDate = (v) => v == null || toYear(v) != null;

function validateAircraft(a, taxonomy, { partial = false } = {}) {
  const e = [];
  const need = (cond, msg) => { if (!cond) e.push(msg); };
  if (!partial || 'id' in a) need(isStr(a.id) && /^[a-z0-9-]+$/.test(a.id), 'id: lowercase letters, digits and dashes only');
  if (!partial || 'country' in a) need(isStr(a.country), 'country is required');
  if (!partial || 'designation' in a) need(isStr(a.designation), 'designation is required');
  if (!partial || 'name' in a) need(isI18n(a.name), 'name must be { en, zh }');
  if (!partial || 'role' in a) need(taxonomy.roles.some((r) => r.id === a.role), `role must be one of ${taxonomy.roles.map((r) => r.id).join(', ')}`);
  if (!partial || 'basing' in a) need(taxonomy.basing.some((b) => b.id === a.basing), 'basing is invalid');
  if (!partial || 'propulsion' in a) need(taxonomy.propulsion.some((p) => p.id === a.propulsion), 'propulsion is invalid');
  if (!partial || 'production' in a) need(Number.isInteger(a.production) && a.production > 0, 'production must be a positive integer');
  if (!partial || 'service' in a) {
    const s = a.service || {};
    need(toYear(s.start) != null, 'service.start is required (YYYY, YYYY-MM or YYYY-MM-DD)');
    need(isDate(s.end) && isDate(s.frontlineEnd), 'service.end / service.frontlineEnd must be dates');
    if (toYear(s.start) != null && toYear(s.end) != null) need(toYear(s.end) >= toYear(s.start), 'service.end is before service.start');
  }
  if (a.branches != null) need(Array.isArray(a.branches) && a.branches.every((b) => taxonomy.branches.some((t) => t.id === b)), 'branches contains an unknown branch');
  if (a.desc != null) need(isI18n(a.desc), 'desc must be { en, zh }');
  if (a.specs != null) need(typeof a.specs === 'object', 'specs must be an object');
  if (a.shape != null) need(typeof a.shape === 'object', 'shape must be an object');
  if (a.image != null) need(isStr(a.image), 'image must be a URL/path string');
  return e;
}

function validateConflict(c, taxonomy, { partial = false } = {}) {
  const e = [];
  const need = (cond, msg) => { if (!cond) e.push(msg); };
  if (!partial || 'id' in c) need(isStr(c.id) && /^[a-z0-9-]+$/.test(c.id), 'id: lowercase letters, digits and dashes only');
  if (!partial || 'type' in c) need(taxonomy.conflictTypes.some((t) => t.id === c.type), 'type is invalid');
  if (!partial || 'name' in c) need(isI18n(c.name), 'name must be { en, zh }');
  if (!partial || ('date' in c || 'start' in c)) need(toYear(c.date) != null || toYear(c.start) != null, 'date or start is required');
  if (c.magnitude != null) need(Number.isFinite(c.magnitude) && c.magnitude >= 1 && c.magnitude <= 5, 'magnitude must be 1–5');
  return e;
}

function validateLink(l, ids, taxonomy) {
  const e = [];
  if (!ids.has(l.from)) e.push(`lineage: unknown "from" ${l.from}`);
  if (!ids.has(l.to)) e.push(`lineage: unknown "to" ${l.to}`);
  if (!taxonomy.linkTypes.some((t) => t.id === l.type)) e.push(`lineage: unknown type ${l.type}`);
  return e;
}

module.exports = { validateAircraft, validateConflict, validateLink };
