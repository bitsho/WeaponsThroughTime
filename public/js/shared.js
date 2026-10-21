/* Shared helpers used by both the browser app and the Node API (UMD). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WTTShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  /** "1942" | "1942-06" | "1942-06-04" → fractional year (1942.42). null-safe. */
  function toYear(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const m = String(v).match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    if (!m) return null;
    const y = +m[1], mo = m[2] ? +m[2] : 1, d = m[3] ? +m[3] : 1;
    let doy = d - 1; for (let i = 0; i < mo - 1; i++) doy += DAYS[i];
    // a bare year means "start of year"; a bare month means "start of month"
    return y + doy / 365;
  }

  /** Service interval of an aircraft as numbers. */
  function serviceSpan(a) {
    const s = a.service || {};
    const start = toYear(s.start);
    const end = toYear(s.end) ?? Infinity;
    const front = toYear(s.frontlineEnd) ?? end;
    return { start, end, frontlineEnd: Math.min(front, end) };
  }

  /** Does the aircraft overlap the [from, to] window (inclusive years)? */
  function inWindow(a, from, to) {
    const { start, end } = serviceSpan(a);
    if (start == null) return false;
    return start < to + 1 && end >= from;
  }

  /** Conflict interval. */
  function conflictSpan(c) {
    if (c.date) { const t = toYear(c.date); return { start: t, end: t, point: true }; }
    return { start: toYear(c.start), end: toYear(c.end) ?? toYear(c.start), point: false };
  }

  /** Count aircraft in service per year (for the stats strip). */
  function inServiceByYear(list, from, to, keyFn) {
    const out = [];
    for (let y = from; y <= to; y++) {
      const row = { year: y, total: 0, by: {} };
      for (const a of list) {
        const { start, end } = serviceSpan(a);
        if (start != null && start < y + 1 && end >= y) {
          row.total++;
          const k = keyFn ? keyFn(a) : a.role;
          row.by[k] = (row.by[k] || 0) + 1;
        }
      }
      out.push(row);
    }
    return out;
  }

  return { toYear, serviceSpan, inWindow, conflictSpan, inServiceByYear };
});
