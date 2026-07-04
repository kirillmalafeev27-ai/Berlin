// facerig-core.js — direct JS port of the deformation math in facerig.py.
// Pure functions, no three.js dependency: everything works on plain arrays so
// the same code can run in a worker or in node for batch mode.
//
// The math is kept IDENTICAL to facerig.py (`_mouth_anchor`, `_jaw_delta`,
// `_build_cavity_and_tongue` placement) so Python and browser outputs match.
// The only extensions over the Python version:
//   - `mouth_offset_frac`  : optional anchor nudge (defaults to 0 = Python).
//   - region gate          : jaw weights fade to zero outside the head-region
//                            box (needed because uploads are full bodies, not
//                            isolated heads). With no region set, behaviour is
//                            exactly the Python one.

export const AXIS_IDX = { x: 0, y: 1, z: 2 };

export const DEFAULT_CFG = {
  front_axis: 'z',
  front_sign: 1,
  mouth_height_frac: 0.30,
  mouth_region_frac: 0.22,
  jaw_strength_frac: 0.16,
  jaw_forward: 0.15,
  mouth_offset_frac: [0, 0, 0],        // web extension, 0 = python-identical
  region_falloff_frac: 0.05,           // web extension: soft edge of head box
  lip_cut: true,                       // split verts along the mouth line (v0.5: on by default)
  lip_cut_width_frac: 0.45,            // full slit width, fraction of head lateral size
  // volumetric mouth (v0.4): densify + round the slit so it doesn't inherit
  // the low-poly angularity, and give the lip edge real thickness
  lip_subdiv: 3,                       // splits per seam edge (1 = off) — smooth opening arc
  lip_rim: true,                       // lip rolls + welded mouth pocket (v0.5: on by default)
  rim_depth: 0.12,                     // how far the rim goes back (frac of head depth)
  rim_segments: 2,                     // ring loops across the rim, 1..4
  bevel_width: 0.03,                   // rounded lip-edge thickness (frac of head height)
  bevel_segments: 2,                   // ring loops in the bevel arc, 0..3
  edge_smooth: 3,                      // Laplacian iterations on the rim path (tames Meshy edges)
  add_pucker: true,                    // web extension: also emit a mouthPucker morph
  pucker_strength: 0.55,               // lateral squeeze toward mouth center, 0..1
  pucker_forward_frac: 0.06,           // forward lip push of the pucker (frac of head h)
  cavity_scale: [0.32, 0.22, 0.30],
  cavity_depth_frac: 0.35,
  cavity_offset_frac: [0, 0, 0],       // web extension, 0 = python-identical
  cavity_rotation_deg: [0, 0, 0],      // web extension: ellipsoid orientation
  cavity_color: [0.02, 0.01, 0.01, 1.0],
  tongue_scale: [0.16, 0.05, 0.18],
  tongue_offset_frac: [0, 0, 0],       // web extension, 0 = python-identical
  tongue_rotation_deg: [0, 0, 0],      // web extension
  tongue_color: [0.55, 0.20, 0.22, 1.0],
};

const ARRAY_KEYS = ['mouth_offset_frac', 'cavity_offset_frac', 'tongue_offset_frac',
  'cavity_scale', 'tongue_scale', 'cavity_color', 'tongue_color',
  'cavity_rotation_deg', 'tongue_rotation_deg'];

export function mergeCfg(cfg) {
  const out = { ...DEFAULT_CFG, ...(cfg || {}) };
  for (const k of ARRAY_KEYS) out[k] = [...out[k]];
  return out;
}

// lateral (side-to-side) axis for a given front axis; vertical is always y
export function lateralAxis(fa) { return fa === 0 ? 2 : 0; }

// Port of facerig._mouth_anchor. bounds = {lo:[3], hi:[3]} of the HEAD region.
export function mouthAnchor(bounds, cfg) {
  const lo = bounds.lo, hi = bounds.hi;
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const fa = AXIS_IDX[cfg.front_axis];
  const sign = cfg.front_sign;

  const mouth = [...center];
  mouth[1] = lo[1] + cfg.mouth_height_frac * size[1];
  mouth[fa] = center[fa] + sign * (size[fa] / 2);
  for (let i = 0; i < 3; i++) mouth[i] += cfg.mouth_offset_frac[i] * size[i];
  return { mouth, size, fa, sign };
}

// Port of facerig._jaw_delta.
// positions : Float32Array(N*3) in the head mesh's local space.
// region    : optional {lo:[3], hi:[3]} box — weights fade out beyond it.
// opts      : { lowerMask?: Uint8Array, hardBelow?: bool } — lip-cut mode:
//             inside the slit zone the below-the-line gate becomes a hard step
//             (the whole lower lip moves with the jaw), and lowerMask marks
//             duplicated lower-lip verts that sit at/above the line but must
//             still move fully. With opts omitted, math is python-identical.
// Returns { delta: Float32Array(N*3), driven, maxOffset }.
export function jawDelta(positions, anchor, cfg, region, opts = {}) {
  const { mouth, size, fa, sign } = anchor;
  const n = positions.length / 3;
  const delta = new Float32Array(positions.length);

  const sigma = cfg.mouth_region_frac * size[1];
  const strength = cfg.jaw_strength_frac * size[1];
  const inv2s2 = 1 / (2 * sigma * sigma);
  const halfFront = 0.5 * size[fa];
  const belowScale = 0.25 * size[1];
  const margin = Math.max(1e-9, cfg.region_falloff_frac * size[1]);
  const lat = lateralAxis(fa);
  const latHalfWidth = 0.5 * cfg.lip_cut_width_frac * size[lat];
  const { lowerMask = null, hardBelow = false } = opts;

  let driven = 0, maxOffset = 0;
  for (let i = 0; i < n; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    const p = [px, py, pz];

    // gaussian influence around the mouth anchor (x,y plane — same as python)
    const dx = px - mouth[0], dy = py - mouth[1];
    const w = Math.exp(-(dx * dx + dy * dy) * inv2s2);

    // front-hemisphere gate
    const frontCoord = sign * (p[fa] - mouth[fa] + sign * halfFront);
    const frontGate = Math.min(1, Math.max(0, frontCoord / halfFront));

    // only below the mouth line drops
    let below = Math.min(1, Math.max(0, (mouth[1] - py) / belowScale));
    // Hard gate for the cut mouth: verts clearly below the line move rigidly.
    // Verts AT the line (knife/seam verts sit on it up to float error) take
    // their side from the lowerMask alone — a bare `py < mouth` test fires on
    // upper seam copies that land an ulp below the line, both sides move
    // together, and the slit never separates.
    const eps = 1e-3 * size[1];
    if (hardBelow && frontGate > 0.65 &&
        Math.abs(p[lat] - mouth[lat]) < latHalfWidth &&
        (py < mouth[1] - eps || (lowerMask && lowerMask[i]))) {
      below = 1; // the freed lower lip moves rigidly with the jaw
    }

    let amount = w * frontGate * below;

    // web extension: fade to zero outside the head-region box
    if (region && amount > 0) {
      let d = 0;
      for (let a = 0; a < 3; a++) {
        const out = Math.max(region.lo[a] - p[a], p[a] - region.hi[a], 0);
        d = Math.max(d, out);
      }
      amount *= Math.min(1, Math.max(0, 1 - d / margin));
    }

    if (amount > 1e-4) driven++;
    const dyOut = -amount * strength;
    delta[i * 3 + 1] = dyOut;
    delta[i * 3 + fa] += sign * amount * strength * cfg.jaw_forward;
    const off = Math.hypot(delta[i * 3], delta[i * 3 + 1], delta[i * 3 + 2]);
    if (off > maxOffset) maxOffset = off;
  }
  return { delta, driven, maxOffset };
}

