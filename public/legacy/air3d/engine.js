/*!
 * WTT Air3D — procedural 3D aircraft engine (three.js).
 * Builds original, dimensionally-driven aircraft models from JSON specs (metres):
 * lofted superellipse fuselage, NACA-section wings / tails / prop blades,
 * canopy with frames, radial / jet engine details and canvas-painted liveries
 * (insignia, codes, panel lines, rudder stripes, dive-flap perforations).
 *
 * Aircraft axes:  X forward (nose at X≈0, tail at −L) · Y up · Z to starboard (right)
 * Spec axes:      s = distance aft of nose · y = spanwise (+ = starboard) · z = height
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------ math */
export function monotone(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const sgnPow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

/* NACA 4-digit section, closed loop: TE→upper→LE→lower→TE (TE point once). */
export function airfoil(N, t, m = 0, p = 0.4) {
  const up = [], lo = [];
  for (let k = 0; k <= N; k++) {
    const x = (1 - Math.cos(Math.PI * k / N)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dy = 0;
    if (m > 0) {
      if (x < p) { yc = m / (p * p) * (2 * p * x - x * x); dy = 2 * m / (p * p) * (p - x); }
      else { yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x); dy = 2 * m / ((1 - p) ** 2) * (p - x); }
    }
    const th = Math.atan(dy);
    up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  const loop = [];
  for (let k = N; k >= 0; k--) loop.push(up[k]);
  for (let k = 1; k < N; k++) loop.push(lo[k]);
  return loop;
}

/* ------------------------------------------------------- geometry builder */
class GeoBuilder {
  constructor(nGroups) { this.pos = []; this.uv = []; this.groups = Array.from({ length: nGroups }, () => []); }
  v(p, uv) { this.pos.push(p.x, p.y, p.z); this.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0); return this.pos.length / 3 - 1; }
  tri(a, b, c, g) { this.groups[g].push(a, b, c); }
  P(i) { return new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); }
  orient() {
    // make winding consistent with outward normals (positive signed volume)
    let vol = 0; const P = this.pos;
    this.groups.forEach((L) => { for (let i = 0; i < L.length; i += 3) { const a = L[i] * 3, b = L[i + 1] * 3, c = L[i + 2] * 3;
      vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); } });
    if (vol < 0) this.groups.forEach((L) => { for (let i = 0; i < L.length; i += 3) { const t = L[i + 1]; L[i + 1] = L[i + 2]; L[i + 2] = t; } });
    return vol < 0;
  }
  build(skipOrient) {
    const flipped = skipOrient ? false : this.orient();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const idx = []; let start = 0;
    this.groups.forEach((list, gi) => { if (list.length) { g.addGroup(start, list.length, gi); idx.push(...list); start += list.length; } });
    g.setIndex(idx);
    g.computeVertexNormals();
    g.userData.flipped = flipped;
    return g;
  }
}
/* Loft closed rings (all same length). selector(outwardNormal, centroid) → group index.
   Triangles are first collected, then oriented outward (signed volume), then grouped. */
function loftRings(rings, uvFn, selector, opts = {}) {
  const B = new GeoBuilder(opts.groups || 3);
  const M = rings[0].length;
  const ids = rings.map((ring) => ring.map((p) => B.v(p, uvFn(p))));
  const tris = []; // [a, b, c, forcedGroup|null]
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < M; j++) {
      const a = ids[r][j], b = ids[r][(j + 1) % M], c = ids[r + 1][(j + 1) % M], d = ids[r + 1][j];
      tris.push([a, b, c, null], [a, c, d, null]);
    }
  }
  const cap = (ring, idsRing, group, offset) => {
    const ctr = new THREE.Vector3(); ring.forEach((p) => ctr.add(p)); ctr.multiplyScalar(1 / ring.length);
    if (offset) ctr.add(offset);
    const ci = B.v(ctr, uvFn(ctr));
    for (let j = 0; j < M; j++) tris.push([ci, idsRing[j], idsRing[(j + 1) % M], group ?? null, true]);
  };
  if (opts.capStart) cap(rings[0], ids[0], opts.capStart.group, opts.capStart.offset);
  if (opts.capEnd) cap(rings[rings.length - 1], ids[rings.length - 1], opts.capEnd.group, opts.capEnd.offset);
  // orientation per part: body triangles vs. each cap separately follow the body
  const P = B.pos;
  const vol = (t) => { const a = t[0] * 3, b = t[1] * 3, c = t[2] * 3; return P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); };
  // reference point inside the body: centroid of all ring points
  const ref = new THREE.Vector3(); let cnt = 0; rings.forEach((rg) => rg.forEach((p) => { ref.add(p); cnt++; })); ref.multiplyScalar(1 / cnt);
  const body = tris.filter((t) => !t[4]);
  let V = 0; body.forEach((t) => { V += vol(t); });
  const flipBody = V < 0;
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), c = new THREE.Vector3();
  for (const t of tris) {
    if (t[4]) {
      // caps: orient so the normal points away from the body centroid
      const A = B.P(t[0]), Bv = B.P(t[1]), D = B.P(t[2]);
      e1.subVectors(Bv, A); e2.subVectors(D, A); n.crossVectors(e1, e2);
      c.copy(A).add(Bv).add(D).multiplyScalar(1 / 3);
      if (n.dot(c.clone().sub(ref)) < 0) { const x = t[1]; t[1] = t[2]; t[2] = x; }
    } else if (flipBody) { const x = t[1]; t[1] = t[2]; t[2] = x; }
    const A = B.P(t[0]), Bv = B.P(t[1]), D = B.P(t[2]);
    e1.subVectors(Bv, A); e2.subVectors(D, A); n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-16) continue;
    n.normalize(); c.copy(A).add(Bv).add(D).multiplyScalar(1 / 3);
    B.tri(t[0], t[1], t[2], t[3] != null ? t[3] : selector(n, c));
  }
  return B.build(true);
}

/* ------------------------------------------------------- texture frames */
function makeFrames(spec) {
  const L = spec.length, half = spec.span / 2;
  const ppm = (spec.texture && spec.texture.ppm) || 150;
  const side = { x0: -L - 1.2, x1: 1.4, y0: -2.4, y1: 3.4, ppm };
  const top = { x0: -L - 1.2, x1: 1.4, z0: -half - 0.8, z1: half + 0.8, ppm };
  return {
    side, top,
    uvSide: (p) => [(p.x - side.x0) / (side.x1 - side.x0), (p.y - side.y0) / (side.y1 - side.y0)],
    uvTop: (p) => [(p.x - top.x0) / (top.x1 - top.x0), (p.z - top.z0) / (top.z1 - top.z0)]
  };
}

