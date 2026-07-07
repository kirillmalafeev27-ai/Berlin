// rig-pipeline.js — the whole facerig export as one pure function.
// No three.js, no DOM: runs identically in the browser (Export button) and in
// node (tools/batch-rig.mjs), so interactive exports and batch runs can't
// drift apart.

import {
  mergeCfg, mouthAnchor, jawDelta, puckerDelta, cutLips, dupAttribute,
  cavityAndTonguePlacement, boundsInBox, bakeEllipsoid,
  knifeSeam, subdivideSeam, buildMouthVolume, computeNormalsFor, blendProv,
  tongueJawDelta, lipTintAmount,
} from './facerig-core.js';
import {
  GLBPatcher, readAccessor, findHeadJointNode, nodeWorldMatrix, M4,
} from './glb-io.js';

// Run the mouth-surgery passes (knife cut → seam subdivision → lip cut →
// rim/pocket volume) on one primitive's arrays. Pure; shared by the export
// pipeline and the tool's live preview so they cannot disagree.
//
// Returns null when nothing changed, else:
// {
//   positions, indices,       // post-surgery arrays (incl. rim verts)
//   preRimCount,              // vertex count before rim verts were appended
//   prov,                     // provenance per new vertex, ORIGINAL space
//   mask,                     // lowerMask sized to preRimCount
//   volume,                   // buildMouthVolume result or null
//   counts: { subdiv, dup, rim },
// }
export function mouthSurgery(positions0raw, indices0, anchorRaw, cfg, region0) {
  const lipCut = cfg.lip_cut || cfg.lip_rim;
  if (!lipCut) return null;

  // Normalize the working scale: models arrive in wildly different units
  // (Mixamo FBX meshes are 1/100 scale), so all internal math runs with the
  // head height ≈ 1 unit and results are scaled back on the way out. Every
  // formula is fraction-based anyway; this pins the residual absolute
  // epsilons and keeps 16 differently-scaled characters behaving identically.
  const S = 1 / (anchorRaw.size[1] || 1);
  const positions0 = new Float32Array(positions0raw.length);
  for (let i = 0; i < positions0.length; i++) positions0[i] = positions0raw[i] * S;
  const anchor = {
    mouth: anchorRaw.mouth.map((v) => v * S),
    size: anchorRaw.size.map((v) => v * S),
    fa: anchorRaw.fa, sign: anchorRaw.sign,
  };
  const region = region0
    ? { lo: region0.lo.map((v) => v * S), hi: region0.hi.map((v) => v * S) }
    : null;

  const n0 = positions0.length / 3;
  // provenance per new vertex: weighted list of ORIGINAL verts [[i, w], ...]
  const prov = [];
  const resolve = (i) => (i < n0 ? [[i, 1]] : prov[i - n0]);

  let pos = positions0, idx = indices0;
  let counts = { knife: 0, subdiv: 0, dup: 0, rim: 0 };

  // pass 0: slice straddling triangles along the mouth plane — painted-on
  // low-poly mouths have no edges to open otherwise
  const kn = knifeSeam(pos, idx, anchor, cfg, region);
  if (kn) {
    pos = kn.positions; idx = kn.indices;
    prov.push(...kn.prov.map(({ a, b, t }) => blendProv(resolve(a), resolve(b), t)));
    counts.knife = kn.prov.length;
  }

  if (Math.round(cfg.lip_subdiv) > 1) {
    const sd = subdivideSeam(pos, idx, anchor, cfg, region);
    if (sd) {
      pos = sd.positions; idx = sd.indices;
      // subdiv provenance references post-knife indices — flatten to originals
      const flat = sd.prov.map(({ a, b, t }) => blendProv(resolve(a), resolve(b), t));
      prov.push(...flat);
      counts.subdiv = sd.prov.length;
    }
  }

  let mask = null;
  const cut = cutLips(pos, idx, anchor, cfg, region);
  if (cut) {
    if (cut.addedCount) {
      for (const s of cut.dupSources) prov.push(resolve(s));
      pos = dupAttribute(pos, 3, cut.dupSources);
      counts.dup = cut.addedCount;
    }
    idx = cut.indices;
    mask = cut.lowerMask;
  }
  const preRimCount = pos.length / 3;

  let volume = null;
  if (cfg.lip_rim) {
    volume = buildMouthVolume(pos, idx, anchor, cfg, region);
    if (volume) {
      for (const v of volume.verts) prov.push(resolve(v.src));
      counts.rim = volume.verts.length;
      const tail = new Float32Array(volume.verts.length * 3);
      volume.verts.forEach((v, k) => tail.set(v.pos, k * 3));
      const all = new Float32Array(pos.length + tail.length);
      all.set(pos); all.set(tail, pos.length);
      pos = all;
      const merged = new Uint32Array(idx.length + volume.tris.length);
      merged.set(idx); merged.set(volume.tris, idx.length);
      idx = merged;
    }
  }

  if (!prov.length && !cut) return null;

  // scale everything back to the model's original units
  const inv = 1 / S;
  const outPos = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) outPos[i] = pos[i] * inv;
  if (volume) {
    // all volume/pocket records own fresh pos arrays (no shared references)
    for (const v of volume.verts) {
      v.pos[0] *= inv; v.pos[1] *= inv; v.pos[2] *= inv;
    }
    for (const v of volume.pocket.verts) {
      v.pos[0] *= inv; v.pos[1] *= inv; v.pos[2] *= inv;
    }
  }
  return { positions: outPos, indices: idx, preRimCount, prov, mask, volume, counts };
}