// -----------------------------------------------------------------------------
// lip cut — the "real mouth opening". Splits the sealed shell along the mouth
// line so jawOpen reveals the cavity instead of stretching skin.
//
// Every triangle in the slit zone (lateral window around the anchor, front
// hemisphere, inside the head region) is classified upper/lower by centroid.
// A vertex used by both sides — and by nothing outside the zone — is
// duplicated; lower-side triangles are re-pointed at the copy. Positions stay
// identical, so the closed mouth looks unchanged; when the jaw drops, the two
// sides separate and a real hole opens. Vertices used by out-of-zone triangles
// are never split, which seals the slit at the mouth corners automatically.
//
// Unwelded meshes (flat-shaded low-poly: vertices duplicated per face) need no
// actual split — upper/lower triangles already own separate coincident verts.
// There the job is only the lowerMask: lower-side verts move fully with the
// jaw while their coincident upper twins stay, and the slit opens by itself.
//
// positions: Float32Array(N*3), indices: integer array (any typed/plain).
// Returns null when there is no lower side in the zone, else:
//   { indices: Uint32Array, dupSources: Uint32Array,  // src vertex per new vert
//     lowerMask: Uint8Array(newCount), addedCount }
export function cutLips(positions, indices, anchor, cfg, region) {
  const { mouth, size, fa, sign } = anchor;
  const lat = lateralAxis(fa);
  const halfW = 0.5 * cfg.lip_cut_width_frac * size[lat];
  const halfFront = 0.5 * size[fa];
  const n = positions.length / 3;
  const triCount = (indices.length / 3) | 0;

  const P = (i, a) => positions[i * 3 + a];
  const inRegion = (i) => !region ||
    (P(i,0) >= region.lo[0] && P(i,0) <= region.hi[0] &&
     P(i,1) >= region.lo[1] && P(i,1) <= region.hi[1] &&
     P(i,2) >= region.lo[2] && P(i,2) <= region.hi[2]);

  // classify triangles: 0 = out of zone, 1 = zone-upper, 2 = zone-lower
  const triSide = new Uint8Array(triCount);
  const USED_LOW = 1, USED_UP = 2, USED_OUT = 4;
  const usage = new Uint8Array(n);
  let lowTris = 0;
  for (let t = 0; t < triCount; t++) {
    const a = indices[t*3], b = indices[t*3+1], c = indices[t*3+2];
    const cy = (P(a,1) + P(b,1) + P(c,1)) / 3;
    // vertex-based zone gates: low-poly triangles are huge, and knife-cut
    // remnants keep far-away corners — a triangle is "in the zone" if it
    // TOUCHES the slit window with any vertex and has a front-facing part.
    // (Centroid gating here used to veto the seam split via USED_OUT.)
    let minLat = Infinity, maxGate = -Infinity;
    for (const v of [a, b, c]) {
      minLat = Math.min(minLat, Math.abs(P(v,lat) - mouth[lat]));
      maxGate = Math.max(maxGate, sign * (P(v,fa) - mouth[fa] + sign * halfFront) / halfFront);
    }
    const inZone = minLat < halfW && maxGate > 0.65 &&
                   inRegion(a) && inRegion(b) && inRegion(c);
    triSide[t] = inZone ? (cy < mouth[1] ? 2 : 1) : 0;
    if (triSide[t] === 2) lowTris++;
    const bit = inZone ? (cy < mouth[1] ? USED_LOW : USED_UP) : USED_OUT;
    usage[a] |= bit; usage[b] |= bit; usage[c] |= bit;
  }
  if (!lowTris) return null;

  // vertices to split: on the seam (used by both sides), interior to the zone.
  // On unwelded (flat-shaded) meshes this list is empty — nothing shares verts.
  const dupOf = new Int32Array(n).fill(-1);
  const dupSources = [];
  for (let v = 0; v < n; v++) {
    if ((usage[v] & USED_LOW) && (usage[v] & USED_UP) && !(usage[v] & USED_OUT)) {
      dupOf[v] = n + dupSources.length;
      dupSources.push(v);
    }
  }

  const newCount = n + dupSources.length;
  const out = new Uint32Array(indices.length);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t*3+k];
      out[t*3+k] = (triSide[t] === 2 && dupOf[v] >= 0) ? dupOf[v] : v;
    }
  }

  // lower-lip mask: duplicated copies + verts used exclusively by the lower side
  const lowerMask = new Uint8Array(newCount);
  for (let v = 0; v < n; v++) {
    if ((usage[v] & USED_LOW) && !(usage[v] & (USED_UP | USED_OUT))) lowerMask[v] = 1;
  }
  for (let k = 0; k < dupSources.length; k++) lowerMask[n + k] = 1;

  return { indices: out, dupSources: Uint32Array.from(dupSources), lowerMask,
           addedCount: dupSources.length };
}

