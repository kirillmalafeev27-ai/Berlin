// main.js — facerig-web: visual calibration tool for jaw-open lip-sync rigs.
// Load a (full-body) GLB → isolate the head with a box → tune the config with
// live preview → export a rigged GLB (jawOpen + mouthPucker morphs, lip cut,
// cavity, tongue) and a config JSON. Export goes through rig-pipeline.js — the
// same pure code path the node batch tool uses.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import {
  mergeCfg, mouthAnchor, jawDelta, puckerDelta,
  cavityAndTonguePlacement, boundsInBox, guessHeadBox, snapFrontOffsetFrac,
  guessFrontOrientation, extendAttributeData, computeNormalsFor,
} from './facerig-core.js';
import { rigGLB, mouthSurgery } from './rig-pipeline.js';
import { parseGLB } from './glb-io.js';
import { AmplitudeDriver } from './audio-drive.js';
import { idbSet } from './idb-store.js';

// ---------------------------------------------------------------------------
// scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x22262b);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
camera.position.set(0.8, 1.4, 2.4);

const orbit = new OrbitControls(camera, canvas);
orbit.target.set(0, 1, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(2, 4, 3);
scene.add(key);
scene.add(new THREE.GridHelper(4, 8, 0x444a52, 0x33383f));

const gizmo = new TransformControls(camera, canvas);
gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const state = {
  fileName: null,
  originalBuffer: null,     // ArrayBuffer of the loaded GLB (export patches this)
  gltf: null,
  gltfJson: null,           // parsed GLB json (names, meshes) for config export
  root: null,
  meshes: [],
  mesh: null,               // selected head-owning THREE mesh
  meshIndex: null,          // its glTF mesh index
  originalGeo: null,        // untouched geometry of the selected mesh
  cfg: mergeCfg(),
  region: { lo: [0, 0, 0], hi: [0, 0, 0] },
  anchor: null,
  headBounds: null,
  surgery: null,            // active mouthSurgery result (or null)
  cutSig: null,
  stats: { driven: 0, regionVerts: 0, maxOffset: 0, cutAdded: 0,
           knifeAdded: 0, subdivAdded: 0, rimVerts: 0 },
  jawOpen: 0,
  pucker: 0,
  audioDrives: false,
};

// preview helper objects — children of `helpers.space`, a group positioned so
// its local coordinates == the mesh's bind-space coordinates on the RENDERED
// surface (plain mesh: the mesh itself; skinned mesh: head bone × IBM).
const helpers = {
  space: null,
  regionProxy: new THREE.Object3D(),
  regionBox: null,
  anchorMarker: null,
  cavity: null,
  tongue: null,
};

const driver = new AmplitudeDriver();

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();

async function loadArrayBuffer(buf, name = 'model.glb') {
  const gltf = await new Promise((res, rej) => loader.parse(buf.slice(0), '', res, rej));
  clearModel();
  state.fileName = name;
  state.originalBuffer = buf;
  state.gltfJson = parseGLB(buf).json;
  state.gltf = gltf;
  state.root = gltf.scene;
  scene.add(gltf.scene);

  state.meshes = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) state.meshes.push(o);
  });
  if (!state.meshes.length) { setStatus('No meshes found in GLB'); return; }

  const biggest = state.meshes.reduce((a, b) =>
    (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
  rebuildMeshDropdown();
  selectMesh(biggest);
  frameObject(gltf.scene);
  setStatus(`Loaded ${name}: ${state.meshes.length} mesh(es). Head box auto-guessed — adjust it, then tune the mouth.`);
}

function clearModel() {
  restoreSelectedMesh();
  if (state.root) scene.remove(state.root);
  gizmo.detach();
  destroyHelpers();
  Object.assign(state, {
    gltf: null, gltfJson: null, root: null, meshes: [], mesh: null,
    meshIndex: null, originalGeo: null, anchor: null, headBounds: null,
    surgery: null, cutSig: null,
  });
}

function restoreSelectedMesh() {
  if (state.mesh && state.originalGeo) {
    if (state.mesh.geometry !== state.originalGeo) state.mesh.geometry.dispose();
    state.mesh.geometry = state.originalGeo;
    state.mesh.updateMorphTargets();
  }
}

function destroyHelpers() {
  for (const k of ['regionBox', 'anchorMarker', 'cavity', 'tongue', 'pocket']) {
    if (helpers[k]) { helpers[k].removeFromParent(); helpers[k] = null; }
  }
  helpers.regionProxy.removeFromParent();
  if (helpers.space) { helpers.space.removeFromParent(); helpers.space = null; }
}

function selectMesh(mesh) {
  if (state.mesh === mesh) return;
  destroyHelpers();
  restoreSelectedMesh();

  state.mesh = mesh;
  state.originalGeo = mesh.geometry;
  state.surgery = null;
  state.cutSig = null;
  guiState.mesh = meshLabel(mesh);

  const assoc = state.gltf.parser.associations.get(mesh);
  state.meshIndex = assoc && assoc.meshes != null ? assoc.meshes : null;

  const pos = pristinePositions();
  const guess = guessHeadBox(pos);
  state.region.lo = guess.lo; state.region.hi = guess.hi;

  // auto-detect the face direction (overridable in Orientation)
  const orient = guessFrontOrientation(pos, state.region);
  if (orient) {
    state.cfg.front_axis = orient.front_axis;
    state.cfg.front_sign = orient.front_sign;
    refreshGui();
  }

  buildHelpers(mesh);
  rebuildWorkingGeometry();   // installs facerig morph slots
  recompute();
  snapAnchorToLips();         // pull the anchor off the nose-tip plane onto the lips
}

function meshLabel(m) {
  const c = m.geometry.attributes.position.count;
  return `${m.name || '(unnamed)'} · ${c}v`;
}

function pristinePositions() { return state.originalGeo.attributes.position.array; }
function pristineIndices() {
  const geo = state.originalGeo;
  if (geo.index) return geo.index.array;
  const n = geo.attributes.position.count;
  const seq = new Uint32Array(n);
  for (let i = 0; i < n; i++) seq[i] = i;
  return seq;
}

// ---------------------------------------------------------------------------
// working geometry: pristine attributes extended through mouth-surgery
// provenance (knife / subdiv / cut / rim verts) + facerig morph slots.
// Mirrors exactly what rig-pipeline does to the exported GLB.
// ---------------------------------------------------------------------------
function rebuildWorkingGeometry() {
  const mesh = state.mesh;
  const src = state.originalGeo;
  const s = state.surgery;
  const g = new THREE.BufferGeometry();
  const prov = s ? s.prov : [];

  for (const [name, attr] of Object.entries(src.attributes)) {
    let data;
    if (name === 'position') {
      data = s ? s.positions.slice() : attr.array.slice();
    } else {
      const mode = /skin/i.test(name) ? 'nearest' : 'lerp';
      data = prov.length ? extendAttributeData(attr.array, attr.itemSize, prov, mode)
                         : attr.array.slice();
      if (name === 'normal' && s && s.volume) {
        const front = [0, 0, 0];
        front[state.anchor.fa] = state.anchor.sign;
        data.set(
          computeNormalsFor(s.positions, s.volume.tris, s.preRimCount, s.positions.length / 3, front),
          s.preRimCount * attr.itemSize);
      }
    }
    g.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize, attr.normalized));
  }
  g.setIndex(new THREE.BufferAttribute(
    s ? s.indices.slice() : Uint32Array.from(pristineIndices()), 1));
  for (const grp of src.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  g.morphTargetsRelative = true;

  // carry over any pre-existing morphs, then append ours
  const names = [];
  const dict = mesh.morphTargetDictionary || {};
  const revDict = Object.fromEntries(Object.entries(dict).map(([k, v]) => [v, k]));
  const srcMorphs = (src.morphAttributes.position || []);
  const morphs = srcMorphs.map((a, i) => {
    const data = prov.length ? extendAttributeData(a.array, a.itemSize, prov, 'lerp')
                             : a.array.slice();
    const na = new THREE.BufferAttribute(data, a.itemSize, a.normalized);
    na.name = a.name || revDict[i] || `morph_${i}`;
    names.push(na.name);
    return na;
  });
  const n = g.attributes.position.count;
  for (const nm of ['jawOpen', 'mouthPucker']) {
    const a = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    a.name = nm;
    morphs.push(a);
    names.push(nm);
  }
  g.morphAttributes.position = morphs;
  g.computeBoundingSphere();

  if (mesh.geometry !== state.originalGeo) mesh.geometry.dispose();
  mesh.geometry = g;
  mesh.updateMorphTargets();
  mesh.morphTargetDictionary = Object.fromEntries(names.map((nm, i) => [nm, i]));
  mesh.morphTargetInfluences = names.map(() => 0);
  mesh._facerigJaw = mesh.morphTargetDictionary.jawOpen;
  mesh._facerigPucker = mesh.morphTargetDictionary.mouthPucker;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((mt) => { mt.needsUpdate = true; });

  rebuildPocketPreview();
}