/* -------------------------------------------------------------- fuselage */
function buildFuselage(F, fr) {
  const st = F.stations, S = st.map((o) => o.s);
  const fw = monotone(S, st.map((o) => o.w)), ft = monotone(S, st.map((o) => o.top)), fb = monotone(S, st.map((o) => o.bot));
  const fn = monotone(S, st.map((o) => o.n ?? 2.2)), fnb = monotone(S, st.map((o) => o.nb ?? o.n ?? 2.2));
  const s0 = S[0], s1 = S[S.length - 1];
  const R = F.rings || 120, N = F.seg || 56;
  const rings = [];
  for (let r = 0; r <= R; r++) {
    const t = r / R;
    const s = s0 + (s1 - s0) * (0.55 * t + 0.45 * (0.5 - 0.5 * Math.cos(Math.PI * t)));
    const w = Math.max(fw(s), 0.004), top = ft(s), bot = fb(s), yc = (top + bot) / 2, h = Math.max((top - bot) / 2, 0.004);
    const n = fn(s), nb = fnb(s);
    const ring = [];
    for (let j = 0; j < N; j++) {
      const th = Math.PI / 2 - (2 * Math.PI * j) / N; // start at top, go to starboard
      const cx = Math.cos(th), cy = Math.sin(th);
      const ex = cy >= 0 ? n : nb;
      ring.push(new THREE.Vector3(-s, yc + h * sgnPow(cy, 2 / ex), w * sgnPow(cx, 2 / ex)));
    }
    rings.push(ring);
  }
  const sel = (nrm, c) => (c.z < 0 ? 0 : 1);
  const front = F.front || 'nose';
  return loftRings(rings, fr.uvSide, sel, {
    groups: 3,
    capStart: front === 'nose' ? {} : { group: 2, offset: new THREE.Vector3(-(F.intakeDepth ?? 0.25), 0, 0) },
    capEnd: F.tail === 'open' ? { group: 2, offset: new THREE.Vector3(F.nozzleDepth ?? 0.4, 0, 0) } : {}
  });
}
/* sample fuselage outline for placing details */
function fuselageAt(F) {
  const st = F.stations, S = st.map((o) => o.s);
  const fw = monotone(S, st.map((o) => o.w)), ft = monotone(S, st.map((o) => o.top)), fb = monotone(S, st.map((o) => o.bot));
  return (s) => ({ w: fw(s), top: ft(s), bot: fb(s) });
}

/* ------------------------------------------------------ lifting surfaces */
/* sections: [{y, le, chord, z, t, twist}] along the span axis (or height for fins). */
function expandSections(def) {
  const sec = def.sections.map((o) => Object.assign({ twist: 0, t: 0.12, z: 0 }, o));
  const out = [];
  const sub = def.sub || 6;
  for (let i = 0; i < sec.length - 1; i++) {
    for (let k = 0; k < sub; k++) {
      const a = sec[i], b = sec[i + 1], t = k / sub;
      out.push({ y: lerp(a.y, b.y, t), le: lerp(a.le, b.le, t), chord: lerp(a.chord, b.chord, t), z: lerp(a.z, b.z, t), t: lerp(a.t, b.t, t), twist: lerp(a.twist, b.twist, t) });
    }
  }
  out.push(Object.assign({}, sec[sec.length - 1]));
  // rounded tip
  const tip = out[out.length - 1], r = def.tipRound ?? 0;
  if (r > 0) {
    const steps = [0.3, 0.55, 0.75, 0.88, 0.96, 1];
    const prev = out[out.length - 2];
    const dz = (tip.z - prev.z) / Math.max(1e-6, tip.y - prev.y);
    const bias = def.tipBias ?? 0.45; // where the tip point sits along the chord (0 = LE)
    for (const ph of steps) {
      const k = Math.sqrt(Math.max(0, 1 - ph * ph));
      const chord = Math.max(tip.chord * k, 0.006);
      out.push({ y: tip.y + r * ph, le: tip.le + (tip.chord - chord) * bias, chord, z: tip.z + dz * r * ph, t: tip.t * (0.55 + 0.45 * k), twist: tip.twist });
    }
  }
  return out;
}
export function planformFn(def) {
  const sec = def.sections;
  const Y = sec.map((o) => o.y);
  const L = (y) => { let i = 0; while (i < sec.length - 2 && y > sec[i + 1].y) i++; const a = sec[i], b = sec[i + 1], t = Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y))); return { le: lerp(a.le, b.le, t), chord: lerp(a.chord, b.chord, t), z: lerp(a.z, b.z, t) }; };
  return L;
}
/* kind: 'wing' (span along Z, mirrored), 'fin' (span along +Y), 'blade' (local) */
function buildSurface(def, kind, side, fr) {
  const N = def.points || 30;
  const camber = def.camber ?? (kind === 'wing' ? 0.02 : 0);
  const secs = expandSections(def);
  const rings = secs.map((sc) => {
    const foil = airfoil(N, sc.t, camber, 0.4);
    const tw = (sc.twist || 0) * Math.PI / 180, ct = Math.cos(tw), stw = Math.sin(tw);
    return foil.map(([xc, yc]) => {
      // twist about quarter chord
      const dx = (xc - 0.25) * sc.chord, dy = yc * sc.chord;
      const rx = 0.25 * sc.chord + dx * ct + dy * stw, ry = -dx * stw + dy * ct;
      const X = -(sc.le + rx);
      if (kind === 'fin') return new THREE.Vector3(X, sc.y, (def.offset || 0) + ry);
      return new THREE.Vector3(X, sc.z + ry, side * sc.y);
    });
  });
  if (kind === 'fin') {
    return loftRings(rings, fr.uvSide, (n) => (n.z < 0 ? 0 : 1), { groups: 2, flip: true, capStart: {} });
  }
  return loftRings(rings, fr.uvTop, (n) => (n.y >= 0 ? 0 : 1), { groups: 2, flip: side < 0, capStart: {} });
}