// Duplicate the tail of any per-vertex attribute array to match a cut.
// itemSize = components per vertex. Works for positions, normals, uvs,
// joints/weights, existing morph deltas — anything.
export function dupAttribute(src, itemSize, dupSources) {
  const n = src.length / itemSize;
  const out = new src.constructor((n + dupSources.length) * itemSize);
  out.set(src);
  for (let k = 0; k < dupSources.length; k++) {
    for (let c = 0; c < itemSize; c++) {
      out[(n + k) * itemSize + c] = src[dupSources[k] * itemSize + c];
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// volumetric mouth (v0.4)
//
// Three cooperating passes turn the paper-thin low-poly slit into a mouth:
//   1. subdivideSeam  — split every seam edge into `lip_subdiv` segments. New
//      verts lie exactly on the old edges (rest pose unchanged, bit-for-bit),
//      but the jaw gaussian now gets sampled densely along the lip line, so
//      the opening becomes a smooth arc instead of a low-poly zigzag.
//   2. cutLips        — unchanged (runs on the densified arrays).
//   3. buildMouthVolume — extrude a bevel + inner rim strip backward from each
//      side of the slit along a Laplacian-smoothed path (thick, rounded lip
//      edges), and close the inside with a "pocket" whose opening ring reuses
//      the rim's weld-ring data verbatim: identical positions, identical morph
//      deltas, skinning copied from the same source verts — a real weld, no
//      gap at any jawOpen value.
//
// Every generated vertex carries provenance {a, b, t}: it is a blend of source
// verts a and b (b = -1 → pure copy of a). Attribute extension (UVs, normals,
// JOINTS/WEIGHTS, pre-existing morph targets) and jaw/pucker deltas all flow
// through provenance, so nothing new is ever left unskinned or morphless.

// "Coincident" duplicate verts on AI-exported meshes are NOT bit-identical —
// on this project's characters mirrored copies drift by ~1e-4 of head height.
// All seam matching therefore runs with a spatial tolerance, and canonical
// edge direction is chosen by a tolerance-stable axis comparison.
function seamTolerance(anchor) { return 5e-4 * anchor.size[1]; }

function closePts(p, q, tol) {
  return Math.abs(p[0]-q[0]) < tol && Math.abs(p[1]-q[1]) < tol && Math.abs(p[2]-q[2]) < tol;
}

// canonical edge direction: dominant-axis comparison with tolerance, so both
// near-coincident copies of an edge pick the same order
export function canonicalOrder(pa, pb, tol) {
  for (const c of [0, 1, 2]) {
    if (Math.abs(pa[c] - pb[c]) > tol) return pa[c] < pb[c];
  }
  return true;
}

// shared zone/side classification: seam edges are edges whose two coincident
// copies belong to an upper-side and a lower-side triangle. The zone gate is
// evaluated on the EDGE MIDPOINT (not the triangle centroid): low-poly
// triangles are huge, and after seam subdivision the fan triangles' centroids
// land far from the lip line even though their seam edges sit right on it.
// The side (upper/lower) still comes from the owning triangle's centroid.
// Returns an array of matched records:
//   { up: [u,v], low: [l1,l2], upTri, lowTri, a: [xyz], b: [xyz] }
// with `a`/`b` endpoint positions ordered like the `up` pair.
function classifySeamEdges(positions, indices, anchor, cfg, region) {
  const { mouth, size, fa, sign } = anchor;
  const lat = lateralAxis(fa);
  const halfW = 0.5 * cfg.lip_cut_width_frac * size[lat];
  const halfFront = 0.5 * size[fa];
  const tol = seamTolerance(anchor);
  const triCount = (indices.length / 3) | 0;
  const P = (i, a) => positions[i * 3 + a];
  const pnt = (i) => [P(i,0), P(i,1), P(i,2)];
  const inRegion = (i) => !region ||
    (P(i,0) >= region.lo[0] && P(i,0) <= region.hi[0] &&
     P(i,1) >= region.lo[1] && P(i,1) <= region.hi[1] &&
     P(i,2) >= region.lo[2] && P(i,2) <= region.hi[2]);

  // collect gated candidate edges, then cluster by midpoint+endpoints with
  // tolerance (counts are tiny — tens of edges — linear matching is fine)
  const clusters = [];
  for (let t = 0; t < triCount; t++) {
    const a = indices[t*3], b = indices[t*3+1], c = indices[t*3+2];
    const cy = (P(a,1) + P(b,1) + P(c,1)) / 3;
    const side = cy < mouth[1] ? 'low' : 'up';
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ml = (P(u,lat) + P(v,lat)) / 2;
      const mf = (P(u,fa) + P(v,fa)) / 2;
      const frontGate = sign * (mf - mouth[fa] + sign * halfFront) / halfFront;
      if (Math.abs(ml - mouth[lat]) >= halfW || frontGate <= 0.65 ||
          !inRegion(u) || !inRegion(v)) continue;
      const pu = pnt(u), pv = pnt(v);
      const mid = [(pu[0]+pv[0])/2, (pu[1]+pv[1])/2, (pu[2]+pv[2])/2];
      let cl = null;
      for (const c2 of clusters) {
        if (!closePts(mid, c2.mid, tol)) continue;
        if ((closePts(pu, c2.a, tol) && closePts(pv, c2.b, tol)) ||
            (closePts(pu, c2.b, tol) && closePts(pv, c2.a, tol))) { cl = c2; break; }
      }
      if (!cl) {
        cl = { mid, a: pu, b: pv, up: null, low: null, upTri: -1, lowTri: -1 };
        clusters.push(cl);
      }
      if (!cl[side]) {
        // store the pair ordered to match cluster endpoints a→b
        const straight = closePts(pu, cl.a, tol);
        cl[side] = straight ? [u, v] : [v, u];
        cl[side === 'up' ? 'upTri' : 'lowTri'] = t;
      }
    }
  }
  return clusters.filter((c) => c.up && c.low);
}

// Pass 0: knife cut. Stylized low-poly faces often paint the mouth onto 2-4
// giant triangles — there ARE no edges along the lip line to split or open
// (on this project's characters the up/low triangle boundary touches the
// mouth window at just two edges near the corners). The knife slices every
// triangle that straddles the mouth plane inside the slit window, creating a
// dense straight seam right through triangle interiors. Decisions are made
// PER EDGE (not per triangle) so both owners of an edge always agree —
// no T-junctions, no cracks.
export function knifeSeam(positions, indices, anchor, cfg, region) {
  const { mouth, size, fa, sign } = anchor;
  const lat = lateralAxis(fa);
  const halfW = 0.5 * cfg.lip_cut_width_frac * size[lat];
  const halfFront = 0.5 * size[fa];
  const line = mouth[1];
  const n = positions.length / 3;
  const P = (i, a) => positions[i * 3 + a];
  const inRegion = (p) => !region ||
    (p[0] >= region.lo[0] && p[0] <= region.hi[0] &&
     p[1] >= region.lo[1] && p[1] <= region.hi[1] &&
     p[2] >= region.lo[2] && p[2] <= region.hi[2]);

  // decide cut edges once, keyed by sorted index pair; coincident copies of an
  // edge (unwelded meshes) compute t in canonical posKey order → identical bits
  const prov = [];
  const newPos = [];
  const cutOfEdge = new Map(); // "a_b" (sorted indices) → new vertex index | -1
  const tol = seamTolerance(anchor);
  const cutPoint = (u, v) => {
    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    if (cutOfEdge.has(key)) return cutOfEdge.get(key);
    let result = -1;
    // canonical direction must be tolerance-stable so both near-coincident
    // copies of an edge produce their knife point from the same end
    const pu = [P(u,0), P(u,1), P(u,2)], pv = [P(v,0), P(v,1), P(v,2)];
    const [a, b] = canonicalOrder(pu, pv, tol) ? [u, v] : [v, u];
    const ya = P(a,1), yb = P(b,1);
    if ((ya - line) * (yb - line) < 0) {
      const t = (line - ya) / (yb - ya);
      if (t > 1e-4 && t < 1 - 1e-4) {
        const p = [0, 0, 0];
        for (let c = 0; c < 3; c++) p[c] = P(a,c) + (P(b,c) - P(a,c)) * t;
        const fg = sign * (p[fa] - mouth[fa] + sign * halfFront) / halfFront;
        if (Math.abs(p[lat] - mouth[lat]) < halfW * 1.25 && fg > 0.65 && inRegion(p)) {
          result = n + prov.length;
          prov.push({ a, b, t });
          newPos.push(...p);
        }
      }
    }
    cutOfEdge.set(key, result);
    return result;
  };

  const out = [];
  const triCount = (indices.length / 3) | 0;
  let cuts = 0;
  for (let t = 0; t < triCount; t++) {
    const V = [indices[t*3], indices[t*3+1], indices[t*3+2]];
    const cp = [cutPoint(V[0], V[1]), cutPoint(V[1], V[2]), cutPoint(V[2], V[0])];
    const nCut = cp.filter((c) => c >= 0).length;
    if (nCut === 0) {
      out.push(...V);
      continue;
    }
    cuts++;
    if (nCut === 2) {
      // apex = vertex shared by the two cut edges; rotate so edges are (A,B),(C,A)
      let r = 0;
      if (cp[0] >= 0 && cp[1] >= 0) r = 1;       // apex B
      else if (cp[1] >= 0 && cp[2] >= 0) r = 2;  // apex C
      const A = V[r], B = V[(r+1)%3], C = V[(r+2)%3];
      const Pp = cp[r], Q = cp[(r+2)%3];
      out.push(A, Pp, Q,  Pp, B, C,  Pp, C, Q);
    } else {
      // single qualified crossing: split through the opposite vertex
      const e = cp.findIndex((c) => c >= 0);
      const A = V[e], B = V[(e+1)%3], C = V[(e+2)%3];
      out.push(A, cp[e], C,  cp[e], B, C);
    }
  }
  if (!prov.length) return null;
  return {
    positions: concatF32(positions, newPos),
    indices: Uint32Array.from(out),
    prov,
    cutTris: cuts,
  };
}

// Pass 1: densify the lip line. Each seam edge is split into `lip_subdiv`
// segments on BOTH of its coincident copies with bit-identical positions
// (same lerp of coincident endpoints), so the shell stays sealed at rest.
// Owning triangles are fan-retriangulated. Returns null when nothing to do.
export function subdivideSeam(positions, indices, anchor, cfg, region) {
  const segs = Math.max(1, Math.round(cfg.lip_subdiv));
  if (segs < 2) return null;
  const seam = classifySeamEdges(positions, indices, anchor, cfg, region);
  if (!seam.length) return null;

  const n = positions.length / 3;
  const tol = seamTolerance(anchor);
  const prov = [];              // {a, b, t} per new vertex
  const newPos = [];
  // per triangle: list of split edges → midpoints (vertex indices, ordered a→b)
  const triSplits = new Map();  // tri → [{a, b, mids:[...]}]
  const addSplits = (tri, a0, b0) => {
    // canonical direction (tolerance-stable): the upper and lower coincident
    // copies of a seam edge must lerp in the same order, or their split
    // point sequences run opposite ways and the shell unseals at rest
    const pa = [positions[a0*3], positions[a0*3+1], positions[a0*3+2]];
    const pb = [positions[b0*3], positions[b0*3+1], positions[b0*3+2]];
    const [a, b] = canonicalOrder(pa, pb, tol) ? [a0, b0] : [b0, a0];
    const mids = [];
    for (let s = 1; s < segs; s++) {
      const t = s / segs;
      const vi = n + prov.length;
      prov.push({ a, b, t });
      for (let c = 0; c < 3; c++) {
        // lerp written as a+(b-a)*t so coincident copies produce identical bits
        newPos.push(positions[a*3+c] + (positions[b*3+c] - positions[a*3+c]) * t);
      }
      mids.push(vi);
    }
    if (!triSplits.has(tri)) triSplits.set(tri, []);
    triSplits.get(tri).push({ a, b, mids });
    return mids;
  };
  for (const rec of seam) {
    addSplits(rec.upTri, rec.up[0], rec.up[1]);
    addSplits(rec.lowTri, rec.low[0], rec.low[1]);
  }

  // rebuild indices: untouched tris pass through, split tris become fans over
  // their subdivided boundary polygon (fan corner = a vertex of an unsplit edge
  // when possible; degenerate slivers from collinear points are harmless)
  const out = [];
  const triCount = (indices.length / 3) | 0;
  for (let t = 0; t < triCount; t++) {
    const splits = triSplits.get(t);
    if (!splits) {
      out.push(indices[t*3], indices[t*3+1], indices[t*3+2]);
      continue;
    }
    const tri = [indices[t*3], indices[t*3+1], indices[t*3+2]];
    const bySortedPair = new Map();
    for (const s of splits) {
      bySortedPair.set(s.a < s.b ? `${s.a}_${s.b}` : `${s.b}_${s.a}`, s);
    }
    // boundary polygon in original winding order
    const poly = [];
    const splitEdgeFlags = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      poly.push(a);
      const s = bySortedPair.get(a < b ? `${a}_${b}` : `${b}_${a}`);
      splitEdgeFlags.push(!!s);
      if (s) {
        const mids = s.a === a ? s.mids : [...s.mids].reverse();
        poly.push(...mids);
      }
    }
    // pick fan corner on an unsplit edge boundary to minimize slivers
    let corner = 0;
    for (let e = 0; e < 3; e++) {
      if (!splitEdgeFlags[e] && !splitEdgeFlags[(e + 2) % 3]) {
        corner = poly.indexOf(tri[e]);
        break;
      }
    }
    const L = poly.length;
    for (let i = 1; i < L - 1; i++) {
      const p1 = poly[(corner + i) % L], p2 = poly[(corner + i + 1) % L];
      out.push(poly[corner], p1, p2);
    }
  }

  return {
    positions: concatF32(positions, newPos),
    indices: Uint32Array.from(out),
    prov,
  };
}

// Ordered boundary of the mouth slit, corner to corner. Runs on post-cut
// arrays; each point knows its upper-side and lower-side vertex index.
export function extractMouthSeam(positions, indices, anchor, cfg, region) {
  const seam = classifySeamEdges(positions, indices, anchor, cfg, region);
  if (!seam.length) return null;
  const tol = seamTolerance(anchor);

  // endpoint clustering with tolerance (near-coincident copies drift ~1e-4)
  const pts = []; // { pos, upperV, lowerV, adj: Set<index> }
  const findPt = (p) => {
    for (let i = 0; i < pts.length; i++) {
      if (closePts(pts[i].pos, p, tol)) return i;
    }
    pts.push({ pos: [...p], upperV: -1, lowerV: -1, adj: new Set() });
    return pts.length - 1;
  };
  for (const rec of seam) {
    const ia = findPt(rec.a), ib = findPt(rec.b);
    // up/low pairs were stored ordered to match rec.a → rec.b
    pts[ia].upperV = rec.up[0]; pts[ib].upperV = rec.up[1];
    pts[ia].lowerV = rec.low[0]; pts[ib].lowerV = rec.low[1];
    pts[ia].adj.add(ib);
    pts[ib].adj.add(ia);
  }
  // The seam graph can branch (knife line meeting natural up/low boundary
  // edges) or split into components. Walk greedily from every degree-1 point,
  // preferring the straightest continuation at branches; keep the longest path.
  const walk = (startIdx) => {
    const path = [];
    const seen = new Set();
    let cur = startIdx, dir = null;
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const p = pts[cur];
      path.push(p);
      let best = null, bestDot = -Infinity;
      for (const a of p.adj) {
        if (seen.has(a)) continue;
        const q = pts[a].pos;
        const d = [q[0]-p.pos[0], q[1]-p.pos[1], q[2]-p.pos[2]];
        const l = Math.hypot(...d) || 1;
        const dot = dir ? (d[0]*dir[0] + d[1]*dir[1] + d[2]*dir[2]) / l : 0;
        if (dot > bestDot) { bestDot = dot; best = a; }
      }
      if (best != null) {
        const q = pts[best].pos;
        const d = [q[0]-p.pos[0], q[1]-p.pos[1], q[2]-p.pos[2]];
        const l = Math.hypot(...d) || 1;
        dir = [d[0]/l, d[1]/l, d[2]/l];
      }
      cur = best;
    }
    return path;
  };
  const starts = pts.map((p, i) => [p, i]).filter(([p]) => p.adj.size === 1).map(([, i]) => i);
  if (!starts.length) starts.push(0);
  let ordered = [];
  for (const s of starts) {
    const path = walk(s);
    if (path.length > ordered.length) ordered = path;
  }
  if (ordered.length < 4) return null;
  for (const p of ordered) {
    if (p.upperV < 0) p.upperV = p.lowerV;
    if (p.lowerV < 0) p.lowerV = p.upperV;
  }
  return { points: ordered };
}

