// main.js — facerig-web: visual calibration tool for jaw-open lip-sync rigs.
// Load a (full-body) GLB → isolate the head with a box → tune the config with
// live preview → export a rigged GLB (jawOpen morph + cavity + tongue) and a
// config JSON compatible with facerig.py.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import {
  DEFAULT_CFG, mergeCfg, mouthAnchor, jawDelta,
  cavityAndTonguePlacement, boundsInBox, guessHeadBox, snapFrontOffsetFrac,
} from './facerig-core.js';
import { GLBPatcher, findHeadJointNode } from './glb-io.js';
import { AmplitudeDriver } from './audio-drive.js';

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
  root: null,               // loaded scene root
  meshes: [],               // candidate THREE.Mesh list
  mesh: null,               // selected head-owning mesh
  cfg: mergeCfg(),
  region: { lo: [0, 0, 0], hi: [0, 0, 0] },
  anchor: null,             // {mouth,size,fa,sign} — derived, in mesh local space
  headBounds: null,
  delta: null,              // Float32Array for selected mesh
  stats: { driven: 0, regionVerts: 0, maxOffset: 0 },
  jawOpen: 0,
  audioDrives: false,       // when audio plays, it overrides the slider
};

// preview helper objects (all children of the selected mesh → mesh-local space)
const helpers = {
  regionProxy: new THREE.Object3D(),      // position=box center, scale=box size
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
  state.gltf = gltf;
  state.root = gltf.scene;
  scene.add(gltf.scene);

  state.meshes = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) state.meshes.push(o);
  });
  if (!state.meshes.length) { setStatus('No meshes found in GLB'); return; }

  // default: the mesh with the most vertices (the body / merged model)
  const biggest = state.meshes.reduce((a, b) =>
    (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
  rebuildMeshDropdown();
  selectMesh(biggest);
  frameObject(gltf.scene);
  setStatus(`Loaded ${name}: ${state.meshes.length} mesh(es). Head box auto-guessed — adjust it, then tune the mouth.`);
}

function clearModel() {
  if (state.root) scene.remove(state.root);
  gizmo.detach();
  for (const k of ['regionBox', 'anchorMarker', 'cavity', 'tongue']) {
    if (helpers[k]) { helpers[k].removeFromParent(); helpers[k] = null; }
  }
  helpers.regionProxy.removeFromParent();
  Object.assign(state, {
    gltf: null, root: null, meshes: [], mesh: null,
    anchor: null, headBounds: null, delta: null,
  });
}

function selectMesh(mesh) {
  if (state.mesh === mesh) return;
  // clean helpers off the previous mesh
  for (const k of ['regionBox', 'anchorMarker', 'cavity', 'tongue']) {
    if (helpers[k]) { helpers[k].removeFromParent(); helpers[k] = null; }
  }
  helpers.regionProxy.removeFromParent();
  if (state.mesh) removePreviewMorph(state.mesh);

  state.mesh = mesh;
  guiState.mesh = meshLabel(mesh);

  const pos = mesh.geometry.attributes.position.array;
  const guess = guessHeadBox(pos);
  state.region.lo = guess.lo; state.region.hi = guess.hi;

  buildHelpers(mesh);
  ensurePreviewMorph(mesh);
  recompute();
  snapAnchorToLips(); // pull the anchor off the nose-tip plane onto the lips
}

// The bbox-front anchor sits at nose-tip depth; snap it back to the actual
// lip surface by writing the front-axis component of mouth_offset_frac.
function snapAnchorToLips() {
  if (!state.mesh || !state.headBounds) return;
  const pos = state.mesh.geometry.attributes.position.array;
  const cfgNoOffset = { ...state.cfg, mouth_offset_frac: [0, 0, 0] };
  const base = mouthAnchor(state.headBounds, cfgNoOffset);
  const off = snapFrontOffsetFrac(pos, base, state.region);
  state.cfg.mouth_offset_frac[base.fa] = off;
  recompute();
}

function meshLabel(m) {
  const c = m.geometry.attributes.position.count;
  return `${m.name || '(unnamed)'} · ${c}v`;
}

// ---------------------------------------------------------------------------
// preview morph target (live jawOpen on the three.js mesh)
// ---------------------------------------------------------------------------
function ensurePreviewMorph(mesh) {
  const geo = mesh.geometry;
  const n = geo.attributes.position.count;
  geo.morphTargetsRelative = true;
  const attr = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
  geo.morphAttributes.position = [...(geo.morphAttributes.position || []), attr];
  mesh.updateMorphTargets();
  mesh.morphTargetDictionary = mesh.morphTargetDictionary || {};
  mesh.morphTargetDictionary.jawOpen = geo.morphAttributes.position.length - 1;
  mesh.material.needsUpdate = true;
  mesh._facerigMorphIndex = mesh.morphTargetDictionary.jawOpen;
}

function removePreviewMorph(mesh) {
  const geo = mesh.geometry;
  const i = mesh._facerigMorphIndex;
  if (i == null) return;
  geo.morphAttributes.position.splice(i, 1);
  if (!geo.morphAttributes.position.length) delete geo.morphAttributes.position;
  mesh.updateMorphTargets();
  mesh.material.needsUpdate = true;
  delete mesh._facerigMorphIndex;
}

// ---------------------------------------------------------------------------
// helper visuals (region box, anchor marker, cavity + tongue preview)
// ---------------------------------------------------------------------------
function buildHelpers(mesh) {
  // region box: unit wireframe cube scaled/positioned via regionProxy
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  helpers.regionBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeo),
    new THREE.LineBasicMaterial({ color: 0x4da3ff }));
  helpers.regionProxy.add(helpers.regionBox);
  mesh.add(helpers.regionProxy);
  syncProxyFromRegion();

  helpers.anchorMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcc33, depthTest: false, transparent: true, opacity: 0.9 }));
  helpers.anchorMarker.renderOrder = 999;
  mesh.add(helpers.anchorMarker);

  const sphere = mergeVertices(new THREE.IcosahedronGeometry(1, 2));
  helpers.cavity = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({
    side: THREE.BackSide, metalness: 0, roughness: 1 }));
  helpers.tongue = new THREE.Mesh(sphere.clone(), new THREE.MeshStandardMaterial({
    metalness: 0, roughness: 0.8 }));
  mesh.add(helpers.cavity, helpers.tongue);
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
// the core recompute: region → head bounds → anchor → jaw delta → previews
// ---------------------------------------------------------------------------
function recompute() {
  const mesh = state.mesh;
  if (!mesh) return;
  const pos = mesh.geometry.attributes.position.array;

  const hb = boundsInBox(pos, state.region);
  if (!hb) { setStatus('⚠ Head box contains no vertices — move/scale it onto the head.'); return; }
  state.headBounds = hb;
  state.stats.regionVerts = hb.count;

  state.anchor = mouthAnchor(hb, state.cfg);
  const { delta, driven, maxOffset } = jawDelta(pos, state.anchor, state.cfg, state.region);
  state.delta = delta;
  state.stats.driven = driven;
  state.stats.maxOffset = maxOffset;

  // write into the live morph attribute
  const attr = mesh.geometry.morphAttributes.position[mesh._facerigMorphIndex];
  attr.array.set(delta);
  attr.needsUpdate = true;

  // anchor marker + cavity + tongue previews
  const a = state.anchor;
  const markerR = 0.02 * a.size[1];
  helpers.anchorMarker.scale.setScalar(markerR);
  helpers.anchorMarker.position.fromArray(a.mouth);

  const place = cavityAndTonguePlacement(a, state.cfg);
  helpers.cavity.position.fromArray(place.cavCenter);
  helpers.cavity.scale.fromArray(place.cavRadii);
  helpers.cavity.material.color.setRGB(...state.cfg.cavity_color.slice(0, 3));
  helpers.tongue.position.fromArray(place.tonCenter);
  helpers.tongue.scale.fromArray(place.tonRadii);
  helpers.tongue.material.color.setRGB(...state.cfg.tongue_color.slice(0, 3));

  updateStatsOverlay();
}

