// rig-pipeline.js — the whole facerig export as one pure function.
// No three.js, no DOM: runs identically in the browser (Export button) and in
// node (tools/batch-rig.mjs), so interactive exports and batch runs can't
// drift apart.

import {
  mergeCfg, mouthAnchor, jawDelta, puckerDelta, buildMouthGeometry,
  applyAugmentedMorphDeltas, measureDelta,
  cavityAndTonguePlacement, boundsInBox, bakeEllipsoid,
} from './facerig-core.js';
import {
  GLBPatcher, readAccessor, findHeadJointNode, nodeWorldMatrix, M4,
} from './glb-io.js';

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

  // lip cut first (changes vertex counts), then morph deltas
  const stats = { head_vertices: headBounds.count, driven: 0, cut_added: 0, rim_added: 0, maxOffset: 0 };
  const jawDeltas = [], puckerDeltas = [];
  prims.forEach(({ positions, indices }, pi) => {
    let mask = null, pos = positions, aug = null;
    if (cfg.lip_cut) {
      aug = buildMouthGeometry(pos, indices, anchor, cfg, region);
      if (aug) {
        patcher.replaceAugmentedGeometry(meshIndex, pi, aug);
        pos = aug.positions;
        stats.cut_added += aug.cutAdded;
        stats.rim_added += aug.rimAdded;
        mask = aug.lowerMask; // unwelded mesh: the mask alone opens the slit
      }
    }
    const jaw = jawDelta(pos, anchor, cfg, region, { lowerMask: mask, hardBelow: cfg.lip_cut });
    applyAugmentedMorphDeltas(jaw.delta, aug, 'jaw');
    const measuredJaw = measureDelta(jaw.delta);
    stats.driven += measuredJaw.driven;
    stats.maxOffset = Math.max(stats.maxOffset, measuredJaw.maxOffset);
    jawDeltas.push(jaw.delta);
    if (cfg.add_pucker) {
      const puck = puckerDelta(pos, anchor, cfg, region);
      applyAugmentedMorphDeltas(puck, aug, 'pucker');
      puckerDeltas.push(puck);
    }
  });

  const morphs = [{ name: 'jawOpen', deltasPerPrimitive: jawDeltas }];
  if (cfg.add_pucker) morphs.push({ name: 'mouthPucker', deltasPerPrimitive: puckerDeltas });
  patcher.addMorphTargets(meshIndex, morphs);

  // cavity + tongue (in the mesh's local/bind space)
  const place = cavityAndTonguePlacement(anchor, cfg);
  const cavGeo = bakeEllipsoid(place.cavCenter, place.cavRadii,
    { rotationDeg: cfg.cavity_rotation_deg, flipped: true });
  const tonGeo = bakeEllipsoid(place.tonCenter, place.tonRadii,
    { rotationDeg: cfg.tongue_rotation_deg, flipped: false });
  const cavMat = patcher.addMaterial('cavity', cfg.cavity_color, { roughness: 1 });
  const tonMat = patcher.addMaterial('tongue', cfg.tongue_color, { roughness: 0.8 });

  const { parentNode, matrix } = mouthPropPlacement(json, bin, meshIndex);
  patcher.addMeshNode('MouthCavity', cavGeo, cavMat, { parentNode, matrix });
  patcher.addMeshNode('Tongue', tonGeo, tonMat, { parentNode, matrix });

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
