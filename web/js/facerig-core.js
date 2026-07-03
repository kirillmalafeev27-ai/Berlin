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