// dark mouth-pocket preview mesh (mirrors the exported pocket primitive)
function rebuildPocketPreview() {
  if (helpers.pocket) { helpers.pocket.removeFromParent(); helpers.pocket.geometry.dispose(); helpers.pocket = null; }
  const s = state.surgery;
  if (!s || !s.volume || !helpers.space) return;
  const pv = s.volume.pocket.verts;
  const pos = new Float32Array(pv.length * 3);
  pv.forEach((v, k) => pos.set(v.pos, k * 3));
  const front = [0, 0, 0];
  front[state.anchor.fa] = state.anchor.sign;
  const nrm = computeNormalsFor(pos, s.volume.pocket.tris, 0, pv.length, front);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(s.volume.pocket.tris.slice(), 1));
  g.morphTargetsRelative = true;
  const jaw = new THREE.BufferAttribute(new Float32Array(pv.length * 3), 3);
  jaw.name = 'jawOpen';
  const puck = new THREE.BufferAttribute(new Float32Array(pv.length * 3), 3);
  puck.name = 'mouthPucker';
  g.morphAttributes.position = [jaw, puck];
  const mat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 1 });
  mat.color.setRGB(...state.cfg.cavity_color.slice(0, 3));
  helpers.pocket = new THREE.Mesh(g, mat);
  helpers.pocket.updateMorphTargets();
  helpers.space.add(helpers.pocket);
}