function updateStatsOverlay() {
  const el = document.getElementById('stats');
  const s = state.stats, hb = state.headBounds;
  if (!hb) { el.textContent = ''; return; }
  const h = (hb.hi[1] - hb.lo[1]).toFixed(3);
  el.innerHTML =
    `head verts in box: <b>${s.regionVerts}</b> · driven by jaw: <b>${s.driven}</b><br>` +
    `head height: ${h} · max open offset: ${s.maxOffset.toFixed(4)} ` +
    `(${(s.maxOffset / (hb.hi[1] - hb.lo[1]) * 100).toFixed(1)}% of head)`;
  if (s.driven === 0) el.innerHTML += '<br>⚠ no vertices driven — check front axis/sign and mouth height';
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------
function buildRiggedGLB() {
  if (!state.mesh || !state.delta) throw new Error('nothing to export');
  const assoc = state.gltf.parser.associations.get(state.mesh);
  if (!assoc || assoc.meshes == null) throw new Error('cannot map selected mesh back to glTF (unsupported asset)');
  const meshIndex = assoc.meshes;

  const patcher = new GLBPatcher(state.originalBuffer);
  const gMesh = patcher.json.meshes[meshIndex];

  // one delta per primitive of the glTF mesh (three splits primitives into
  // sibling Mesh objects; compute each from its own positions, same anchor)
  const primDeltas = gMesh.primitives.map((prim, primIndex) => {
    let threeMesh = null;
    state.gltf.parser.associations.forEach((v, obj) => {
      if (obj.isMesh && v.meshes === meshIndex && (v.primitives ?? 0) === primIndex) threeMesh = obj;
    });
    if (threeMesh === state.mesh) return state.delta;
    if (!threeMesh) {
      const count = patcher.json.accessors[prim.attributes.POSITION].count;
      return new Float32Array(count * 3);
    }
    const pos = threeMesh.geometry.attributes.position.array;
    return jawDelta(pos, state.anchor, state.cfg, state.region).delta;
  });
  patcher.addJawOpenMorph(meshIndex, primDeltas);

  // cavity + tongue geometry, baked into mesh-local space
  const place = cavityAndTonguePlacement(state.anchor, state.cfg);
  const cavGeo = bakeEllipsoid(place.cavCenter, place.cavRadii, true);
  const tonGeo = bakeEllipsoid(place.tonCenter, place.tonRadii, false);

  const cavMat = patcher.addMaterial('cavity', state.cfg.cavity_color, { roughness: 1 });
  const tonMat = patcher.addMaterial('tongue', state.cfg.tongue_color, { roughness: 0.8 });

  // parent under the head joint when the model is skinned (so the mouth props
  // follow mixamo head motion); otherwise under the scene root.
  const headJoint = findHeadJointNode(patcher.json, meshIndex);
  state.mesh.updateWorldMatrix(true, false);
  let matrix = state.mesh.matrixWorld.clone();
  if (headJoint != null) {
    let jointObj = null;
    state.gltf.parser.associations.forEach((v, obj) => {
      if (v.nodes === headJoint) jointObj = obj;
    });
    if (jointObj) {
      jointObj.updateWorldMatrix(true, false);
      matrix = new THREE.Matrix4().copy(jointObj.matrixWorld).invert().multiply(state.mesh.matrixWorld);
    }
  }
  const m = matrix.elements;
  patcher.addMeshNode('MouthCavity', cavGeo, cavMat, { parentNode: headJoint, matrix: m });
  patcher.addMeshNode('Tongue', tonGeo, tonMat, { parentNode: headJoint, matrix: m });

  return patcher.build();
}

// unit icosphere → ellipsoid at center with per-axis radii; flipped = normals
// point inward (mouth cavity), implemented as reversed winding + negated normals.
function bakeEllipsoid(center, radii, flipped) {
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 2));
  const src = geo.attributes.position;
  const n = src.count;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = src.getX(i), y = src.getY(i), z = src.getZ(i);
    positions[i*3]   = center[0] + radii[0] * x;
    positions[i*3+1] = center[1] + radii[1] * y;
    positions[i*3+2] = center[2] + radii[2] * z;
    // normal of a scaled sphere = position ∘ (1/r), renormalized
    let nx = x / radii[0], ny = y / radii[1], nz = z / radii[2];
    const len = Math.hypot(nx, ny, nz) || 1;
    const s = (flipped ? -1 : 1) / len;
    normals[i*3] = nx*s; normals[i*3+1] = ny*s; normals[i*3+2] = nz*s;
  }
  const srcIdx = geo.index.array;
  const indices = new Array(srcIdx.length);
  for (let i = 0; i < srcIdx.length; i += 3) {
    if (flipped) { indices[i] = srcIdx[i]; indices[i+1] = srcIdx[i+2]; indices[i+2] = srcIdx[i+1]; }
    else { indices[i] = srcIdx[i]; indices[i+1] = srcIdx[i+1]; indices[i+2] = srcIdx[i+2]; }
  }
  return { positions, normals, indices };
}

