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
  cavity_scale: [0.32, 0.22, 0.30],
  cavity_depth_frac: 0.35,
  cavity_offset_frac: [0, 0, 0],       // web extension, 0 = python-identical
  cavity_color: [0.02, 0.01, 0.01, 1.0],
  tongue_scale: [0.16, 0.05, 0.18],
  tongue_offset_frac: [0, 0, 0],       // web extension, 0 = python-identical
  tongue_color: [0.55, 0.20, 0.22, 1.0],
};

export function mergeCfg(cfg) {
  const out = { ...DEFAULT_CFG, ...(cfg || {}) };
  for (const k of ['mouth_offset_frac', 'cavity_offset_frac', 'tongue_offset_frac',
                   'cavity_scale', 'tongue_scale', 'cavity_color', 'tongue_color']) {
    out[k] = [...out[k]];
  }
  return out;
}

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
// Returns { delta: Float32Array(N*3), driven, maxOffset }.
export function jawDelta(positions, anchor, cfg, region) {
  const { mouth, size, fa, sign } = anchor;
  const n = positions.length / 3;
  const delta = new Float32Array(positions.length);

  const sigma = cfg.mouth_region_frac * size[1];
  const strength = cfg.jaw_strength_frac * size[1];
  const inv2s2 = 1 / (2 * sigma * sigma);
  const halfFront = 0.5 * size[fa];
  const belowScale = 0.25 * size[1];
  const margin = Math.max(1e-9, cfg.region_falloff_frac * size[1]);

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
    const below = Math.min(1, Math.max(0, (mouth[1] - py) / belowScale));

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
  tonCenter[fa] += sign * 0.15 * size[fa];
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