// Pass 3: bevel + inner rim strips from both sides of the slit, plus the
// welded pocket. Rings follow a Laplacian-smoothed copy of the seam path so
// jagged Meshy edges come out rounded. Offsets fade to zero at the mouth
// corners (rings collapse onto the corner verts → watertight ends).
//
// Returns {
//   verts: [{ src, pos:[3], scale }],   // src = post-cut vertex index
//   tris:  Uint32Array,                 // indices into post-cut + new verts
//   pocket: { verts: [{src, pos, scale}], tris: Uint32Array },
// } or null when no seam.
export function buildMouthVolume(positions, indices, anchor, cfg, region) {
  const seamData = extractMouthSeam(positions, indices, anchor, cfg, region);
  if (!seamData) return null;
  const pts = seamData.points;
  const m = pts.length - 1;
  const { mouth, size, fa, sign } = anchor;

  // smoothed extrusion path (endpoints pinned)
  const S = pts.map((p) => [...p.pos]);
  for (let it = 0; it < Math.round(cfg.edge_smooth); it++) {
    for (let i = 1; i < m; i++) {
      for (let c = 0; c < 3; c++) {
        S[i][c] = 0.5 * S[i][c] + 0.25 * (S[i-1][c] + S[i+1][c]);
      }
    }
  }

  const B = Math.max(0, Math.round(cfg.bevel_segments));
  const R = Math.max(1, Math.round(cfg.rim_segments));
  const bevelW = B > 0 ? cfg.bevel_width * size[1] : 0;
  const rimD = cfg.rim_depth * size[fa];
  const front = [0, 0, 0]; front[fa] = sign;
  const cornerW = (i) => Math.pow(Math.sin(Math.PI * i / m), 0.7);

  const nBase = positions.length / 3;
  const verts = [];   // head-primitive strip verts { src, pos, scale }
  const tris = [];
  const vPos = (vi) => vi < nBase
    ? [positions[vi*3], positions[vi*3+1], positions[vi*3+2]]
    : verts[vi - nBase].pos;

  // BEVEL strip only lives in the (textured) head primitive: a ~lip-thick
  // rounded edge that keeps the skin texture. Everything deeper — the rim
  // walls and the pocket — is dark, so the stretched face texture never
  // smears into the mouth interior. Bevel verts move rigidly with their lip
  // (scale 1): the lip edge stays crisp at any jawOpen.
  const buildBevel = (sideKey, vertSign) => {
    const rings = [pts.map((p) => p[sideKey])];
    for (let k = 1; k <= B; k++) {
      const bp = k / B;
      const back = bevelW * Math.sin(bp * Math.PI / 2);
      const vert = vertSign * bevelW * (1 - Math.cos(bp * Math.PI / 2));
      const ring = [];
      for (let i = 0; i <= m; i++) {
        const w = cornerW(i);
        const pos = [S[i][0], S[i][1], S[i][2]];
        pos[1] += vert * w;
        pos[fa] -= sign * back * w;
        const vi = nBase + verts.length;
        verts.push({ src: pts[i][sideKey], pos, scale: 1 });
        ring.push(vi);
      }
      rings.push(ring);
    }
    // quads; winding faces the opening (down-front for upper, up-front for lower)
    const want = [front[0], front[1] - vertSign * 0.6, front[2]];
    let flip = null;
    for (let k = 1; k <= B; k++) {
      for (let i = 0; i < m; i++) {
        const a = rings[k-1][i], b = rings[k-1][i+1], c = rings[k][i+1], d = rings[k][i];
        if (flip === null) {
          const nrm = triNormal(vPos(a), vPos(b), vPos(c));
          if (nrm) flip = (nrm[0]*want[0] + nrm[1]*want[1] + nrm[2]*want[2]) < 0;
        }
        if (flip) tris.push(a, c, b, a, d, c);
        else tris.push(a, b, c, a, c, d);
      }
    }
    return rings[rings.length - 1]; // weld ring (ring0 itself when B = 0)
  };

  const upperWeld = buildBevel('upperV', +1);
  const lowerWeld = buildBevel('lowerV', -1);

  // POCKET (dark primitive): starts at a closed loop that reuses the bevel
  // weld-ring records verbatim — identical positions, sources and delta
  // scales, so the weld is exact at any jawOpen. The loop is extruded
  // backward (rim walls, delta fading 1 → 0.55) and then converges to a
  // rounded cap (0.55 → 0).
  const weldRec = (vi) => vi < nBase
    ? { src: vi, pos: vPos(vi), scale: 1 }
    : verts[vi - nBase];
  const loop = [];        // { rec, vertSign, w }
  for (let i = 0; i <= m; i++) loop.push({ rec: weldRec(upperWeld[i]), vs: +1, w: cornerW(i) });
  for (let i = m - 1; i >= 1; i--) loop.push({ rec: weldRec(lowerWeld[i]), vs: -1, w: cornerW(i) });
  const L = loop.length;

  const pocketVerts = loop.map(({ rec }) => ({ src: rec.src, pos: [...rec.pos], scale: rec.scale }));
  const pocketTris = [];

  // rim walls: straight back, keeping the bevel's vertical separation.
  // delta scale = lerp(1, 0.55, t), eased back to 1 at the corners (w → 0)
  // where the rings collapse onto the corner verts.
  for (let j = 1; j <= R; j++) {
    const t = j / R;
    for (const { rec, w } of loop) {
      const pos = [...rec.pos];
      pos[fa] -= sign * rimD * t * w;
      pocketVerts.push({ src: rec.src, pos, scale: 1 - 0.45 * t * w });
    }
  }

  // converge to the cap
  const center = [...mouth];
  center[fa] -= sign * (rimD + cfg.cavity_depth_frac * size[fa] * 0.6);
  center[1] = loop.reduce((s, { rec }) => s + rec.pos[1], 0) / L;
  const PJ = 3;
  const rimBase = R * L; // offset of the last rim ring within pocketVerts
  for (let j = 1; j <= PJ; j++) {
    const a = j / PJ;
    const ease = a * a * (3 - 2 * a);
    for (let i = 0; i < L; i++) {
      const r = pocketVerts[rimBase + i];
      pocketVerts.push({
        src: r.src,
        pos: [
          r.pos[0] + (center[0] - r.pos[0]) * ease,
          r.pos[1] + (center[1] - r.pos[1]) * ease,
          r.pos[2] + (center[2] - r.pos[2]) * ease,
        ],
        scale: r.scale * (1 - ease),
      });
    }
  }
  const capIdx = pocketVerts.length;
  pocketVerts.push({ src: loop[0].rec.src, pos: [...center], scale: 0 });

  // tube + cap, winding so the interior faces the opening (toward +front)
  const rings = R + PJ;
  let flip = null;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < L; i++) {
      const i2 = (i + 1) % L;
      const a = j*L + i, b = j*L + i2, c = (j+1)*L + i2, d = (j+1)*L + i;
      if (flip === null) {
        const nrm = triNormal(pocketVerts[a].pos, pocketVerts[b].pos, pocketVerts[c].pos);
        if (nrm) flip = (nrm[0]*front[0] + nrm[1]*front[1] + nrm[2]*front[2]) < 0;
      }
      if (flip) pocketTris.push(a, c, b, a, d, c);
      else pocketTris.push(a, b, c, a, c, d);
    }
  }
  for (let i = 0; i < L; i++) {
    const i2 = (i + 1) % L;
    if (flip) pocketTris.push(rings*L + i, rings*L + i2, capIdx);
    else pocketTris.push(rings*L + i2, rings*L + i, capIdx);
  }

  return {
    verts,
    tris: Uint32Array.from(tris),
    pocket: { verts: pocketVerts, tris: Uint32Array.from(pocketTris) },
  };
}