function exportConfigObject() {
  const hb = state.headBounds;
  return {
    tool: 'facerig-web',
    version: '0.2',
    input: state.fileName,
    head_mesh: state.mesh ? (state.mesh.name || null) : null,
    head_region: { lo: [...state.region.lo], hi: [...state.region.hi] },
    head_bounds: hb ? { min: [...hb.lo], max: [...hb.hi] } : null,
    mouth_anchor: state.anchor ? [...state.anchor.mouth] : null,
    config: { ...state.cfg,
      mouth_offset_frac: [...state.cfg.mouth_offset_frac],
      cavity_offset_frac: [...state.cfg.cavity_offset_frac],
      tongue_offset_frac: [...state.cfg.tongue_offset_frac],
      cavity_scale: [...state.cfg.cavity_scale],
      tongue_scale: [...state.cfg.tongue_scale],
      cavity_color: [...state.cfg.cavity_color],
      tongue_color: [...state.cfg.tongue_color] },
    stats: { ...state.stats },
  };
}

function applyConfigObject(obj) {
  const cfg = obj.config || obj; // accept both a full report and a bare config
  state.cfg = mergeCfg(cfg);
  if (obj.head_region) {
    state.region.lo = [...obj.head_region.lo];
    state.region.hi = [...obj.head_region.hi];
    syncProxyFromRegion();
  }
  if (obj.head_mesh && state.meshes.length) {
    const m = state.meshes.find((x) => x.name === obj.head_mesh);
    if (m) selectMesh(m);
  }
  refreshGuiFromCfg();
  recompute();
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
  try { download(buildRiggedGLB(), `${baseName()}.rigged.glb`, 'model/gltf-binary'); setStatus('Exported rigged GLB'); }
  catch (e) { setStatus('⚠ ' + e.message); console.error(e); }
} }, 'exp').name('Export rigged GLB');
fFile.add({ exp: () => download(JSON.stringify(exportConfigObject(), null, 2), `${baseName()}.config.json`, 'application/json') }, 'exp').name('Export config JSON');
fFile.add({ imp: () => document.getElementById('fileCfg').click() }, 'imp').name('Import config JSON…');

