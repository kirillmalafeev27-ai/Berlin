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
  lip_cut: false,                      // web extension: split verts along the mouth line
  lip_cut_width_frac: 0.45,            // full slit width, fraction of head lateral size
  mouth_open_height_frac: 0.10,         // procedural oval height for the generated mouth edge
  mouth_segments: 28,                  // generated mouth edge resolution
  rim_depth: 0.08,                     // inward/back extrusion depth, fraction of head front depth
  rim_segments: 2,                     // loops across the inner lip rim
  bevel_width: 0.025,                  // rounded lip edge width, fraction of head front depth
  bevel_segments: 1,                   // loops rounding the outer lip edge
  edge_smooth: 1,                      // laplacian smoothing passes for the generated mouth edge
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
    if (hardBelow && frontGate > 0.65 &&
        Math.abs(p[lat] - mouth[lat]) < latHalfWidth &&
        (py < mouth[1] || (lowerMask && lowerMask[i]))) {
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
    const cl = (P(a,lat) + P(b,lat) + P(c,lat)) / 3;
    const cf = (P(a,fa) + P(b,fa) + P(c,fa)) / 3;
    const frontGate = sign * (cf - mouth[fa] + sign * halfFront) / halfFront;
    const inZone = Math.abs(cl - mouth[lat]) < halfW && frontGate > 0.65 &&
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

// Build the complete mouth-side topology mutation for one primitive:
//   1) the legacy lip cut duplicates seam vertices where the source mesh is
//      welded;
//   2) a generated oval bevel/rim tunnel adds stable mouth-edge resolution
//      independent of the source head polygon count.
//
// The returned sourceForAdded list is used for every non-position attribute
// (JOINTS_0, WEIGHTS_0, UVs, existing morph targets, etc.), so new vertices stay
// bound to the same skin and animation as nearby head vertices.
export function buildMouthGeometry(positions, indices, anchor, cfg, region) {
  const baseCount = positions.length / 3;
  const cut = cutLips(positions, indices, anchor, cfg, region);
  const sourceForAdded = [];
  let outIndices = cut ? cut.indices : Uint32Array.from(indices);
  let outPositions = cut && cut.addedCount ? dupAttribute(positions, 3, cut.dupSources) : cloneTyped(positions);
  let lowerMask = cut ? cut.lowerMask : new Uint8Array(baseCount);
  const cutAdded = cut ? cut.addedCount : 0;
  if (cut && cut.addedCount) {
    for (const s of cut.dupSources) sourceForAdded.push(s);
  }
  const lowerDupBySource = new Map();
  if (cut && cut.addedCount) {
    for (let k = 0; k < cut.dupSources.length; k++) {
      lowerDupBySource.set(cut.dupSources[k], baseCount + k);
    }
  }

  const shouldRim =
    cfg.lip_cut &&
    clampInt(cfg.mouth_segments, 8, 96) >= 8 &&
    (num(cfg.rim_depth, 0) > 0 || num(cfg.bevel_width, 0) > 0);

  const aug = {
    baseCount,
    vertexCount: outPositions.length / 3,
    positions: outPositions,
    indices: outIndices,
    lowerMask,
    sourceForAdded: Uint32Array.from(sourceForAdded),
    cutAdded,
    rimAdded: 0,
    generatedStart: outPositions.length / 3,
    generatedCount: 0,
    generatedMorphSources: new Uint32Array(0),
    generatedJawScales: new Float32Array(0),
    generatedPuckerScales: new Float32Array(0),
    generatedNormals: null,
    extraIndexStart: outIndices.length,
    lowerDupBySource,
  };

  if (shouldRim) addGeneratedMouthRim(aug, positions, anchor, cfg, region);
  if (!cut && !aug.rimAdded) return null;
  return aug;
}

export function augmentAttribute(src, itemSize, aug, semantic = '') {
  if (!aug) return cloneTyped(src);
  if (semantic === 'POSITION') return cloneTyped(aug.positions);

  const out = new src.constructor(aug.vertexCount * itemSize);
  out.set(src);
  const sourceForAdded = aug.sourceForAdded || [];
  const baseCount = aug.baseCount;
  for (let k = 0; k < sourceForAdded.length; k++) {
    const dst = baseCount + k;
    const srcIdx = sourceForAdded[k];
    for (let c = 0; c < itemSize; c++) {
      out[dst * itemSize + c] = src[srcIdx * itemSize + c];
    }
  }

  if (semantic === 'NORMAL' && itemSize === 3 && aug.generatedNormals) {
    out.set(aug.generatedNormals, aug.generatedStart * 3);
  }
  return out;
}

export function applyAugmentedMorphDeltas(delta, aug, kind = 'jaw') {
  if (!aug || !aug.generatedCount) return;
  const scales = kind === 'pucker' ? aug.generatedPuckerScales : aug.generatedJawScales;
  for (let i = 0; i < aug.generatedCount; i++) {
    const dst = aug.generatedStart + i;
    const src = aug.generatedMorphSources[i];
    const s = scales[i];
    delta[dst * 3] = delta[src * 3] * s;
    delta[dst * 3 + 1] = delta[src * 3 + 1] * s;
    delta[dst * 3 + 2] = delta[src * 3 + 2] * s;
  }
}

export function measureDelta(delta) {
  let driven = 0, maxOffset = 0;
  for (let i = 0; i < delta.length; i += 3) {
    const off = Math.hypot(delta[i], delta[i + 1], delta[i + 2]);
    if (off > 1e-4) driven++;
    if (off > maxOffset) maxOffset = off;
  }
  return { driven, maxOffset };
}

function addGeneratedMouthRim(aug, sourcePositions, anchor, cfg, region) {
  const { mouth, size, fa, sign } = anchor;
  const lat = lateralAxis(fa);
  const segments = clampInt(cfg.mouth_segments, 8, 96);
  const bevelSegments = clampInt(cfg.bevel_segments, 0, 4);
  const rimSegments = clampInt(cfg.rim_segments, 1, 4);
  const ringCount = 1 + bevelSegments + rimSegments;
  const halfW = Math.max(1e-6, 0.5 * cfg.lip_cut_width_frac * size[lat]);
  const radiusY = Math.max(1e-6, num(cfg.mouth_open_height_frac, 0.1) * size[1]);
  const axisDepth = Math.max(1e-6, size[fa]);
  const frontInset = 0.006 * axisDepth;
  const totalDepth = Math.max(0.001 * axisDepth, num(cfg.rim_depth, 0.08) * axisDepth);
  const bevelInset = Math.min(0.45 * halfW, num(cfg.bevel_width, 0.025) * axisDepth);
  const smoothIters = clampInt(cfg.edge_smooth, 0, 8);

  const outer = [];
  for (let j = 0; j < segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    const p = [...mouth];
    p[lat] += Math.cos(theta) * halfW;
    p[1] += Math.sin(theta) * radiusY;
    p[fa] -= sign * frontInset;
    outer.push(p);
  }
  smoothClosedLoop(outer, smoothIters);

  const sources = outer.map((p) => nearestMouthSource(sourcePositions, p, anchor, cfg, region, p[1] < mouth[1]));
  const pos = Array.from(aug.positions);
  const idx = Array.from(aug.indices);
  const lower = Array.from(aug.lowerMask);
  const sourceForAdded = Array.from(aug.sourceForAdded);
  const morphSources = [];
  const jawScales = [];
  const puckerScales = [];
  const rings = [];

  aug.generatedStart = aug.vertexCount;
  const makeVertex = (p, source, jawScale, puckerScale) => {
    const v = pos.length / 3;
    pos.push(p[0], p[1], p[2]);
    lower.push(jawScale > 0.28 ? 1 : 0);
    sourceForAdded.push(source);
    morphSources.push(jawScale > 0.1 && aug.lowerDupBySource?.has(source)
      ? aug.lowerDupBySource.get(source)
      : source);
    jawScales.push(jawScale);
    puckerScales.push(puckerScale);
    return v;
  };

  for (let r = 0; r < ringCount; r++) {
    const t = ringCount === 1 ? 0 : r / (ringCount - 1);
    const eased = smoothstep01(t);
    const bevelT = bevelSegments ? Math.min(1, r / (bevelSegments + 1)) : (r > 0 ? 1 : 0);
    const radialInset = bevelInset * smoothstep01(bevelT) + 0.04 * halfW * eased;
    const latScale = Math.max(0.15, (halfW - radialInset) / halfW);
    const yScale = Math.max(0.20, (radiusY - radialInset * 0.65) / radiusY);
    const depth = frontInset + totalDepth * eased;
    const ring = [];
    for (let j = 0; j < segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      const sin = Math.sin(theta);
      const radial = outer[j];
      const p = [...mouth];
      p[lat] = mouth[lat] + (radial[lat] - mouth[lat]) * latScale;
      p[1] = mouth[1] + (radial[1] - mouth[1]) * yScale;
      p[fa] = mouth[fa] - sign * depth;

      const lowerAmount = clamp01((0.18 - sin) / 1.18);
      const jawScale = lowerAmount * (1 - 0.72 * eased);
      const puckerScale = 1 - 0.55 * eased;
      ring.push(makeVertex(p, sources[j], jawScale, puckerScale));
    }
    rings.push(ring);
  }

  const extraIndexStart = idx.length;
  const getP = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const pushInwardTri = (a, b, c) => {
    const pa = getP(a), pb = getP(b), pc = getP(c);
    const n = cross(sub(pb, pa), sub(pc, pa));
    const mid = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    const radialOut = [0, 0, 0];
    radialOut[lat] = mid[lat] - mouth[lat];
    radialOut[1] = mid[1] - mouth[1];
    if (dot(n, radialOut) > 0) idx.push(a, c, b);
    else idx.push(a, b, c);
  };

  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < segments; j++) {
      const jn = (j + 1) % segments;
      const a = rings[r][j], b = rings[r][jn], c = rings[r + 1][j], d = rings[r + 1][jn];
      pushInwardTri(a, b, c);
      pushInwardTri(b, d, c);
    }
  }

  const generatedCount = pos.length / 3 - aug.generatedStart;
  const generatedNormals = new Float32Array(generatedCount * 3);
  for (let i = extraIndexStart; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const n = normalize(cross(sub(getP(b), getP(a)), sub(getP(c), getP(a))));
    for (const v of [a, b, c]) {
      if (v < aug.generatedStart) continue;
      const o = (v - aug.generatedStart) * 3;
      generatedNormals[o] += n[0];
      generatedNormals[o + 1] += n[1];
      generatedNormals[o + 2] += n[2];
    }
  }
  for (let i = 0; i < generatedNormals.length; i += 3) {
    const n = normalize([generatedNormals[i], generatedNormals[i + 1], generatedNormals[i + 2]]);
    generatedNormals[i] = n[0]; generatedNormals[i + 1] = n[1]; generatedNormals[i + 2] = n[2];
  }

  aug.positions = Float32Array.from(pos);
  aug.indices = Uint32Array.from(idx);
  aug.lowerMask = Uint8Array.from(lower);
  aug.sourceForAdded = Uint32Array.from(sourceForAdded);
  aug.vertexCount = aug.positions.length / 3;
  aug.rimAdded = generatedCount;
  aug.generatedCount = generatedCount;
  aug.generatedMorphSources = Uint32Array.from(morphSources);
  aug.generatedJawScales = Float32Array.from(jawScales);
  aug.generatedPuckerScales = Float32Array.from(puckerScales);
  aug.generatedNormals = generatedNormals;
  aug.extraIndexStart = extraIndexStart;
}