function triNormal(p, q, r) {
  const u = [q[0]-p[0], q[1]-p[1], q[2]-p[2]];
  const v = [r[0]-p[0], r[1]-p[1], r[2]-p[2]];
  const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  const l = Math.hypot(n[0], n[1], n[2]);
  return l > 1e-12 ? [n[0]/l, n[1]/l, n[2]/l] : null;
}

function concatF32(a, extra) {
  const out = new Float32Array(a.length + extra.length);
  out.set(a);
  out.set(extra, a.length);
  return out;
}

// Extend a per-vertex attribute array through provenance records. Each record
// is a weighted list of ORIGINAL source verts [[index, weight], ...] (weights
// sum to 1) — chains like knife → subdiv → rim flatten into one such list.
// mode 'lerp'    — weighted blend (UVs, normals, colors, morph deltas)
// mode 'nearest' — copy from the heaviest source (JOINTS/WEIGHTS: never blend
//                  bone indices; weights follow their joint set)
export function extendAttributeData(src, itemSize, prov, mode = 'lerp') {
  const n = src.length / itemSize;
  const out = new src.constructor((n + prov.length) * itemSize);
  out.set(src);
  for (let k = 0; k < prov.length; k++) {
    const refs = prov[k];
    const o = (n + k) * itemSize;
    if (mode === 'nearest' || refs.length === 1) {
      let best = refs[0];
      for (const r of refs) if (r[1] > best[1]) best = r;
      for (let c = 0; c < itemSize; c++) out[o + c] = src[best[0] * itemSize + c];
    } else {
      const acc = new Array(itemSize).fill(0);
      for (const [i, w] of refs) {
        for (let c = 0; c < itemSize; c++) acc[c] += src[i * itemSize + c] * w;
      }
      for (let c = 0; c < itemSize; c++) out[o + c] = acc[c];
    }
  }
  return out;
}