// configReport: the object produced by the tool's "Export config JSON"
// ({ head_mesh, head_region: {lo,hi}, config: {...} } — extra fields ignored).
// Returns { bytes: Uint8Array, stats }.
export function rigGLB(arrayBuffer, configReport) {
  const cfg = mergeCfg(configReport.config || configReport);
  const region = configReport.head_region
    ? { lo: [...configReport.head_region.lo], hi: [...configReport.head_region.hi] }
    : null;

  const patcher = new GLBPatcher(arrayBuffer);
  const json = patcher.json;
  const bin = patcher.chunks[0];

  const meshIndex = locateHeadMesh(json, configReport.head_mesh);
  const mesh = json.meshes[meshIndex];

  // read positions of every primitive
  const prims = mesh.primitives.map((prim) => {
    const acc = json.accessors[prim.attributes.POSITION];
    if (acc.componentType !== 5126 || acc.type !== 'VEC3') {
      throw new Error('POSITION must be float VEC3 (quantized/compressed meshes are not supported)');
    }
    const positions = readAccessor(json, bin, prim.attributes.POSITION);
    let indices;
    if (prim.indices != null) {
      indices = readAccessor(json, bin, prim.indices);
    } else {
      indices = new Uint32Array(acc.count);
      for (let i = 0; i < acc.count; i++) indices[i] = i;
    }
    return { prim, positions, indices };
  });

  // head bounds from all primitives' vertices inside the region box
  const headBounds = combinedBounds(prims.map((p) => p.positions), region);
  if (!headBounds) throw new Error('head region contains no vertices');
  const anchor = mouthAnchor(headBounds, cfg);

  // mouth surgery per primitive (subdiv → cut → rim), then morph deltas
  const lipCut = cfg.lip_cut || cfg.lip_rim;
  const stats = { head_vertices: headBounds.count, driven: 0,
                  knife_added: 0, cut_added: 0, subdiv_added: 0,
                  rim_verts: 0, pocket_verts: 0, maxOffset: 0 };
  const jawDeltas = [], puckerDeltas = [];
  let pocket = null, pocketJawSrc = null; // volume.pocket + owning prim's deltas

  prims.forEach(({ positions, indices }, pi) => {
    const surgery = lipCut ? mouthSurgery(positions, indices, anchor, cfg, region) : null;
    let pos = positions, mask = null, volume = null, preRimCount = positions.length / 3;
    if (surgery) {
      ({ mask, volume, preRimCount } = surgery);
      pos = surgery.positions;
      stats.knife_added += surgery.counts.knife;
      stats.cut_added += surgery.counts.dup;
      stats.subdiv_added += surgery.counts.subdiv;
      stats.rim_verts += surgery.counts.rim;

      // rim verts get exact computed POSITION + smooth NORMAL; subdiv/dup
      // verts fall out of the provenance blend. Nothing to patch when the
      // surgery only produced a mask (unwelded mesh, no rim).
      if (surgery.prov.length) {
        const overrides = {};
        if (volume) {
          // new verts created before the rim tail (knife + subdiv + dup)
          const newBefore = preRimCount - positions.length / 3;
          overrides.POSITION = { offset: newBefore, data: pos.subarray(preRimCount * 3) };
          const front = [0, 0, 0];
          front[anchor.fa] = anchor.sign;
          overrides.NORMAL = {
            offset: newBefore,
            data: computeNormalsFor(pos, volume.tris, preRimCount, pos.length / 3, front),
          };
        }
        patcher.replacePrimitiveGeometry(meshIndex, pi, {
          prov: surgery.prov, overrides, indices: surgery.indices,
        });
      }

      // 9.3 lip tint: COLOR_0 vertex colors. Existing verts stay at their
      // original color (or white — a no-op multiplier over the texture);
      // roll verts blend toward lip_color with the sin-dome band, so the
      // tint feathers into the skin with no hard mask edge.
      if (volume) {
        const prim = mesh.primitives[pi];
        const total = pos.length / 3;
        const colors = new Float32Array(total * 4).fill(1);
        if (prim.attributes.COLOR_0 != null) {
          const acc = json.accessors[prim.attributes.COLOR_0];
          const src = patcher.getAccessorData(prim.attributes.COLOR_0);
          const isz = src.length / total;
          const norm = acc.componentType === 5121 ? 1 / 255
                     : acc.componentType === 5123 ? 1 / 65535 : 1;
          for (let i = 0; i < total; i++) {
            for (let c = 0; c < Math.min(4, isz); c++) {
              colors[i * 4 + c] = src[i * isz + c] * norm;
            }
          }
        }
        volume.verts.forEach((v, k) => {
          const amt = lipTintAmount(v.tint, cfg);
          if (amt <= 0) return;
          const o = (preRimCount + k) * 4;
          for (let c = 0; c < 3; c++) {
            colors[o + c] += (cfg.lip_color[c] - colors[o + c]) * amt;
          }
        });
        prim.attributes.COLOR_0 = patcher._addAccessorLike(colors, 'VEC4', 5126);
      }
    }

    // analytic deltas over the pre-rim verts, provenance-scaled for rim verts
    const core = pos.subarray(0, preRimCount * 3);
    const jaw = jawDelta(core, anchor, cfg, region, { lowerMask: mask, hardBelow: lipCut });
    const puck = cfg.add_pucker ? puckerDelta(core, anchor, cfg, region) : null;
    stats.driven += jaw.driven;
    stats.maxOffset = Math.max(stats.maxOffset, jaw.maxOffset);

    const total = pos.length / 3;
    const jawFull = new Float32Array(total * 3);
    jawFull.set(jaw.delta);
    const puckFull = puck ? new Float32Array(total * 3) : null;
    if (puckFull) puckFull.set(puck);
    if (volume) {
      volume.verts.forEach((v, k) => {
        const o = (preRimCount + k) * 3, s = v.src * 3;
        for (let c = 0; c < 3; c++) {
          jawFull[o + c] = jaw.delta[s + c] * v.scale;
          if (puckFull) puckFull[o + c] = puck[s + c] * v.scale;
        }
      });
      pocket = volume.pocket;
      pocketJawSrc = { jaw: jaw.delta, puck, prov: surgery.prov, n0: positions.length / 3, pi };
    }
    jawDeltas.push(jawFull);
    if (puckFull) puckerDeltas.push(puckFull);
  });

  // pocket primitive: welded mouth interior (dark), part of the head mesh so
  // it shares morph-target count and the skin — added BEFORE our morphs so
  // the target lists line up across primitives
  const cavMat = patcher.addMaterial('cavity', cfg.cavity_color, { roughness: 1 });
  if (pocket) {
    const pv = pocket.verts;
    const pPos = new Float32Array(pv.length * 3);
    pv.forEach((v, k) => pPos.set(v.pos, k * 3));
    const pFront = [0, 0, 0];
    pFront[anchor.fa] = anchor.sign;
    const pNrm = computeNormalsFor(pPos, pocket.tris, 0, pv.length, pFront);
    const attrs = {
      POSITION: { data: pPos, type: 'VEC3', componentType: 5126 },
      NORMAL: { data: pNrm, type: 'VEC3', componentType: 5126 },
    };
    // inherit skinning from the source head verts. The owning primitive's
    // attributes were already replaced by their provenance-extended versions,
    // so v.src (a post-surgery index) addresses them directly.
    const headPrim = mesh.primitives[pocketJawSrc.pi];
    if (headPrim.attributes.JOINTS_0 != null && headPrim.attributes.WEIGHTS_0 != null) {
      for (const name of ['JOINTS_0', 'WEIGHTS_0']) {
        const accIdx = headPrim.attributes[name];
        const acc = json.accessors[accIdx];
        const src = patcher.getAccessorData(accIdx);
        const out = new src.constructor(pv.length * 4);
        pv.forEach((v, k) => {
          for (let c = 0; c < 4; c++) out[k * 4 + c] = src[v.src * 4 + c];
        });
        attrs[name] = { data: out, type: 'VEC4', componentType: acc.componentType,
                        normalized: acc.normalized };
      }
    }
    patcher.addPrimitive(meshIndex, { attrs, indices: pocket.tris, material: cavMat });

    // pocket morph deltas: scaled copies of the owning primitive's deltas
    const { jaw, puck } = pocketJawSrc;
    const pJaw = new Float32Array(pv.length * 3);
    const pPuck = puck ? new Float32Array(pv.length * 3) : null;
    pv.forEach((v, k) => {
      const s = v.src * 3;
      for (let c = 0; c < 3; c++) {
        pJaw[k * 3 + c] = jaw[s + c] * v.scale;
        if (pPuck) pPuck[k * 3 + c] = puck[s + c] * v.scale;
      }
    });
    jawDeltas.push(pJaw);
    if (pPuck) puckerDeltas.push(pPuck);
    stats.pocket_verts = pv.length;
  }

  const morphs = [{ name: 'jawOpen', deltasPerPrimitive: jawDeltas }];
  if (cfg.add_pucker) morphs.push({ name: 'mouthPucker', deltasPerPrimitive: puckerDeltas });
  patcher.addMorphTargets(meshIndex, morphs);

  // tongue always; icosphere cavity only when the welded pocket isn't built
  const place = cavityAndTonguePlacement(anchor, cfg);
  const tonGeo = bakeEllipsoid(place.tonCenter, place.tonRadii,
    { rotationDeg: cfg.tongue_rotation_deg, flipped: false });
  const tonMat = patcher.addMaterial('tongue', cfg.tongue_color, { roughness: 0.8 });
  const { parentNode, matrix } = mouthPropPlacement(json, bin, meshIndex);
  if (!pocket) {
    const cavGeo = bakeEllipsoid(place.cavCenter, place.cavRadii,
      { rotationDeg: cfg.cavity_rotation_deg, flipped: true });
    patcher.addMeshNode('MouthCavity', cavGeo, cavMat, { parentNode, matrix });
  }
  const tongue = patcher.addMeshNode('Tongue', tonGeo, tonMat, { parentNode, matrix });

  // the tongue rides with the lower jaw (its own jawOpen morph, driven by the
  // same runtime loop that drives every mesh with a jawOpen target)
  if (pocket) {
    const tonVerts = tonGeo.positions.length / 3;
    const tonMorphs = [{ name: 'jawOpen',
      deltasPerPrimitive: [tongueJawDelta(tonVerts, anchor, cfg)] }];
    if (cfg.add_pucker) {
      tonMorphs.push({ name: 'mouthPucker',
        deltasPerPrimitive: [new Float32Array(tonVerts * 3)] });
    }
    patcher.addMorphTargets(tongue.mesh, tonMorphs);
  }

  return { bytes: patcher.build(), stats, meshIndex };
}