// ---------------------------------------------------------------------------
// helper visuals
// ---------------------------------------------------------------------------
function buildHelpers(mesh) {
  // find the space where mesh-local coordinates land on the rendered surface
  helpers.space = new THREE.Group();
  helpers.space.matrixAutoUpdate = false;
  let parent = mesh;
  if (mesh.isSkinnedMesh && mesh.skeleton) {
    const bi = mesh.skeleton.bones.findIndex((b) => /head/i.test(b.name));
    if (bi >= 0) {
      parent = mesh.skeleton.bones[bi];
      helpers.space.matrix.copy(mesh.skeleton.boneInverses[bi]);
    }
  }
  parent.add(helpers.space);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  helpers.regionBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeo),
    new THREE.LineBasicMaterial({ color: 0x4da3ff }));
  helpers.regionProxy.add(helpers.regionBox);
  helpers.space.add(helpers.regionProxy);
  syncProxyFromRegion();

  helpers.anchorMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcc33, depthTest: false, transparent: true, opacity: 0.9 }));
  helpers.anchorMarker.renderOrder = 999;
  helpers.space.add(helpers.anchorMarker);

  const sphere = new THREE.IcosahedronGeometry(1, 2);
  helpers.cavity = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({
    side: THREE.BackSide, metalness: 0, roughness: 1 }));
  helpers.tongue = new THREE.Mesh(sphere.clone(), new THREE.MeshStandardMaterial({
    metalness: 0, roughness: 0.8 }));
  helpers.space.add(helpers.cavity, helpers.tongue);
}

function syncProxyFromRegion() {
  const { lo, hi } = state.region;
  helpers.regionProxy.position.set((lo[0]+hi[0])/2, (lo[1]+hi[1])/2, (lo[2]+hi[2])/2);
  helpers.regionProxy.scale.set(
    Math.max(1e-6, hi[0]-lo[0]), Math.max(1e-6, hi[1]-lo[1]), Math.max(1e-6, hi[2]-lo[2]));
}

function syncRegionFromProxy() {
  const p = helpers.regionProxy.position, s = helpers.regionProxy.scale;
  state.region.lo = [p.x - Math.abs(s.x)/2, p.y - Math.abs(s.y)/2, p.z - Math.abs(s.z)/2];
  state.region.hi = [p.x + Math.abs(s.x)/2, p.y + Math.abs(s.y)/2, p.z + Math.abs(s.z)/2];
}