// merge two provenance lists with lerp factor t (result references originals)
export function blendProv(pa, pb, t) {
  const acc = new Map();
  for (const [i, w] of pa) acc.set(i, (acc.get(i) || 0) + w * (1 - t));
  for (const [i, w] of pb) acc.set(i, (acc.get(i) || 0) + w * t);
  return [...acc.entries()];
}

// Area-weighted smooth normals for the verts in [from, to) using only the
// given triangles (existing verts keep their original normals). Verts whose
// incident triangles are all degenerate (collapsed corner rings) get the
// fallback direction — they are invisible anyway, but must stay unit-length.
export function computeNormalsFor(positions, tris, from, to, fallback = [0, 0, 1]) {
  const acc = new Float32Array((to - from) * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t+1], tris[t+2]];
    const p = (i) => [positions[i*3], positions[i*3+1], positions[i*3+2]];
    const pa = p(a), pb = p(b), pc = p(c);
    const u = [pb[0]-pa[0], pb[1]-pa[1], pb[2]-pa[2]];
    const v = [pc[0]-pa[0], pc[1]-pa[1], pc[2]-pa[2]];
    const nx = u[1]*v[2]-u[2]*v[1], ny = u[2]*v[0]-u[0]*v[2], nz = u[0]*v[1]-u[1]*v[0];
    for (const i of [a, b, c]) {
      if (i >= from && i < to) {
        acc[(i-from)*3] += nx; acc[(i-from)*3+1] += ny; acc[(i-from)*3+2] += nz;
      }
    }
  }
  for (let i = 0; i < acc.length; i += 3) {
    const l = Math.hypot(acc[i], acc[i+1], acc[i+2]);
    if (l < 1e-12) {
      acc[i] = fallback[0]; acc[i+1] = fallback[1]; acc[i+2] = fallback[2];
    } else {
      acc[i] /= l; acc[i+1] /= l; acc[i+2] /= l;
    }
  }
  return acc;
}