function locateHeadMesh(json, meshName) {
  if (meshName != null) {
    const byName = json.meshes.findIndex((m) => m.name === meshName);
    if (byName >= 0) return byName;
  }
  // fallback: the mesh with the biggest primitive (the body / merged model)
  let best = 0, bestCount = -1;
  json.meshes.forEach((m, i) => {
    for (const p of m.primitives) {
      const c = json.accessors[p.attributes.POSITION]?.count ?? 0;
      if (c > bestCount) { bestCount = c; best = i; }
    }
  });
  return best;
}

function combinedBounds(positionArrays, region) {
  let lo = null, hi = null, count = 0;
  for (const pos of positionArrays) {
    const b = boundsInBox(pos, region);
    if (!b) continue;
    count += b.count;
    if (!lo) { lo = [...b.lo]; hi = [...b.hi]; continue; }
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], b.lo[a]);
      hi[a] = Math.max(hi[a], b.hi[a]);
    }
  }
  return lo ? { lo, hi, count } : null;
}

// Where to hang the cavity/tongue nodes so they land on the rendered head and
// follow it in animation.
//
// Skinned mesh: a skinned primitive's vertices are transformed ONLY by the
// joints (the mesh node's own transform is ignored per glTF spec):
//   rendered = jointWorld * inverseBindMatrix * localVertex
// So a static prop baked in mesh-local coords lands exactly on the skinned
// surface when parented to the head joint with node.matrix = that joint's IBM.
//
// Static mesh: parent to the scene root with the mesh node's world matrix.
function mouthPropPlacement(json, bin, meshIndex) {
  const headJoint = findHeadJointNode(json, meshIndex);
  if (headJoint != null) {
    const skinnedNode = (json.nodes || []).find((n) => n.mesh === meshIndex && n.skin != null);
    if (skinnedNode) {
      const skin = json.skins[skinnedNode.skin];
      const jointPos = skin.joints.indexOf(headJoint);
      if (jointPos >= 0 && skin.inverseBindMatrices != null) {
        const ibms = readAccessor(json, bin, skin.inverseBindMatrices);
        const ibm = Array.from(ibms.slice(jointPos * 16, jointPos * 16 + 16));
        return { parentNode: headJoint, matrix: ibm };
      }
    }
  }
  const meshNodeIdx = (json.nodes || []).findIndex((n) => n.mesh === meshIndex);
  const matrix = meshNodeIdx >= 0 ? nodeWorldMatrix(json, meshNodeIdx) : M4.identity();
  return { parentNode: null, matrix };
}