// ---------------------------------------------------------------------------
// recompute: region → bounds → anchor → (cut) → deltas → previews
// ---------------------------------------------------------------------------
function recompute() {
  const mesh = state.mesh;
  if (!mesh) return;
  const pos0 = pristinePositions();

  const hb = boundsInBox(pos0, state.region);
  if (!hb) { setStatus('⚠ Head box contains no vertices — move/scale it onto the head.'); return; }
  state.headBounds = hb;
  state.stats.regionVerts = hb.count;
  state.anchor = mouthAnchor(hb, state.cfg);

  // mouth surgery (recomputed only when the inputs that shape it change)
  const cfg = state.cfg;
  const lipCut = cfg.lip_cut || cfg.lip_rim;
  const sig = lipCut
    ? JSON.stringify([state.anchor.mouth, cfg.lip_cut_width_frac,
                      state.region.lo, state.region.hi, cfg.front_axis, cfg.front_sign,
                      cfg.lip_subdiv, cfg.lip_rim, cfg.rim_depth, cfg.rim_segments,
                      cfg.bevel_width, cfg.bevel_segments, cfg.edge_smooth])
    : 'off';
  if (sig !== state.cutSig) {
    state.cutSig = sig;
    state.surgery = lipCut
      ? mouthSurgery(pos0, pristineIndices(), state.anchor, cfg, state.region)
      : null;
    const c = state.surgery?.counts;
    state.stats.cutAdded = c ? c.dup : 0;
    state.stats.knifeAdded = c ? c.knife : 0;
    state.stats.subdivAdded = c ? c.subdiv : 0;
    state.stats.rimVerts = c ? c.rim : 0;
    rebuildWorkingGeometry();
  }

  const s = state.surgery;
  const preRim = s ? s.preRimCount : pos0.length / 3;
  const core = s ? s.positions.subarray(0, preRim * 3) : pos0;
  const jaw = jawDelta(core, state.anchor, cfg, state.region,
    { lowerMask: s?.mask, hardBelow: lipCut });
  const puck = puckerDelta(core, state.anchor, cfg, state.region);
  state.stats.driven = jaw.driven;
  state.stats.maxOffset = jaw.maxOffset;

  const jawAttr = mesh.geometry.morphAttributes.position[mesh._facerigJaw];
  const puckAttr = mesh.geometry.morphAttributes.position[mesh._facerigPucker];
  jawAttr.array.set(jaw.delta);
  puckAttr.array.set(puck);
  if (s && s.volume) {
    s.volume.verts.forEach((v, k) => {
      const o = (preRim + k) * 3, si = v.src * 3;
      for (let c = 0; c < 3; c++) {
        jawAttr.array[o + c] = jaw.delta[si + c] * v.scale;
        puckAttr.array[o + c] = puck[si + c] * v.scale;
      }
    });
    // pocket preview morphs: scaled copies, same as the exported primitive
    if (helpers.pocket) {
      const [pJaw, pPuck] = helpers.pocket.geometry.morphAttributes.position;
      s.volume.pocket.verts.forEach((v, k) => {
        const si = v.src * 3;
        for (let c = 0; c < 3; c++) {
          pJaw.array[k * 3 + c] = jaw.delta[si + c] * v.scale;
          pPuck.array[k * 3 + c] = puck[si + c] * v.scale;
        }
      });
      pJaw.needsUpdate = true;
      pPuck.needsUpdate = true;
      helpers.pocket.material.color.setRGB(...cfg.cavity_color.slice(0, 3));
    }
  }
  jawAttr.needsUpdate = true;
  puckAttr.needsUpdate = true;

  // helper transforms
  const a = state.anchor;
  helpers.anchorMarker.scale.setScalar(0.02 * a.size[1]);
  helpers.anchorMarker.position.fromArray(a.mouth);
  const place = cavityAndTonguePlacement(a, cfg);
  helpers.cavity.visible = !(s && s.volume); // welded pocket replaces the ellipsoid
  helpers.cavity.position.fromArray(place.cavCenter);
  helpers.cavity.scale.fromArray(place.cavRadii);
  helpers.cavity.rotation.set(...cfg.cavity_rotation_deg.map((d) => d * Math.PI / 180));
  helpers.cavity.material.color.setRGB(...cfg.cavity_color.slice(0, 3));
  helpers.tongue.position.fromArray(place.tonCenter);
  helpers.tongue.scale.fromArray(place.tonRadii);
  helpers.tongue.rotation.set(...cfg.tongue_rotation_deg.map((d) => d * Math.PI / 180));
  helpers.tongue.material.color.setRGB(...cfg.tongue_color.slice(0, 3));

  updateStatsOverlay();
}

// The bbox-front anchor sits at nose-tip depth; snap it back to the actual
// lip surface by writing the front-axis component of mouth_offset_frac.
function snapAnchorToLips() {
  if (!state.mesh || !state.headBounds) return;
  const cfgNoOffset = { ...state.cfg, mouth_offset_frac: [0, 0, 0] };
  const base = mouthAnchor(state.headBounds, cfgNoOffset);
  const off = snapFrontOffsetFrac(pristinePositions(), base, state.region);
  state.cfg.mouth_offset_frac[base.fa] = off;
  recompute();
}

function updateStatsOverlay() {
  const el = document.getElementById('stats');
  const s = state.stats, hb = state.headBounds;
  if (!hb) { el.textContent = ''; return; }
  const h = hb.hi[1] - hb.lo[1];
  const lipCut = state.cfg.lip_cut || state.cfg.lip_rim;
  el.innerHTML =
    `head verts in box: <b>${s.regionVerts}</b> · driven by jaw: <b>${s.driven}</b>` +
    (lipCut ? ` · seam verts: knife <b>${s.knifeAdded}</b> + subdiv <b>${s.subdivAdded}</b> + split <b>${s.cutAdded}</b>` : '') +
    (state.cfg.lip_rim ? ` · rim <b>${s.rimVerts}</b>` : '') + '<br>' +
    `head height: ${h.toFixed(3)} · max open offset: ${s.maxOffset.toFixed(4)} ` +
    `(${(s.maxOffset / h * 100).toFixed(1)}% of head)`;
  if (s.driven === 0) el.innerHTML += '<br>⚠ no vertices driven — check front axis/sign and mouth height';
  if (lipCut && !s.knifeAdded && !s.cutAdded) el.innerHTML += '<br>⚠ no slit created — widen the cut or move the anchor to the lip line';
}