function nearestMouthSource(positions, target, anchor, cfg, region, preferLower) {
  const { mouth, size, fa, sign } = anchor;
  const lat = lateralAxis(fa);
  const n = positions.length / 3;
  const halfW = 0.75 * cfg.lip_cut_width_frac * size[lat];
  const yWin = Math.max(0.18 * size[1], 2.2 * num(cfg.mouth_open_height_frac, 0.1) * size[1]);
  const halfFront = 0.5 * size[fa];
  let best = -1, bestScore = Infinity, fallback = -1, fallbackScore = Infinity;
  for (let i = 0; i < n; i++) {
    const p = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    if (region && (p[0] < region.lo[0] || p[0] > region.hi[0] ||
                   p[1] < region.lo[1] || p[1] > region.hi[1] ||
                   p[2] < region.lo[2] || p[2] > region.hi[2])) continue;
    const d2 = dist2(p, target);
    if (d2 < fallbackScore) { fallbackScore = d2; fallback = i; }
    const frontGate = sign * (p[fa] - mouth[fa] + sign * halfFront) / halfFront;
    if (frontGate < 0.45) continue;
    if (Math.abs(p[lat] - mouth[lat]) > halfW) continue;
    if (Math.abs(p[1] - mouth[1]) > yWin) continue;
    const wrongSide = preferLower ? p[1] > mouth[1] : p[1] < mouth[1];
    const sidePenalty = wrongSide ? size[1] * size[1] * 0.22 : 0;
    const score = d2 + sidePenalty;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best >= 0 ? best : Math.max(0, fallback);
}

function smoothClosedLoop(points, iterations) {
  const n = points.length;
  for (let it = 0; it < iterations; it++) {
    const next = points.map((p, i) => {
      const a = points[(i + n - 1) % n], b = points[(i + 1) % n];
      return [
        p[0] * 0.5 + (a[0] + b[0]) * 0.25,
        p[1] * 0.5 + (a[1] + b[1]) * 0.25,
        p[2] * 0.5 + (a[2] + b[2]) * 0.25,
      ];
    });
    for (let i = 0; i < n; i++) points[i] = next[i];
  }
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(num(v, lo))));
}
function smoothstep01(t) {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}
function cloneTyped(src) {
  return src.slice ? src.slice() : new src.constructor(src);
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function dist2(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
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

  const tonCenter = [...cavCenter];
  tonCenter[1] -= 0.25 * cfg.cavity_scale[1] * size[1];
  // python used +0.15 here, which parks the tongue tip at the lip plane and
  // pokes through closed lips on real heads (mustaches pull the snapped
  // anchor forward). +0.06 keeps it hidden at rest, visible when the jaw drops.
  tonCenter[fa] += sign * 0.06 * size[fa];
  for (let i = 0; i < 3; i++) {
    tonCenter[i] += (cfg.tongue_offset_frac[i] - cfg.cavity_offset_frac[i]) * size[i];
  }
  const tonRadii = [
    cfg.tongue_scale[0] * size[0],
    cfg.tongue_scale[1] * size[1],
    cfg.tongue_scale[2] * size[2],
  ];

  return { cavCenter, cavRadii, tonCenter, tonRadii };
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