/* ---------------------------------------------------------------- canopy */
function buildCanopy(C, fus, mats) {
  const g = new THREE.Group();
  const st = C.stations, S = st.map((o) => o.s);
  const fw = monotone(S, st.map((o) => o.w)), fbase = monotone(S, st.map((o) => o.base)), ftop = monotone(S, st.map((o) => o.top));
  const n = C.n ?? 2.4;
  const s0 = S[0], s1 = S[S.length - 1], R = 60, M = 28;
  const pt = (s, j, grow = 0) => {
    const th = Math.PI * j / M; // 0..π  (starboard → port over the top)
    const w = Math.max(fw(s), 0.003) + grow, base = fbase(s), h = Math.max(ftop(s) - base, 0.003) + grow;
    return new THREE.Vector3(-s, base + h * Math.pow(Math.sin(th), 2 / n), w * sgnPow(Math.cos(th), 2 / n));
  };
  const pos = [], idx = [];
  for (let r = 0; r <= R; r++) { const s = lerp(s0, s1, r / R); for (let j = 0; j <= M; j++) { const p = pt(s, j); pos.push(p.x, p.y, p.z); } }
  for (let r = 0; r < R; r++) for (let j = 0; j < M; j++) { const a = r * (M + 1) + j, b = a + 1, c = a + M + 2, d = a + M + 1; idx.push(a, c, b, a, d, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const glass = new THREE.Mesh(geo, mats.glass); glass.renderOrder = 2; g.add(glass);
  // frames: arcs at stations + optional top rail
  const r = C.frameR ?? 0.018;
  (C.frames || []).forEach((s) => {
    const pts = []; for (let j = 0; j <= M; j++) pts.push(pt(s, j, 0.006));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 6, false), mats.frame));
  });
  if (C.rail) {
    const pts = []; for (let k = 0; k <= 30; k++) pts.push(pt(lerp(C.rail[0], C.rail[1], k / 30), M / 2, 0.006));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, r * 0.9, 6, false), mats.frame));
  }
  (C.sideRails || []).forEach((jj) => {
    [jj, M - jj].forEach((j) => {
      const pts = []; for (let k = 0; k <= 30; k++) pts.push(pt(lerp(s0 + 0.02, s1 - 0.02, k / 30), j, 0.006));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, r * 0.8, 6, false), mats.frame));
    });
  });
  // crew heads
  (C.crew || []).forEach((c) => {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), mats.helmet);
    head.position.set(-c.s, c.z, 0); g.add(head);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.35, 16), mats.helmet);
    body.position.set(-c.s - 0.05, c.z - 0.28, 0); g.add(body);
  });
  return g;
}

/* ------------------------------------------------------------- propeller */
function buildProp(P, mats) {
  const g = new THREE.Group();
  const R = P.diameter / 2;
  const chord = P.chord ?? 0.27;
  const bladeDef = (r0, r1, tipRound) => ({
    sections: [
      { y: r0, le: -chord * 0.35, chord: chord * 0.55, z: 0, t: 0.22, twist: 52 },
      { y: R * 0.32, le: -chord * 0.5, chord: chord * 0.95, z: 0, t: 0.12, twist: 38 },
      { y: R * 0.6, le: -chord * 0.5, chord: chord, z: 0, t: 0.08, twist: 26 },
      { y: r1, le: -chord * 0.45, chord: chord * 0.86, z: 0, t: 0.06, twist: 18 }
    ].filter((o) => o.y >= r0 && o.y <= r1).concat(r1 < R * 0.6 ? [] : []),
    tipRound, points: 14, camber: 0.03, sub: 3
  });
  const tipStart = R * 0.88;
  const fr = { uvTop: () => [0, 0] };
  const mk = (def) => buildSurface(def, 'wing', 1, fr);
  const mainDef = { sections: [
    { y: 0.12, le: -chord * 0.3, chord: chord * 0.5, z: 0, t: 0.3, twist: 55 },
    { y: R * 0.3, le: -chord * 0.5, chord: chord * 0.95, z: 0, t: 0.12, twist: 40 },
    { y: R * 0.6, le: -chord * 0.5, chord: chord, z: 0, t: 0.08, twist: 27 },
    { y: tipStart, le: -chord * 0.46, chord: chord * 0.88, z: 0, t: 0.065, twist: 20 }
  ], points: 14, camber: 0.03, sub: 3 };
  const tipDef = { sections: [
    { y: tipStart, le: -chord * 0.46, chord: chord * 0.88, z: 0, t: 0.065, twist: 20 },
    { y: R - chord * 0.3, le: -chord * 0.43, chord: chord * 0.8, z: 0, t: 0.06, twist: 18 }
  ], tipRound: chord * 0.3, tipBias: 0.5, points: 14, camber: 0.03, sub: 2 };
  // re-map: span Z→Y (radial), chord X→Z (tangential), thickness Y→X (axial)
  const remap = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  const gMain = mk(mainDef).applyMatrix4(remap), gTip = mk(tipDef).applyMatrix4(remap);
  gMain.computeVertexNormals(); gTip.computeVertexNormals();
  const blades = new THREE.Group();
  for (let i = 0; i < P.blades; i++) {
    const b = new THREE.Group();
    const m1 = new THREE.Mesh(gMain, [mats.prop, mats.prop]);
    const m2 = new THREE.Mesh(gTip, [mats.propTip, mats.propTip]);
    // surface built with span along +Z and chord along −X; rotate so the chord lies in the disc plane
    [m1, m2].forEach((m) => { m.castShadow = true; b.add(m); });
    b.rotation.x = (i / P.blades) * Math.PI * 2 + (P.phase || 0.35);
    blades.add(b);
  }
  g.add(blades);
  // hub / spinner
  const hubR = P.hubR ?? 0.2;
  if (P.hub === 'spinner') {
    const pts = []; for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push(new THREE.Vector2(hubR * Math.sqrt(Math.max(0, 1 - t * t)), t * hubR * 2.2)); }
    const sp = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), mats.spinner); sp.rotation.z = -Math.PI / 2; g.add(sp);
  } else {
    const hub = new THREE.Mesh(new THREE.SphereGeometry(hubR, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), mats.hub);
    hub.rotation.z = -Math.PI / 2; hub.scale.set(1, 0.85, 1); g.add(hub);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.95, hubR * 0.95, 0.22, 28), mats.hub);
    barrel.rotation.z = Math.PI / 2; barrel.position.x = -0.1; g.add(barrel);
  }
  // motion disc (visible only when spinning)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 64), mats.disc);
  disc.rotation.y = Math.PI / 2; disc.visible = false; g.add(disc);
  g.userData = { blades, disc };
  g.position.set(-P.s, P.z || 0, 0);
  if (P.tilt) g.rotation.z = -P.tilt * Math.PI / 180;
  return g;
}

/* ---------------------------------------------------------- radial engine */
function buildRadialFace(E, fus, mats) {
  const g = new THREE.Group();
  const f = fus(E.s ?? 0.05);
  const r = Math.min(f.w, (f.top - f.bot) / 2) * (E.r ?? 0.86);
  const yc = (f.top + f.bot) / 2 + (E.dz || 0);
  const x = -(E.s ?? 0.05) - (E.inset ?? 0.12);
  const crank = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 28, 18), mats.engine); crank.scale.set(0.55, 1, 1); crank.position.set(x + 0.02, yc, 0); g.add(crank);
  const n = E.cyl || 18, rows = n > 9 ? 2 : 1, per = n / rows;
  const cylGeo = new THREE.CylinderGeometry(r * 0.13, r * 0.15, r * 0.48, 12);
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < per; i++) {
      const a = (i + row * 0.5) / per * Math.PI * 2;
      const c = new THREE.Mesh(cylGeo, mats.engine);
      const rr = r * 0.66;
      c.position.set(x - row * 0.14, yc + Math.cos(a) * rr, Math.sin(a) * rr);
      c.rotation.x = -a; g.add(c);
      // cooling fins look: thin dark rings
    }
  }
  const back = new THREE.Mesh(new THREE.CircleGeometry(r * 1.02, 48), mats.dark); back.rotation.y = Math.PI / 2; back.position.set(x - 0.3, yc, 0); g.add(back);
  return g;
}