// ---------------------------------------------------------------------------
// export / import
// ---------------------------------------------------------------------------
function buildRiggedGLB() {
  if (!state.mesh) throw new Error('nothing to export');
  const { bytes, stats } = rigGLB(state.originalBuffer, exportConfigObject());
  console.log('rigGLB stats', stats);
  return bytes;
}

function exportConfigObject() {
  const hb = state.headBounds;
  const gltfMesh = state.meshIndex != null ? state.gltfJson.meshes[state.meshIndex] : null;
  return {
    tool: 'facerig-web',
    version: '0.4',
    input: state.fileName,
    head_mesh: gltfMesh ? (gltfMesh.name ?? null) : (state.mesh?.name || null),
    head_mesh_index: state.meshIndex,
    head_region: { lo: [...state.region.lo], hi: [...state.region.hi] },
    head_bounds: hb ? { min: [...hb.lo], max: [...hb.hi] } : null,
    mouth_anchor: state.anchor ? [...state.anchor.mouth] : null,
    config: mergeCfg(state.cfg),
    stats: { ...state.stats },
  };
}

function applyConfigObject(obj) {
  const cfg = obj.config || obj;
  assignCfgInPlace(mergeCfg(cfg));
  if (obj.head_region) {
    state.region.lo = [...obj.head_region.lo];
    state.region.hi = [...obj.head_region.hi];
    syncProxyFromRegion();
  }
  if (state.meshes.length) {
    let target = null;
    if (obj.head_mesh_index != null) {
      target = state.meshes.find((m) => {
        const a = state.gltf.parser.associations.get(m);
        return a && a.meshes === obj.head_mesh_index;
      });
    }
    if (!target && obj.head_mesh) target = state.meshes.find((x) => x.name === obj.head_mesh);
    if (target && target !== state.mesh) selectMesh(target);
  }
  state.cutSig = null; // force geometry rebuild with the imported cut settings
  refreshGui();
  recompute();
}

// mutate state.cfg in place so lil-gui controllers stay bound
function assignCfgInPlace(src) {
  for (const [k, v] of Object.entries(src)) {
    if (Array.isArray(v) && Array.isArray(state.cfg[k])) {
      state.cfg[k].length = 0;
      state.cfg[k].push(...v);
    } else {
      state.cfg[k] = v;
    }
  }
}