const fHead = gui.addFolder('Head region');
const onMeshPick = (label) => {
  const m = state.meshes.find((x) => meshLabel(x) === label);
  if (m) selectMesh(m);
};
let meshCtrl = fHead.add(guiState, 'mesh', []).name('head mesh').onChange(onMeshPick);
fHead.add(guiState, 'gizmoMode', ['off', 'region: move', 'region: scale', 'mouth anchor']).name('gizmo').onChange(applyGizmoMode);
fHead.add({ re: () => { const g = guessHeadBox(state.mesh.geometry.attributes.position.array); state.region.lo = g.lo; state.region.hi = g.hi; syncProxyFromRegion(); recompute(); snapAnchorToLips(); } }, 're').name('Re-guess head box');
fHead.add({ sn: () => snapAnchorToLips() }, 'sn').name('Snap anchor to lips');
fHead.add({ fr: () => frameRegion() }, 'fr').name('Frame head');

const fOrient = gui.addFolder('Orientation');
fOrient.add(state.cfg, 'front_axis', ['x', 'y', 'z']).name('front axis').onChange(recompute).listen();
fOrient.add(state.cfg, 'front_sign', { '+1': 1, '-1': -1 }).name('front sign').onChange((v) => { state.cfg.front_sign = Number(v); recompute(); }).listen();

const fJaw = gui.addFolder('Mouth / jaw');
fJaw.add(state.cfg, 'mouth_height_frac', 0, 1, 0.005).name('mouth height').onChange(recompute).listen();
fJaw.add(state.cfg, 'mouth_region_frac', 0.02, 0.6, 0.005).name('region σ').onChange(recompute).listen();
fJaw.add(state.cfg, 'jaw_strength_frac', 0, 0.5, 0.005).name('jaw strength').onChange(recompute).listen();
fJaw.add(state.cfg, 'jaw_forward', -0.5, 1, 0.01).name('jaw forward').onChange(recompute).listen();
fJaw.add(state.cfg, 'region_falloff_frac', 0.005, 0.3, 0.005).name('edge falloff').onChange(recompute).listen();

const fCav = gui.addFolder('Cavity');
fCav.add(state.cfg, 'cavity_depth_frac', 0, 1, 0.01).name('depth').onChange(recompute).listen();
['x','y','z'].forEach((ax, i) => {
  fCav.add(state.cfg.cavity_scale, i, 0.01, 1, 0.005).name(`scale ${ax}`).onChange(recompute).listen();
});
['x','y','z'].forEach((ax, i) => {
  fCav.add(state.cfg.cavity_offset_frac, i, -0.5, 0.5, 0.005).name(`offset ${ax}`).onChange(recompute).listen();
});