/* --------------------------------------------------------------- details */
function cyl(r1, r2, len, mat, seg = 14) { return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat); }
function buildDetails(spec, fus, wingPF, mats) {
  const g = new THREE.Group();
  (spec.details || []).forEach((d) => {
    if (d.type === 'guns') {
      const pf = wingPF;
      d.y.forEach((y) => [1, -1].forEach((side) => {
        const p = pf(y);
        const m = cyl(d.r || 0.022, d.r || 0.022, d.len || 0.35, mats.gunmetal);
        m.rotation.z = Math.PI / 2; m.position.set(-(p.le) + (d.len || 0.35) / 2 - 0.05, p.z + (d.dz || 0.02), side * y); g.add(m);
      }));
    } else if (d.type === 'exhaust') {
      for (let i = 0; i < d.n; i++) [1, -1].forEach((side) => {
        const s = d.s + i * (d.gap || 0.16), f = fus(s);
        const m = cyl(0.035, 0.04, 0.13, mats.exhaust, 10);
        m.rotation.z = Math.PI / 2 + 0.35; m.position.set(-s, lerp(f.bot, f.top, d.h ?? 0.35), side * (f.w * (d.out ?? 0.97)));
        g.add(m);
      });
    } else if (d.type === 'mast') {
      const f = fus(d.s);
      const m = cyl(0.012, 0.03, d.h, mats.frame, 8); m.position.set(-d.s, f.top + d.h / 2 - 0.02, 0); m.rotation.z = -(d.rake || 15) * Math.PI / 180; g.add(m);
      if (d.wireTo) {
        const a = new THREE.Vector3(-d.s - Math.sin((d.rake || 15) * Math.PI / 180) * d.h, f.top + d.h * 0.95, 0);
        const b = new THREE.Vector3(-d.wireTo[0], d.wireTo[1], 0);
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.004, 4), mats.frame));
      }
    } else if (d.type === 'pitot') {
      const p = wingPF(d.y);
      const m = cyl(0.01, 0.01, 0.5, mats.metal, 6); m.rotation.z = Math.PI / 2; m.position.set(-p.le + 0.2, p.z - 0.05, (d.side || -1) * d.y); g.add(m);
    } else if (d.type === 'hook') {
      const f = fus(d.s);
      const m = cyl(0.025, 0.02, d.len || 0.9, mats.hook, 8); m.rotation.z = Math.PI / 2 - 0.12; m.position.set(-d.s - (d.len || 0.9) / 2, f.bot + 0.02, 0); g.add(m);
    } else if (d.type === 'rearGuns') {
      [-1, 1].forEach((k) => {
        const m = cyl(0.018, 0.018, 0.9, mats.gunmetal, 8); m.rotation.z = Math.PI / 2 + (d.elev || -0.12); m.position.set(-d.s - 0.4, d.z, k * 0.07); g.add(m);
      });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.26), mats.gunmetal); body.position.set(-d.s + 0.05, d.z - 0.03, 0); g.add(body);
    } else if (d.type === 'bomb') {
      const pts = [];
      const L = d.len, R = d.dia / 2;
      for (let k = 0; k <= 24; k++) { const t = k / 24; const r = t < 0.25 ? R * Math.sin((t / 0.25) * Math.PI / 2) : t > 0.7 ? R * (1 - (t - 0.7) / 0.3 * 0.75) : R; pts.push(new THREE.Vector2(Math.max(r, 0.01), -t * L)); }
      const b = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), mats.bomb); b.rotation.z = -Math.PI / 2; b.position.set(-d.s, d.z, 0); g.add(b);
      for (let i = 0; i < 4; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.005, R * 1.9), mats.bomb); fin.position.set(-d.s - L + 0.16, d.z, 0); fin.rotation.x = i * Math.PI / 4; g.add(fin); }
      const band = cyl(R * 1.01, R * 1.01, 0.05, mats.bombBand, 28); band.rotation.z = Math.PI / 2; band.position.set(-d.s - L * 0.18, d.z, 0); g.add(band);
    } else if (d.type === 'tipTank') {
      [1, -1].forEach((side) => {
        const pts = []; const L = d.len, R = d.dia / 2;
        for (let k = 0; k <= 40; k++) { const t = k / 40; const r = t < 0.35 ? R * Math.sqrt(Math.sin((t / 0.35) * Math.PI / 2)) : R * Math.sqrt(Math.max(0, 1 - ((t - 0.35) / 0.65) ** 2.2)); pts.push(new THREE.Vector2(Math.max(r, 0.004), -t * L)); }
        const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), mats.tank); m.rotation.z = -Math.PI / 2; m.position.set(-d.s, d.z, side * d.y); m.castShadow = true; m.receiveShadow = true; g.add(m);
        if (mats.tankBand) { const band = new THREE.Mesh(new THREE.LatheGeometry(pts.slice(0, 9), 40), mats.tankBand); band.rotation.z = -Math.PI / 2; band.position.copy(m.position); band.scale.setScalar(1.004); g.add(band); }
      });
    } else if (d.type === 'intake') {
      [1, -1].forEach((side) => {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(d.h / 2, d.w - d.h, 8, 16), mats.dark);
        m.rotation.x = Math.PI / 2; m.scale.set(0.35, 1, 1); m.position.set(-d.s, d.z, side * d.y); g.add(m);
      });
    } else if (d.type === 'nozzle') {
      const m = cyl(d.r, d.r * 1.02, 0.25, mats.nozzle, 28); m.rotation.z = Math.PI / 2; m.position.set(-d.s, d.z, 0); g.add(m);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(d.r * 0.8, 32), mats.glow); glow.rotation.y = -Math.PI / 2; glow.position.set(-d.s - 0.1, d.z, 0); glow.userData.glow = true; g.add(glow);
    } else if (d.type === 'scoop') {
      const f = fus(d.s);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(d.r, d.len, 8, 16), mats.paintRight);
      m.rotation.z = Math.PI / 2; m.scale.set(1, 1, d.wide || 1.2); m.position.set(-d.s - d.len / 2, f.bot + (d.dz ?? 0.06), 0); g.add(m);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(d.r * 0.82, 24), mats.dark); mouth.rotation.y = Math.PI / 2; mouth.scale.set(1, 1, d.wide || 1.2); mouth.position.set(-d.s + d.r * 0.9, f.bot + (d.dz ?? 0.06), 0); g.add(mouth);
    } else if (d.type === 'sight') {
      const m = cyl(d.r || 0.035, d.r || 0.035, d.len, mats.gunmetal, 12); m.rotation.z = Math.PI / 2; m.position.set(-d.s - d.len / 2, d.z, d.y || 0); g.add(m);
    } else if (d.type === 'oilCooler') {
      [1, -1].forEach((side) => {
        const p = wingPF(d.y + d.w / 2);
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, d.h, d.w), mats.dark); m.position.set(-p.le + 0.005, p.z + 0.02, side * (d.y + d.w / 2)); g.add(m);
      });
    }
  });
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/* ---------------------------------------------------------------- livery */
const INS = { blue: '#1a2a6c', white: '#f4f4f0', red: '#c3172e' };
function drawStar(ctx, cx, cy, r, era, rot = 0) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
  if (era === 'ww2b' || era === 'usn47') {
    const bw = r, bh = r * 0.5, ol = r * 0.1, by = -bh / 2 + r * 0.12;
    ctx.fillStyle = INS.blue; ctx.fillRect(-r - bw - ol, by - ol, 2 * (r + bw + ol), bh + 2 * ol);
    ctx.fillStyle = INS.white; ctx.fillRect(-r - bw, by, 2 * (r + bw), bh);
    if (era === 'usn47') { ctx.fillStyle = INS.red; ctx.fillRect(-r - bw, by + bh * 0.33, 2 * (r + bw), bh * 0.34); }
  }
  ctx.fillStyle = INS.blue; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = INS.white; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.382 : r * 0.985; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
  if (era === 'prewar') { ctx.fillStyle = INS.red; ctx.beginPath(); ctx.arc(0, 0, r * 0.37, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function noise(ctx, W, H, alpha) {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * alpha; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
}
function sideCanvas(spec, L, fr, mirrored) {
  const f = fr.side, W = Math.round((f.x1 - f.x0) * f.ppm), H = Math.round((f.y1 - f.y0) * f.ppm);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const X = (s) => (-s - f.x0) * f.ppm, Y = (z) => (f.y1 - z) * f.ppm;
  const sc = L.scheme;
  // base scheme by height
  if (sc.type === 'tri') {
    const g = ctx.createLinearGradient(0, Y(sc.y1 + 0.06), 0, Y(sc.y2 - 0.06));
    ctx.fillStyle = sc.top; ctx.fillRect(0, 0, W, Y(sc.y1));
    const feather = 0.05 * f.ppm;
    let gg = ctx.createLinearGradient(0, Y(sc.y1) - feather, 0, Y(sc.y1) + feather); gg.addColorStop(0, sc.top); gg.addColorStop(1, sc.mid);
    ctx.fillStyle = gg; ctx.fillRect(0, Y(sc.y1) - feather, W, 2 * feather);
    ctx.fillStyle = sc.mid; ctx.fillRect(0, Y(sc.y1) + feather, W, Y(sc.y2) - Y(sc.y1) - 2 * feather);
    gg = ctx.createLinearGradient(0, Y(sc.y2) - feather, 0, Y(sc.y2) + feather); gg.addColorStop(0, sc.mid); gg.addColorStop(1, sc.low);
    ctx.fillStyle = gg; ctx.fillRect(0, Y(sc.y2) - feather, W, 2 * feather);
    ctx.fillStyle = sc.low; ctx.fillRect(0, Y(sc.y2) + feather, W, H);
    // fin: intermediate blue (regulation); drawn as everything above fuselage top behind finStart
    if (spec.fin && sc.fin) { ctx.fillStyle = sc.fin; ctx.fillRect(X(sc.finFrom ?? spec.fin.sections[0].le), 0, W, Y(sc.finAbove ?? 0.55)); }
  } else if (sc.type === 'two') {
    ctx.fillStyle = sc.top; ctx.fillRect(0, 0, W, H);
    const feather = 0.05 * f.ppm, gy = Y(sc.y);
    const gg = ctx.createLinearGradient(0, gy - feather, 0, gy + feather); gg.addColorStop(0, sc.top); gg.addColorStop(1, sc.low);
    ctx.fillStyle = gg; ctx.fillRect(0, gy - feather, W, 2 * feather);
    ctx.fillStyle = sc.low; ctx.fillRect(0, gy + feather, W, H);
  } else {
    ctx.fillStyle = sc.color; ctx.fillRect(0, 0, W, H);
  }
  // rudder stripes (13 red/white, Jan–May 1942)
  const fin = spec.fin;
  if (L.rudder === 'stripes42' && fin && fin.hinge) {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(X(fin.hinge[0][0]), Y(fin.hinge[0][1])); ctx.lineTo(X(fin.hinge[1][0]), Y(fin.hinge[1][1]));
    ctx.lineTo(X(spec.length + 0.6), Y(fin.hinge[1][1] + 0.4)); ctx.lineTo(X(spec.length + 0.6), Y(fin.hinge[0][1] - 0.4)); ctx.closePath(); ctx.clip();
    const z0 = fin.hinge[0][1] - 0.3, z1 = fin.hinge[1][1] + 0.3;
    for (let i = 0; i < 13; i++) { ctx.fillStyle = i % 2 ? INS.white : INS.red; ctx.fillRect(0, Y(lerp(z0, z1, (i + 1) / 13)), W, Y(lerp(z0, z1, i / 13)) - Y(lerp(z0, z1, (i + 1) / 13)) + 1); }
    ctx.restore();
  }
  // panel lines
  ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = Math.max(1, f.ppm * 0.009);
  (spec.panels && spec.panels.frames || []).forEach((s) => { ctx.beginPath(); ctx.moveTo(X(s), 0); ctx.lineTo(X(s), H); ctx.stroke(); });
  (spec.panels && spec.panels.longerons || []).forEach((ln) => { ctx.beginPath(); ctx.moveTo(X(ln[0]), Y(ln[2])); ctx.lineTo(X(ln[1]), Y(ln[2])); ctx.stroke(); });
  if (fin && fin.hinge) { ctx.beginPath(); ctx.moveTo(X(fin.hinge[0][0]), Y(fin.hinge[0][1])); ctx.lineTo(X(fin.hinge[1][0]), Y(fin.hinge[1][1])); ctx.stroke(); }
  // rivet dots along frames (subtle)
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  (spec.panels && spec.panels.frames || []).forEach((s) => { for (let z = -1.2; z < 1.4; z += 0.08) { ctx.fillRect(X(s) + f.ppm * 0.02, Y(z), 1.5, 1.5); } });
  // cowl ring colour
  if (L.cowl) { ctx.fillStyle = L.cowl; ctx.fillRect(X(spec.cowlEnd ?? 1.2), 0, X(-0.2) - X(spec.cowlEnd ?? 1.2), H); }
  // stencils: gun ports, walkway etc.
  (spec.sideDots || []).forEach((d) => { ctx.fillStyle = '#0b0d10'; ctx.beginPath(); ctx.arc(X(d.s), Y(d.z), d.r * f.ppm, 0, Math.PI * 2); ctx.fill(); });
  // insignia
  if (L.insignia && L.insignia.fuselage) { const p = L.insignia.fuselage; drawStar(ctx, X(p.s), Y(p.z), p.r * f.ppm, L.insignia.era); }
  // markings text
  (L.markings || []).forEach((m) => {
    if (m.side && ((m.side === 'left') !== mirrored)) return;
    ctx.save();
    const h = m.h * f.ppm;
    ctx.translate(X(m.s), Y(m.z));
    if (mirrored) ctx.scale(-1, 1);
    ctx.font = `${m.weight || 700} ${h}px ${m.font || "'Oxanium','Arial Narrow',Arial,sans-serif"}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (m.stroke) { ctx.lineWidth = h * 0.08; ctx.strokeStyle = m.stroke; ctx.strokeText(m.text, 0, 0); }
    ctx.fillStyle = m.color || '#f2f2ee'; ctx.fillText(m.text, 0, 0);
    ctx.restore();
  });
  noise(ctx, W, H, sc.type === 'solid' && L.finish === 'gloss' ? 5 : 9);
  return cv;
}
function planCanvas(spec, L, fr, which) {
  const f = fr.top, W = Math.round((f.x1 - f.x0) * f.ppm), H = Math.round((f.z1 - f.z0) * f.ppm);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const X = (s) => (-s - f.x0) * f.ppm, Zc = (y) => (f.z1 - y) * f.ppm; // y: starboard +
  const sc = L.scheme;
  ctx.fillStyle = which === 'top' ? (sc.wingTop || sc.top || sc.color) : (sc.wingLow || sc.low || sc.color);
  ctx.fillRect(0, 0, W, H);
  const lw = Math.max(1, f.ppm * 0.01);
  ctx.strokeStyle = 'rgba(0,0,0,0.34)'; ctx.lineWidth = lw;
  const surf = (def, mirrorBoth = true) => {
    const pf = planformFn(def);
    const ys = def.sections.map((o) => o.y), yMin = ys[0], yMax = ys[ys.length - 1];
    const line = (frac, y0, y1, side) => { ctx.beginPath(); for (let k = 0; k <= 20; k++) { const y = lerp(y0, y1, k / 20), p = pf(y); const px = X(p.le + p.chord * frac), py = Zc(side * y); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); };
    const rib = (y, a, b, side) => { const p = pf(y); ctx.beginPath(); ctx.moveTo(X(p.le + p.chord * a), Zc(side * y)); ctx.lineTo(X(p.le + p.chord * b), Zc(side * y)); ctx.stroke(); };
    [1, -1].forEach((side) => {
      line(0.12, yMin, yMax, side); line(0.42, yMin, yMax, side);
      (def.controls || []).forEach((c) => { line(c.at, c.y0, c.y1, side); rib(c.y0, c.at, 1, side); rib(c.y1, c.at, 1, side); if (c.tab) { rib(c.tab[0], c.at, 1, side); rib(c.tab[1], c.at, 1, side); } });
      (def.ribs || []).forEach((y) => rib(y, 0.05, 0.98, side));
      // dive-flap perforations
      (def.controls || []).filter((c) => c.perforated).forEach((c) => {
        ctx.save(); ctx.fillStyle = 'rgba(8,10,14,0.85)';
        for (let y = c.y0 + 0.08; y < c.y1 - 0.05; y += 0.13) {
          const p = pf(y);
          for (let fr2 = c.at + 0.03; fr2 < 0.985; fr2 += 0.045) { ctx.beginPath(); ctx.arc(X(p.le + p.chord * fr2), Zc(side * y), f.ppm * 0.028, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.restore();
      });
    });
  };
  if (spec.wing) surf(spec.wing);
  if (spec.hstab) surf(spec.hstab);
  // walkways (non-skid) on top
  if (which === 'top') (spec.walkways || []).forEach((w) => { const pf = planformFn(spec.wing); [1, -1].forEach((side) => { ctx.fillStyle = 'rgba(25,28,32,0.28)'; const p0 = pf(w.y0), p1 = pf(w.y1); ctx.beginPath(); ctx.moveTo(X(p0.le + p0.chord * w.a), Zc(side * w.y0)); ctx.lineTo(X(p0.le + p0.chord * w.b), Zc(side * w.y0)); ctx.lineTo(X(p1.le + p1.chord * w.b), Zc(side * w.y1)); ctx.lineTo(X(p1.le + p1.chord * w.a), Zc(side * w.y1)); ctx.closePath(); ctx.fill(); }); });
  // insignia
  const ins = L.insignia;
  if (ins && spec.wing) {
    const pf = planformFn(spec.wing);
    const put = (y) => { const p = pf(Math.abs(y)); const r = (ins.wingR || 0.42) * p.chord; drawStar(ctx, X(p.le + p.chord * 0.48), Zc(y), r * f.ppm, ins.era === 'ww2b' || ins.era === 'usn47' ? ins.era : ins.era, Math.PI / 2); };
    const y = ins.wingY || spec.span * 0.36;
    if (which === 'top') { put(-y); if (ins.allFour) put(y); }
    else { put(y); if (ins.allFour) put(-y); }
  }
  (L.wingMarkings || []).filter((m) => m.surface === which).forEach((m) => {
    ctx.save(); ctx.translate(X(m.s), Zc(m.y)); ctx.rotate(m.rot ?? Math.PI / 2); if (which === 'top') ctx.scale(1, -1);
    ctx.font = `700 ${m.h * f.ppm}px 'Oxanium',Arial,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = m.color || '#fff'; ctx.fillText(m.text, 0, 0); ctx.restore();
  });
  noise(ctx, W, H, 8);
  return cv;
}

/* ------------------------------------------------------------- materials */
function paintMaterial(canvas, finish, renderer) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
  const gloss = finish === 'gloss', metal = finish === 'metal';
  return new THREE.MeshPhysicalMaterial({
    map: tex,
    roughness: gloss ? 0.36 : metal ? 0.28 : 0.72,
    metalness: gloss ? 0.15 : metal ? 0.9 : 0.05,
    clearcoat: gloss ? 0.45 : 0, clearcoatRoughness: 0.22,
    envMapIntensity: gloss ? 0.9 : 0.7
  });
}
function baseMaterials(L) {
  const M = (o) => new THREE.MeshStandardMaterial(o);
  return {
    dark: M({ color: 0x0b0d10, roughness: 0.9 }),
    engine: M({ color: 0x3b3f45, roughness: 0.55, metalness: 0.6 }),
    gunmetal: M({ color: 0x2a2d31, roughness: 0.4, metalness: 0.7 }),
    exhaust: M({ color: 0x2a221d, roughness: 0.85, metalness: 0.3 }),
    metal: M({ color: 0x9aa1a8, roughness: 0.3, metalness: 0.9 }),
    frame: M({ color: new THREE.Color(L.frame || L.scheme.top || L.scheme.color), roughness: 0.5 }),
    prop: M({ color: 0x15171a, roughness: 0.55, metalness: 0.2 }),
    propTip: M({ color: new THREE.Color(L.propTip || '#f2c21b'), roughness: 0.5 }),
    hub: M({ color: new THREE.Color(L.hub || '#1c1f23'), roughness: 0.35, metalness: 0.5 }),
    spinner: M({ color: new THREE.Color(L.hub || '#1c1f23'), roughness: 0.3, metalness: 0.4 }),
    helmet: M({ color: 0x2f2a22, roughness: 0.85 }),
    hook: M({ color: 0x2b2b2b, roughness: 0.5 }),
    bomb: M({ color: 0x4b5039, roughness: 0.6, metalness: 0.2 }),
    bombBand: M({ color: 0xd8b422, roughness: 0.6 }),
    nozzle: M({ color: 0x2c2724, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.0 }),
    tank: null, tankBand: null,
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fc4dc, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, clearcoat: 1, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false }),
    disc: new THREE.MeshBasicMaterial({ color: 0xcfd6dc, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
  };
}

/* ------------------------------------------------------------- assemble */
export function buildAircraft(spec, liveryId, renderer) {
  const L = spec.liveries.find((l) => l.id === liveryId) || spec.liveries[0];
  const fr = makeFrames(spec);
  const mats = baseMaterials(L);
  const sideL = paintMaterial(sideCanvas(spec, L, fr, true), L.finish, renderer);
  const sideR = paintMaterial(sideCanvas(spec, L, fr, false), L.finish, renderer);
  const top = paintMaterial(planCanvas(spec, L, fr, 'top'), L.finish, renderer);
  const bot = paintMaterial(planCanvas(spec, L, fr, 'bottom'), L.finish, renderer);
  mats.paintRight = sideR;
  mats.tank = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(L.tank || L.scheme.color || L.scheme.top), roughness: L.finish === 'gloss' ? 0.3 : 0.65, clearcoat: L.finish === 'gloss' ? 0.75 : 0, metalness: 0.15 });
  if (L.tankBand) mats.tankBand = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(L.tankBand), roughness: 0.35, clearcoat: 0.6 });
  mats.frame.color = new THREE.Color(L.frame || (L.scheme.type === 'solid' ? L.scheme.color : L.scheme.top));

  const root = new THREE.Group();
  const fus = fuselageAt(spec.fuselage);
  const fusMesh = new THREE.Mesh(buildFuselage(spec.fuselage, fr), [sideL, sideR, mats.dark]);
  root.add(fusMesh);
  const wingPF = spec.wing ? planformFn(spec.wing) : null;
  if (spec.wing) [1, -1].forEach((side) => root.add(new THREE.Mesh(buildSurface(spec.wing, 'wing', side, fr), [top, bot])));
  if (spec.hstab) [1, -1].forEach((side) => root.add(new THREE.Mesh(buildSurface(spec.hstab, 'wing', side, fr), [top, bot])));
  if (spec.fin) root.add(new THREE.Mesh(buildSurface(Object.assign({ camber: 0 }, spec.fin), 'fin', 1, fr), [sideL, sideR]));
  if (spec.canopy) root.add(buildCanopy(spec.canopy, fus, mats));
  if (spec.engine && spec.engine.type === 'radial') root.add(buildRadialFace(spec.engine, fus, mats));
  let prop = null;
  if (spec.prop) { prop = buildProp(spec.prop, mats); root.add(prop); }
  root.add(buildDetails(spec, fus, wingPF, mats));
  root.traverse((o) => { if (o.isMesh && o.material !== mats.glass && o.material !== mats.disc) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData = { prop, spec, livery: L, dispose: () => root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); } }) };
  return root;
}