// -----------------------------------------------------------------------------
// mouthPucker morph — rounds the lips (o/u vowels): lateral squeeze toward the
// mouth center + slight forward push. Symmetric around the mouth line.
export function puckerDelta(positions, anchor, cfg, region) {
  const { mouth, size, fa, sign } = anchor;
  const lat = lateralAxis(fa);
  const n = positions.length / 3;
  const delta = new Float32Array(positions.length);
  const sigma = cfg.mouth_region_frac * size[1];
  const inv2s2 = 1 / (2 * sigma * sigma);
  const halfFront = 0.5 * size[fa];
  const margin = Math.max(1e-9, cfg.region_falloff_frac * size[1]);
  const forward = cfg.pucker_forward_frac * size[1];

  for (let i = 0; i < n; i++) {
    const p = [positions[i*3], positions[i*3+1], positions[i*3+2]];
    const dl = p[lat] - mouth[lat], dy = p[1] - mouth[1];
    const w = Math.exp(-(dl*dl + dy*dy) * inv2s2);
    const frontCoord = sign * (p[fa] - mouth[fa] + sign * halfFront);
    const frontGate = Math.min(1, Math.max(0, frontCoord / halfFront));
    let amount = w * frontGate;
    if (region && amount > 0) {
      let d = 0;
      for (let a = 0; a < 3; a++) {
        d = Math.max(d, region.lo[a] - p[a], p[a] - region.hi[a], 0);
      }
      amount *= Math.min(1, Math.max(0, 1 - d / margin));
    }
    delta[i*3 + lat] = -amount * dl * cfg.pucker_strength;
    delta[i*3 + fa] += sign * amount * forward;
  }
  return delta;
}

// -----------------------------------------------------------------------------
// unit icosphere (welded), pure JS — replaces THREE.IcosahedronGeometry so the
// batch pipeline runs in node without three.
export function icosphere(subdiv = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => normalize(v));
  let faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      if (cache.has(key)) return cache.get(key);
      const m = normalize([(verts[a][0]+verts[b][0])/2, (verts[a][1]+verts[b][1])/2, (verts[a][2]+verts[b][2])/2]);
      verts.push(m);
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const positions = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => positions.set(v, i * 3));
  const indices = new Uint32Array(faces.length * 3);
  faces.forEach((f, i) => indices.set(f, i * 3));
  return { positions, indices };
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0]/l, v[1]/l, v[2]/l];
}

// Bake a unit icosphere into an ellipsoid mesh: per-axis radii, XYZ-euler
// rotation (degrees), translation; flipped = normals point inward (cavity).
export function bakeEllipsoid(center, radii, { rotationDeg = [0, 0, 0], flipped = false } = {}) {
  const { positions: unit, indices: srcIdx } = icosphere(2);
  const n = unit.length / 3;
  const R = eulerXYZ(rotationDeg.map((d) => d * Math.PI / 180));
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = [unit[i*3], unit[i*3+1], unit[i*3+2]];
    const scaled = [u[0]*radii[0], u[1]*radii[1], u[2]*radii[2]];
    const p = mulMat3(R, scaled);
    positions[i*3] = center[0] + p[0];
    positions[i*3+1] = center[1] + p[1];
    positions[i*3+2] = center[2] + p[2];
    const nrm = normalize([u[0]/radii[0], u[1]/radii[1], u[2]/radii[2]]);
    const rn = mulMat3(R, nrm);
    const s = flipped ? -1 : 1;
    normals[i*3] = rn[0]*s; normals[i*3+1] = rn[1]*s; normals[i*3+2] = rn[2]*s;
  }
  const indices = new Uint32Array(srcIdx.length);
  for (let i = 0; i < srcIdx.length; i += 3) {
    indices[i] = srcIdx[i];
    indices[i+1] = flipped ? srcIdx[i+2] : srcIdx[i+1];
    indices[i+2] = flipped ? srcIdx[i+1] : srcIdx[i+2];
  }
  return { positions, normals, indices };
}

function eulerXYZ([x, y, z]) {
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  // R = Rz * Ry * Rx (matching THREE 'XYZ' euler order applied to a vector)
  return [
    cy*cz, sx*sy*cz - cx*sz, cx*sy*cz + sx*sz,
    cy*sz, sx*sy*sz + cx*cz, cx*sy*sz - sx*cz,
    -sy,   sx*cy,            cx*cy,
  ];
}
function mulMat3(m, v) {
  return [
    m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
    m[3]*v[0] + m[4]*v[1] + m[5]*v[2],
    m[6]*v[0] + m[7]*v[1] + m[8]*v[2],
  ];
}

// -----------------------------------------------------------------------------
// front-axis auto-detection. In the nose/mouth band of the head, the face side
// has (a) the strongest protrusion relative to the head half-extent (the nose
// defines the head bbox front) and (b) more vertices (AI meshes put detail on
// the face). Validated on the project's characters: front +z scores ~1.07 vs
// 0.84 for ±x and 0.77 for -z. Returns null when the score gap is too small.
export function guessFrontOrientation(positions, region) {
  const hb = boundsInBox(positions, region);
  if (!hb || hb.count < 50) return null;
  const size = [hb.hi[0]-hb.lo[0], hb.hi[1]-hb.lo[1], hb.hi[2]-hb.lo[2]];
  const center = [(hb.lo[0]+hb.hi[0])/2, (hb.lo[1]+hb.hi[1])/2, (hb.lo[2]+hb.hi[2])/2];
  const yLo = hb.lo[1] + 0.15 * size[1], yHi = hb.lo[1] + 0.6 * size[1];
  const n = positions.length / 3;

  const candidates = [];
  for (const a of [0, 2]) {
    for (const s of [1, -1]) {
      const d = [];
      for (let i = 0; i < n; i++) {
        const x = positions[i*3], y = positions[i*3+1], z = positions[i*3+2];
        if (y < yLo || y > yHi) continue;
        if (region && (x < region.lo[0] || x > region.hi[0] ||
                       y < region.lo[1] || y > region.hi[1] ||
                       z < region.lo[2] || z > region.hi[2])) continue;
        d.push(s * ((a === 0 ? x : z) - center[a]));
      }
      if (d.length < 20) continue;
      d.sort((p, q) => p - q);
      const half = size[a] / 2 || 1e-9;
      const p98 = d[Math.floor(0.98 * (d.length - 1))] / half;
      const front = d.filter((v) => v > 0.25 * half).length;
      const back = d.filter((v) => v < -0.25 * half).length || 1;
      candidates.push({ axis: a === 0 ? 'x' : 'z', sign: s, score: p98 * Math.sqrt(front / back) });
    }
  }
  candidates.sort((p, q) => q.score - p.score);
  if (candidates.length < 2 || candidates[0].score < 1.08 * candidates[1].score) return null;
  return { front_axis: candidates[0].axis, front_sign: candidates[0].sign };
}