function download(bytes, name, type = 'application/octet-stream') {
  const blob = new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function baseName() {
  return (state.fileName || 'model').replace(/\.(glb|gltf)$/i, '');
}

// ---------------------------------------------------------------------------
// GUI
// ---------------------------------------------------------------------------
const gui = new GUI({ title: 'facerig' });
const guiState = {
  mesh: '',
  gizmoMode: 'region: move',
  showHelpers: true,
  xray: false,
  jawOpen: 0,
  pucker: 0,
  audioStrength: driver.strength,
  audioSmoothing: driver.smoothing,
  audioFloor: driver.floor,
  micOn: false,
  elText: 'Guten Tag! Wie kann ich Ihnen helfen?',
  elVoiceId: '',
  elApiKey: '',
};

const fFile = gui.addFolder('File');
fFile.add({ load: () => document.getElementById('fileGlb').click() }, 'load').name('Load GLB…');
fFile.add({ exp: () => {
  try {
    const bytes = buildRiggedGLB();
    const name = `${baseName()}.rigged.glb`;
    download(bytes, name, 'model/gltf-binary');
    idbSet('lastRigged', { name, bytes }).catch(() => {});
    setStatus('Exported rigged GLB — it will auto-open in the game preview');
  }
  catch (e) { setStatus('⚠ ' + e.message); console.error(e); }
} }, 'exp').name('Export rigged GLB');
fFile.add({ exp: () => download(JSON.stringify(exportConfigObject(), null, 2), `${baseName()}.config.json`, 'application/json') }, 'exp').name('Export config JSON');
fFile.add({ imp: () => document.getElementById('fileCfg').click() }, 'imp').name('Import config JSON…');
fFile.add({ pv: () => { window.location.href = './preview.html'; } }, 'pv').name('Open game preview →');

const fHead = gui.addFolder('Head region');
const onMeshPick = (label) => {
  const m = state.meshes.find((x) => meshLabel(x) === label);
  if (m) selectMesh(m);
};
let meshCtrl = fHead.add(guiState, 'mesh', []).name('head mesh').onChange(onMeshPick);
fHead.add(guiState, 'gizmoMode', ['off', 'region: move', 'region: scale', 'mouth anchor']).name('gizmo').onChange(applyGizmoMode);
fHead.add({ re: () => { const g = guessHeadBox(pristinePositions()); state.region.lo = g.lo; state.region.hi = g.hi; syncProxyFromRegion(); recompute(); snapAnchorToLips(); } }, 're').name('Re-guess head box');
fHead.add({ sn: () => snapAnchorToLips() }, 'sn').name('Snap anchor to lips');
fHead.add({ fr: () => frameRegion() }, 'fr').name('Frame head');

const fOrient = gui.addFolder('Orientation');
fOrient.add(state.cfg, 'front_axis', ['x', 'y', 'z']).name('front axis').onChange(recompute).listen();
fOrient.add(state.cfg, 'front_sign', { '+1': 1, '-1': -1 }).name('front sign').onChange((v) => { state.cfg.front_sign = Number(v); recompute(); }).listen();

const fJaw = gui.addFolder('Mouth / jaw');
fJaw.add(state.cfg, 'lip_cut').name('lip cut (open mouth)').onChange(recompute).listen();
fJaw.add(state.cfg, 'lip_cut_width_frac', 0.1, 1, 0.01).name('cut width').onChange(recompute).listen();
fJaw.add(state.cfg, 'lip_subdiv', 1, 6, 1).name('seam subdiv').onChange(recompute).listen();
fJaw.add(state.cfg, 'lip_rim').name('volumetric lips (rim)').onChange((v) => {
  if (v && !state.cfg.lip_cut) { state.cfg.lip_cut = true; refreshGui(); }
  recompute();
}).listen();
fJaw.add(state.cfg, 'rim_depth', 0.02, 0.3, 0.005).name('rim depth').onChange(recompute).listen();
fJaw.add(state.cfg, 'rim_segments', 1, 4, 1).name('rim segments').onChange(recompute).listen();
fJaw.add(state.cfg, 'bevel_width', 0, 0.08, 0.002).name('bevel width').onChange(recompute).listen();
fJaw.add(state.cfg, 'bevel_segments', 0, 3, 1).name('bevel segments').onChange(recompute).listen();
fJaw.add(state.cfg, 'edge_smooth', 0, 8, 1).name('edge smooth').onChange(recompute).listen();
fJaw.add(state.cfg, 'mouth_height_frac', 0, 1, 0.005).name('mouth height').onChange(recompute).listen();
fJaw.add(state.cfg, 'mouth_region_frac', 0.02, 0.6, 0.005).name('region σ').onChange(recompute).listen();
fJaw.add(state.cfg, 'jaw_strength_frac', 0, 0.5, 0.005).name('jaw strength').onChange(recompute).listen();
fJaw.add(state.cfg, 'jaw_forward', -0.5, 1, 0.01).name('jaw forward').onChange(recompute).listen();
fJaw.add(state.cfg, 'region_falloff_frac', 0.005, 0.3, 0.005).name('edge falloff').onChange(recompute).listen();

const fPuck = gui.addFolder('Pucker (o/u lips)');
fPuck.add(state.cfg, 'add_pucker').name('export mouthPucker').onChange(recompute).listen();
fPuck.add(state.cfg, 'pucker_strength', 0, 1, 0.01).name('strength').onChange(recompute).listen();
fPuck.add(state.cfg, 'pucker_forward_frac', 0, 0.2, 0.005).name('forward push').onChange(recompute).listen();
fPuck.close();

const fCav = gui.addFolder('Cavity');
fCav.add(state.cfg, 'cavity_depth_frac', 0, 1, 0.01).name('depth').onChange(recompute).listen();
['x','y','z'].forEach((ax, i) => {
  fCav.add(state.cfg.cavity_scale, i, 0.01, 1, 0.005).name(`scale ${ax}`).onChange(recompute).listen();
});
['x','y','z'].forEach((ax, i) => {
  fCav.add(state.cfg.cavity_offset_frac, i, -0.5, 0.5, 0.005).name(`offset ${ax}`).onChange(recompute).listen();
});
['x','y','z'].forEach((ax, i) => {
  fCav.add(state.cfg.cavity_rotation_deg, i, -90, 90, 1).name(`rotate ${ax}°`).onChange(recompute).listen();
});

const fTon = gui.addFolder('Tongue');
['x','y','z'].forEach((ax, i) => {
  fTon.add(state.cfg.tongue_scale, i, 0.01, 0.6, 0.005).name(`scale ${ax}`).onChange(recompute).listen();
});
['x','y','z'].forEach((ax, i) => {
  fTon.add(state.cfg.tongue_offset_frac, i, -0.5, 0.5, 0.005).name(`offset ${ax}`).onChange(recompute).listen();
});
['x','y','z'].forEach((ax, i) => {
  fTon.add(state.cfg.tongue_rotation_deg, i, -90, 90, 1).name(`rotate ${ax}°`).onChange(recompute).listen();
});
fTon.close();

const fPrev = gui.addFolder('Preview');
fPrev.add(guiState, 'jawOpen', 0, 1, 0.01).name('jawOpen').listen().onChange((v) => { state.jawOpen = v; });
fPrev.add(guiState, 'pucker', 0, 1, 0.01).name('mouthPucker').onChange((v) => { state.pucker = v; });
fPrev.add(guiState, 'showHelpers').name('show gizmos').onChange((v) => {
  for (const k of ['regionBox', 'anchorMarker']) if (helpers[k]) helpers[k].visible = v;
  helpers.regionProxy.visible = v;
});
fPrev.add(guiState, 'xray').name('x-ray head').onChange((v) => {
  if (!state.mesh) return;
  const mats = Array.isArray(state.mesh.material) ? state.mesh.material : [state.mesh.material];
  mats.forEach((mt) => { mt.transparent = v; mt.opacity = v ? 0.45 : 1; mt.depthWrite = !v; mt.needsUpdate = true; });
});

const fAudio = gui.addFolder('Audio test');
fAudio.add({ p: () => document.getElementById('fileAudio').click() }, 'p').name('Play audio file…');
fAudio.add(guiState, 'micOn').name('microphone').onChange(async (v) => {
  try { if (v) await driver.micOn(); else driver.micOff(); }
  catch (e) { guiState.micOn = false; setStatus('⚠ mic: ' + e.message); }
});
fAudio.add(guiState, 'audioStrength', 0.2, 5, 0.05).name('strength').onChange((v) => { driver.strength = v; });
fAudio.add(guiState, 'audioSmoothing', 0, 0.95, 0.01).name('smoothing').onChange((v) => { driver.smoothing = v; });
fAudio.add(guiState, 'audioFloor', 0, 0.3, 0.005).name('noise floor').onChange((v) => { driver.floor = v; });
const fEl = fAudio.addFolder('ElevenLabs');
fEl.add(guiState, 'elText').name('text');
fEl.add(guiState, 'elVoiceId').name('voice id');
fEl.add(guiState, 'elApiKey').name('api key (optional)');
fEl.add({ s: async () => {
  try {
    state.audioDrives = true;
    if (guiState.elApiKey) {
      await driver.speakFromElevenLabs(guiState.elText, guiState.elVoiceId, guiState.elApiKey);
    } else {
      await driver.speakViaProxy(guiState.elText, guiState.elVoiceId); // server-side key
    }
  } catch (e) { setStatus('⚠ ' + e.message); }
  finally { state.audioDrives = false; }
} }, 's').name('Speak');
fEl.close();
fAudio.close();

function rebuildMeshDropdown() {
  const labels = state.meshes.map(meshLabel);
  // lil-gui's options() destroys the old controller and returns a new one
  meshCtrl = meshCtrl.options(labels).name('head mesh').onChange(onMeshPick);
}

function refreshGui() {
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

function applyGizmoMode() {
  gizmo.detach();
  if (!state.mesh) return;
  switch (guiState.gizmoMode) {
    case 'region: move': gizmo.attach(helpers.regionProxy); gizmo.setMode('translate'); break;
    case 'region: scale': gizmo.attach(helpers.regionProxy); gizmo.setMode('scale'); break;
    case 'mouth anchor': gizmo.attach(helpers.anchorMarker); gizmo.setMode('translate'); break;
    default: break;
  }
}
gizmo.addEventListener('objectChange', () => {
  if (gizmo.object === helpers.regionProxy) {
    syncRegionFromProxy();
    recompute();
  } else if (gizmo.object === helpers.anchorMarker && state.headBounds) {
    const p = helpers.anchorMarker.position;
    const hb = state.headBounds, cfg = state.cfg;
    const size = [hb.hi[0]-hb.lo[0], hb.hi[1]-hb.lo[1], hb.hi[2]-hb.lo[2]];
    cfg.mouth_height_frac = (p.y - hb.lo[1]) / Math.max(1e-9, size[1]);
    cfg.mouth_offset_frac = [0, 0, 0];
    const base = mouthAnchor(hb, { ...cfg, mouth_offset_frac: [0, 0, 0] }).mouth;
    const pArr = [p.x, p.y, p.z];
    for (const i of [0, 1, 2]) {
      if (i === 1) continue;
      cfg.mouth_offset_frac[i] = (pArr[i] - base[i]) / Math.max(1e-9, size[i]);
    }
    recompute();
  }
});

// ---------------------------------------------------------------------------
// file inputs + drag & drop + dblclick pick
// ---------------------------------------------------------------------------
document.getElementById('fileGlb').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) await loadArrayBuffer(await f.arrayBuffer(), f.name);
  e.target.value = '';
});
document.getElementById('fileCfg').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) { applyConfigObject(JSON.parse(await f.text())); setStatus(`Config ${f.name} applied`); }
  e.target.value = '';
});
document.getElementById('fileAudio').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) {
    state.audioDrives = true;
    try { await driver.playFile(f); } finally { state.audioDrives = false; }
  }
  e.target.value = '';
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = [...e.dataTransfer.files].find((x) => /\.(glb|gltf)$/i.test(x.name));
  if (f) await loadArrayBuffer(await f.arrayBuffer(), f.name);
  const c = [...e.dataTransfer.files].find((x) => /\.json$/i.test(x.name));
  if (c) applyConfigObject(JSON.parse(await c.text()));
  const a = [...e.dataTransfer.files].find((x) => /\.(mp3|wav|ogg|m4a)$/i.test(x.name));
  if (a) { state.audioDrives = true; driver.playFile(a).finally(() => { state.audioDrives = false; }); }
});