const fTon = gui.addFolder('Tongue');
['x','y','z'].forEach((ax, i) => {
  fTon.add(state.cfg.tongue_scale, i, 0.01, 0.6, 0.005).name(`scale ${ax}`).onChange(recompute).listen();
});
['x','y','z'].forEach((ax, i) => {
  fTon.add(state.cfg.tongue_offset_frac, i, -0.5, 0.5, 0.005).name(`offset ${ax}`).onChange(recompute).listen();
});
fTon.close();

const fPrev = gui.addFolder('Preview');
fPrev.add(guiState, 'jawOpen', 0, 1, 0.01).name('jawOpen').listen().onChange((v) => { state.jawOpen = v; });
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
fEl.add(guiState, 'elApiKey').name('api key');
fEl.add({ s: async () => {
  try {
    state.audioDrives = true;
    await driver.speakFromElevenLabs(guiState.elText, guiState.elVoiceId, guiState.elApiKey);
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

function refreshGuiFromCfg() {
  // re-bind controllers that point at replaced cfg object
  fOrient.controllers.concat(fJaw.controllers, fCav.controllers, fTon.controllers)
    .forEach((c) => { c.object = pickCfgObject(c); c.updateDisplay(); });
}
function pickCfgObject(c) {
  if (['front_axis','front_sign'].includes(c.property)) return state.cfg;
  if (typeof c.property === 'number') {
    // array controllers: match by parent folder
    if (c.parent === fCav) return c._name?.startsWith('offset') ? state.cfg.cavity_offset_frac : state.cfg.cavity_scale;
    if (c.parent === fTon) return c._name?.startsWith('offset') ? state.cfg.tongue_offset_frac : state.cfg.tongue_scale;
  }
  return state.cfg;
}

// gizmo modes
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
    // dragging the anchor writes mouth_height_frac (y) + lateral offsets (x, z)
    const p = helpers.anchorMarker.position;
    const hb = state.headBounds, cfg = state.cfg;
    const size = [hb.hi[0]-hb.lo[0], hb.hi[1]-hb.lo[1], hb.hi[2]-hb.lo[2]];
    const fa = { x: 0, y: 1, z: 2 }[cfg.front_axis];
    cfg.mouth_height_frac = (p.y - hb.lo[1]) / Math.max(1e-9, size[1]);
    cfg.mouth_offset_frac = [0, 0, 0];
    const base = mouthAnchor(hb, { ...cfg, mouth_offset_frac: [0, 0, 0] }).mouth;
    const pArr = [p.x, p.y, p.z];
    for (const i of [0, 1, 2]) {
      if (i === 1) continue; // vertical handled by height frac
      cfg.mouth_offset_frac[i] = (pArr[i] - base[i]) / Math.max(1e-9, size[i]);
    }
    recompute();
  }
});

// ---------------------------------------------------------------------------
// file inputs + drag & drop
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

// double-click a mesh in the viewport to make it the head mesh
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
  if (!state.mesh) return;
  const { lo, hi } = state.region;
  const local = new THREE.Box3(new THREE.Vector3(...lo), new THREE.Vector3(...hi));
  state.mesh.updateWorldMatrix(true, false);
  const world = local.applyMatrix4(state.mesh.matrixWorld);
  const c = world.getCenter(new THREE.Vector3());
  const s = world.getSize(new THREE.Vector3()).length();
  orbit.target.copy(c);
  const dir = new THREE.Vector3();
  dir.setComponent({ x: 0, y: 1, z: 2 }[state.cfg.front_axis], state.cfg.front_sign);
  if (state.cfg.front_axis === 'y') dir.z += 0.3;
  camera.position.copy(c).add(dir.normalize().multiplyScalar(s * 1.6));
}

// render loop
function tick() {
  requestAnimationFrame(tick);
  const audioVal = driver.update();
  if (state.mesh && state.mesh._facerigMorphIndex != null) {
    const v = state.audioDrives || guiState.micOn ? audioVal : state.jawOpen;
    state.mesh.morphTargetInfluences[state.mesh._facerigMorphIndex] = v;
    if (state.audioDrives || guiState.micOn) { guiState.jawOpen = v; }
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
  setConfig: (partial) => { state.cfg = mergeCfg({ ...state.cfg, ...partial }); refreshGuiFromCfg(); recompute(); },
  setJawOpen: (v) => { state.jawOpen = v; guiState.jawOpen = v; },
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