// Port of facerig._build_cavity_and_tongue placement (geometry itself is an
// icosphere built by the caller). Returns centers + per-axis radii in the
// same (head-local) space as the anchor.
export function cavityAndTonguePlacement(anchor, cfg) {
  const { mouth, size, fa, sign } = anchor;

  const cavCenter = [...mouth];
  cavCenter[fa] -= sign * cfg.cavity_depth_frac * size[fa];
  for (let i = 0; i < 3; i++) cavCenter[i] += cfg.cavity_offset_frac[i] * size[i];
  const cavRadii = [
    cfg.cavity_scale[0] * size[0],
    cfg.cavity_scale[1] * size[1],
    cfg.cavity_scale[2] * size[2],
  ];

  let tonCenter, tonRadii;
  if (cfg.lip_rim) {
    // NOTE: with lip_rim the exported tongue also carries a jawOpen morph
    // (rides at TONGUE_FOLLOW of the jaw drop) — see tongueJawDelta below.
    // v0.5: with the pocket mouth, the tongue is sized by the calibrated
    // MOUTH (slit width), not the whole head, and rests fully inside the
    // pocket: tip strictly behind the lip line, body below the mouth line.
    const lat = lateralAxis(fa);
    const W = cfg.lip_cut_width_frac * size[lat];  // full slit width
    tonRadii = [
      cfg.tongue_scale[0] * W * 2.2,
      cfg.tongue_scale[1] * W * 2.2,
      cfg.tongue_scale[2] * W * 2.2,
    ];
    const rimD = cfg.rim_depth * size[fa];
    tonCenter = [...mouth];
    tonCenter[fa] -= sign * (0.35 * rimD + tonRadii[fa]);
    tonCenter[1] -= 1.0 * tonRadii[1];
    for (let i = 0; i < 3; i++) tonCenter[i] += cfg.tongue_offset_frac[i] * size[i];
  } else {
    tonCenter = [...cavCenter];
    tonCenter[1] -= 0.25 * cfg.cavity_scale[1] * size[1];
    // python used +0.15 here, which parks the tongue tip at the lip plane and
    // pokes through closed lips on real heads (mustaches pull the snapped
    // anchor forward). +0.06 keeps it hidden at rest, visible when the jaw drops.
    tonCenter[fa] += sign * 0.06 * size[fa];
    for (let i = 0; i < 3; i++) {
      tonCenter[i] += (cfg.tongue_offset_frac[i] - cfg.cavity_offset_frac[i]) * size[i];
    }
    tonRadii = [
      cfg.tongue_scale[0] * size[0],
      cfg.tongue_scale[1] * size[1],
      cfg.tongue_scale[2] * size[2],
    ];
  }

  return { cavCenter, cavRadii, tonCenter, tonRadii };
}

// The tongue is anchored to the lower jaw in real anatomy: at full jawOpen it
// drops by this fraction of the jaw strength (uniform delta over the whole
// tongue mesh), so it reads as lying in the lower mouth instead of hanging
// from the palate.
export const TONGUE_FOLLOW = 0.7;

export function tongueJawDelta(vertCount, anchor, cfg) {
  const { size, fa, sign } = anchor;
  const strength = cfg.jaw_strength_frac * size[1];
  const delta = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    delta[i * 3 + 1] = -TONGUE_FOLLOW * strength;
    delta[i * 3 + fa] = sign * TONGUE_FOLLOW * strength * cfg.jaw_forward;
  }
  return delta;
}

// Bounds of the vertices that fall inside a box (or of all vertices if box
// is null). Used to derive the HEAD bounds from a full-body mesh.
export function boundsInBox(positions, box) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (box) {
      if (x < box.lo[0] || x > box.hi[0] ||
          y < box.lo[1] || y > box.hi[1] ||
          z < box.lo[2] || z > box.hi[2]) continue;
    }
    count++;
    if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
    if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
    if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
  }
  if (!count) return null;
  return { lo, hi, count };
}

// The bbox-front mouth anchor sits on the head box's front plane — i.e. at
// nose-tip depth, in front of the actual lips. This finds the real lip
// surface: the frontmost vertex in a small window around the anchor at mouth
// height, and returns the front-axis offset (as a fraction of head size)
// that moves the anchor onto it. Written into cfg.mouth_offset_frac so the
// exported config stays in the standard schema.
export function snapFrontOffsetFrac(positions, anchor, region) {
  const { mouth, size, fa, sign } = anchor;
  const lat = [0, 1, 2].filter((a) => a !== fa && a !== 1); // horizontal non-front axis
  const n = positions.length / 3;
  for (let radius = 0.08 * size[1]; radius < size[1]; radius *= 2) {
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = [positions[i*3], positions[i*3+1], positions[i*3+2]];
      if (region) {
        if (p[0] < region.lo[0] || p[0] > region.hi[0] ||
            p[1] < region.lo[1] || p[1] > region.hi[1] ||
            p[2] < region.lo[2] || p[2] > region.hi[2]) continue;
      }
      let d2 = (p[1] - mouth[1]) ** 2;
      for (const a of lat) d2 += (p[a] - mouth[a]) ** 2;
      if (d2 > radius * radius) continue;
      const front = sign * p[fa];
      if (front > best) best = front;
    }
    if (best > -Infinity) {
      const snapped = sign * best; // back to a raw coordinate on the front axis
      return (snapped - mouth[fa]) / size[fa];
    }
  }
  return 0;
}

// Initial head-box guess. For a full body the head is roughly the top 1/6..1/8
// of the model; for a head-only upload the whole bbox IS the head. We tell the
// two apart by footprint: a head is much narrower than shoulders/arms, so if
// the top slice is nearly as wide as the whole model, this is already a head.
export function guessHeadBox(positions, topFrac = 0.16) {
  const all = boundsInBox(positions, null);
  if (!all) return null;
  const yCut = all.hi[1] - topFrac * (all.hi[1] - all.lo[1]);
  const slab = boundsInBox(positions, {
    lo: [all.lo[0], yCut, all.lo[2]],
    hi: [all.hi[0], all.hi[1], all.hi[2]],
  });
  if (!slab) return all;
  const widthRatio = (slab.hi[0] - slab.lo[0]) / Math.max(1e-9, all.hi[0] - all.lo[0]);
  if (widthRatio > 0.55) return { lo: [...all.lo], hi: [...all.hi] }; // head-only model
  // pad a little so the chin/jaw isn't clipped by the box edge
  const pad = 0.1 * (slab.hi[1] - slab.lo[1]);
  return {
    lo: [slab.lo[0] - pad, slab.lo[1] - pad * 2, slab.lo[2] - pad],
    hi: [slab.hi[0] + pad, slab.hi[1] + pad, slab.hi[2] + pad],
  };
}