const raycaster = new THREE.Raycaster();
canvas.addEventListener('dblclick', (e) => {
  if (!state.meshes.length) return;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(state.meshes, false)[0];
  if (hit) { selectMesh(hit.object); guiState.mesh = meshLabel(hit.object); meshCtrl.updateDisplay(); }
});

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------
function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function frameObject(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3()).length();
  orbit.target.copy(c);
  camera.position.copy(c).add(new THREE.Vector3(0.3, 0.15, 1).normalize().multiplyScalar(s * 0.9));
}

function frameRegion() {
  if (!state.mesh || !helpers.space) return;
  const { lo, hi } = state.region;
  const local = new THREE.Box3(new THREE.Vector3(...lo), new THREE.Vector3(...hi));
  helpers.space.updateWorldMatrix(true, false);
  const world = local.applyMatrix4(helpers.space.matrixWorld);
  const c = world.getCenter(new THREE.Vector3());
  const s = world.getSize(new THREE.Vector3()).length();
  orbit.target.copy(c);
  const dir = new THREE.Vector3();
  dir.setComponent({ x: 0, y: 1, z: 2 }[state.cfg.front_axis], state.cfg.front_sign);
  if (state.cfg.front_axis === 'y') dir.z += 0.3;
  camera.position.copy(c).add(dir.normalize().multiplyScalar(s * 1.6));
}