/* ---------------------------------------------------------- stage / view */
export const VIEW_WT = { az: 58, el: 27, fov: 22 };   // camera: front-right, above
export function createStage(canvas, { alpha = true, preserve = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: preserve });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xfff4e6, 2.6); key.position.set(5, 14, -4); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 40 });
  scene.add(key); scene.add(key.target);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 1.0); rim.position.set(-10, 3, 8); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55); fill.position.set(8, 2, 10); scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1a1f26, 0.55));
  const camera = new THREE.PerspectiveCamera(VIEW_WT.fov, 1, 0.1, 200);
  return { renderer, scene, camera, key };
}
/* place camera at an azimuth/elevation (deg) around the model, fitted to its bounds */
export function frameModel(stage, model, view = VIEW_WT, aspect = 16 / 9, margin = 1.08) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const az = view.az * Math.PI / 180, el = view.el * Math.PI / 180;
  const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  const cam = stage.camera; cam.fov = view.fov; cam.aspect = aspect; cam.updateProjectionMatrix();
  // fit: project a sample of real vertices (box corners overestimate a cross-shaped aircraft)
  const pts = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh || !o.visible || o.material?.depthWrite === false) return;
    const pa = o.geometry.attributes.position; const step = Math.max(1, Math.floor(pa.count / 400));
    for (let i = 0; i < pa.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld));
  });
  let dist = box.getSize(new THREE.Vector3()).length();
  for (let it = 0; it < 40; it++) {
    cam.position.copy(center).addScaledVector(dir, dist); cam.lookAt(center); cam.updateMatrixWorld();
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    const v = new THREE.Vector3();
    for (const p of pts) { v.copy(p).project(cam); if (v.x < minx) minx = v.x; if (v.x > maxx) maxx = v.x; if (v.y < miny) miny = v.y; if (v.y > maxy) maxy = v.y; }
    const mx = (maxx - minx) / 2, my = (maxy - miny) / 2, cx = (maxx + minx) / 2, cy = (maxy + miny) / 2;
    const need = Math.max(mx, my) * margin;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const halfH = Math.tan(cam.fov * Math.PI / 360) * dist;
    center.addScaledVector(right, cx * halfH * cam.aspect).addScaledVector(up, cy * halfH);
    dist *= need;
    if (Math.abs(need - 1) < 0.003 && Math.abs(cx) < 0.002 && Math.abs(cy) < 0.002) break;
  }
  cam.position.copy(center).addScaledVector(dir, dist); cam.lookAt(center);
  stage.key.target.position.copy(center);
  return { center, dist };
}