function tick() {
  requestAnimationFrame(tick);
  const audioVal = driver.update();
  const m = state.mesh;
  if (m && m._facerigJaw != null && m.morphTargetInfluences) {
    const v = state.audioDrives || guiState.micOn ? audioVal : state.jawOpen;
    m.morphTargetInfluences[m._facerigJaw] = v;
    m.morphTargetInfluences[m._facerigPucker] = state.pucker;
    if (helpers.pocket && helpers.pocket.morphTargetInfluences) {
      helpers.pocket.morphTargetInfluences[0] = v;
      helpers.pocket.morphTargetInfluences[1] = state.pucker;
    }
    if (state.audioDrives || guiState.micOn) guiState.jawOpen = v;
  }
  orbit.update();
  renderer.render(scene, camera);
}
resize();
applyGizmoMode();
tick();
setStatus('Drop a GLB here (or File → Load GLB…) to start.');

// ---------------------------------------------------------------------------
// automation / test hooks
// ---------------------------------------------------------------------------
window.__facerig = {
  loadArrayBuffer,
  state,
  selectMeshByName: (name) => {
    const m = state.meshes.find((x) => x.name === name);
    if (m) selectMesh(m);
    return !!m;
  },
  setRegionBox: (lo, hi) => { state.region.lo = [...lo]; state.region.hi = [...hi]; syncProxyFromRegion(); recompute(); },
  setConfig: (partial) => { assignCfgInPlace(mergeCfg({ ...state.cfg, ...partial })); refreshGui(); recompute(); },
  setJawOpen: (v) => { state.jawOpen = v; guiState.jawOpen = v; },
  setPucker: (v) => { state.pucker = v; guiState.pucker = v; },
  snapAnchorToLips,
  exportGLB: () => buildRiggedGLB(),
  exportConfig: exportConfigObject,
  applyConfig: applyConfigObject,
  recompute,
  frameRegion,
  setHelpersVisible: (v) => {
    for (const k of ['regionBox', 'anchorMarker']) if (helpers[k]) helpers[k].visible = v;
    helpers.regionProxy.visible = v;
    gizmo.detach();
  },
};