/* Render a transparent PNG thumbnail (WT-style 3/4 overhead) */
let THUMB = null;
export async function renderThumbnail(spec, liveryId, { width = 960, height = 540, view = VIEW_WT } = {}) {
  if (!THUMB) { const c = document.createElement('canvas'); THUMB = createStage(c, { alpha: true, preserve: true }); THUMB.renderer.setPixelRatio(1); }
  await document.fonts?.ready;
  THUMB.renderer.setSize(width, height, false);
  const model = buildAircraft(spec, liveryId, THUMB.renderer);
  THUMB.scene.add(model);
  frameModel(THUMB, model, view, width / height, 1.04);
  THUMB.renderer.setClearColor(0x000000, 0);
  THUMB.renderer.render(THUMB.scene, THUMB.camera);
  const url = THUMB.renderer.domElement.toDataURL('image/png');
  THUMB.scene.remove(model); model.userData.dispose();
  return url;
}

/* ------------------------------------------------------ live inspection */
export const VIEWS = {
  wt:    { az: 58,  el: 27, fov: 22 },
  side:  { az: 90,  el: 4,  fov: 22 },
  top:   { az: 90,  el: 88, fov: 22 },
  front: { az: 8,   el: 10, fov: 22 },
  rear:  { az: 205, el: 22, fov: 22 }
};
export class InspectionViewer {
  constructor(container, { onFrame } = {}) {
    this.el = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'insp-canvas';
    container.appendChild(this.canvas);
    this.stage = createStage(this.canvas, { alpha: true });
    this.controls = new OrbitControls(this.stage.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.07, enablePan: false, rotateSpeed: 0.7, zoomSpeed: 0.8, autoRotateSpeed: 0.9 });
    this.controls.addEventListener('start', () => { this._userMoved = true; this._tween = null; });
    this.spin = false; this.blueprint = false; this.onFrame = onFrame;
    this.clock = new THREE.Clock();
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(container);
    this.resize();
    this._loop = this._loop.bind(this); this._raf = requestAnimationFrame(this._loop);
  }
  resize() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.stage.renderer.setSize(r.width, r.height, false);
    this.stage.camera.aspect = r.width / r.height; this.stage.camera.updateProjectionMatrix();
  }
  async load(spec, liveryId, { intro = true } = {}) {
    await document.fonts?.ready;
    const keepCam = this.model && this.spec && this.spec.id === spec.id;
    if (this.model) { this.stage.scene.remove(this.model); this.model.userData.dispose(); }
    this.spec = spec; this.liveryId = liveryId;
    this.model = buildAircraft(spec, liveryId, this.stage.renderer);
    this.stage.scene.add(this.model);
    if (this.blueprint) this._applyBlueprint(true);
    this._setSpinVisual();
    if (!keepCam) {
      const aspect = this.stage.camera.aspect;
      const { center, dist } = frameModel(this.stage, this.model, VIEWS.wt, aspect, 1.12);
      this.home = { center: center.clone(), dist };
      this.controls.target.copy(center);
      this.controls.minDistance = dist * 0.35; this.controls.maxDistance = dist * 2.2;
      if (intro) { // dolly-in fly-by
        const end = this.stage.camera.position.clone();
        const start = center.clone().add(end.clone().sub(center).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.9).multiplyScalar(1.9));
        this.stage.camera.position.copy(start);
        this._tween = { from: start, to: end, t0: performance.now(), dur: 1.6 };
      }
    }
    return this.model;
  }
  setView(name) {
    if (!this.model || !this.home) return;
    const v = VIEWS[name] || VIEWS.wt;
    const az = v.az * Math.PI / 180, el = v.el * Math.PI / 180;
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const to = this.home.center.clone().addScaledVector(dir, this.home.dist * (name === 'top' ? 1.05 : name === 'front' ? 0.82 : 1));
    this.controls.target.copy(this.home.center);
    this._tween = { from: this.stage.camera.position.clone(), to, t0: performance.now(), dur: 0.9, arc: true };
  }
  setSpin(on) { this.spin = on; this._setSpinVisual(); }
  _setSpinVisual() {
    const p = this.model && this.model.userData.prop;
    if (p) p.userData.disc.visible = this.spin;
    this.model && this.model.traverse((o) => { if (o.userData.glow) o.material.opacity = this.spin ? 0.85 : 0; });
  }
  setAutoRotate(on) { this.controls.autoRotate = on; }
  setBlueprint(on) { this.blueprint = on; if (this.model) this._applyBlueprint(on); }
  _applyBlueprint(on) {
    const bp = this._bpMat || (this._bpMat = new THREE.MeshBasicMaterial({ color: 0x041424, transparent: true, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    const line = this._lineMat || (this._lineMat = new THREE.LineBasicMaterial({ color: 0x38e1ff, transparent: true, opacity: 0.38, depthWrite: false }));
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        if (!o.userData.mat) o.userData.mat = o.material;
        o.material = Array.isArray(o.userData.mat) ? o.userData.mat.map(() => bp) : bp;
        if (!o.userData.edges && o.geometry.attributes.position.count < 120000) {
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 4), line); e.userData.isEdge = true; o.add(e); o.userData.edges = e;
        }
        if (o.userData.edges) o.userData.edges.visible = true;
      } else if (o.userData.mat) {
        o.material = o.userData.mat;
        if (o.userData.edges) o.userData.edges.visible = false;
      }
    });
  }
  snapshot() { this.stage.renderer.render(this.stage.scene, this.stage.camera); return this.canvas.toDataURL('image/png'); }
  _loop() {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this._tween) {
      const tw = this._tween; tw.t = Math.min(1, (performance.now() - tw.t0) / 1000 / tw.dur);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow(-2 * tw.t + 2, 3) / 2;
      const c = this.controls.target;
      if (tw.arc) { // spherical interpolation around the target
        const a = tw.from.clone().sub(c), b = tw.to.clone().sub(c);
        const la = a.length(), lb = b.length();
        const q = new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
        const qi = new THREE.Quaternion().slerp(q, e);
        this.stage.camera.position.copy(c).add(a.normalize().applyQuaternion(qi).multiplyScalar(lerp(la, lb, e)));
      } else this.stage.camera.position.lerpVectors(tw.from, tw.to, e);
      if (tw.t >= 1) this._tween = null;
    }
    const p = this.model && this.model.userData.prop;
    if (p && this.spin) p.userData.blades.rotation.x -= dt * 38;
    if (this.spin && this.model) this.model.traverse((o) => { if (o.userData.glow) o.material.opacity = 0.7 + Math.random() * 0.25; });
    this.controls.update();
    this.stage.renderer.render(this.stage.scene, this.stage.camera);
    if (this.onFrame) {
      const off = this.stage.camera.position.clone().sub(this.controls.target);
      const az = (Math.atan2(off.z, off.x) * 180 / Math.PI + 360) % 360, el = Math.asin(off.y / off.length()) * 180 / Math.PI;
      this.onFrame({ az, el, dist: off.length() });
    }
  }
  dispose() { cancelAnimationFrame(this._raf); this._ro.disconnect(); if (this.model) this.model.userData.dispose(); this.controls.dispose(); this.stage.renderer.dispose(); this.canvas.remove(); }
}

export { THREE };
