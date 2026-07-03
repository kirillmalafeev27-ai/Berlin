// preview.js — "real conditions" page: a rigged character on a game-like
// stage, a text bar, and ElevenLabs TTS with viseme-refined lip-sync via
// lipsync-runtime.js (the exact code the game will use).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CharacterMouth } from './lipsync-runtime.js';
import { idbGet } from './idb-store.js';

const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x191d23);
scene.fog = new THREE.Fog(0x191d23, 6, 14);

const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x33302a, 1.1));
const keyLight = new THREE.DirectionalLight(0xfff1de, 2.4);
keyLight.position.set(1.6, 3, 2.4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);
const rim = new THREE.DirectionalLight(0x88b8ff, 1.2);
rim.position.set(-2, 2, -2);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(3.2, 48),
  new THREE.MeshStandardMaterial({ color: 0x232830, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
const loader = new GLTFLoader();
let mouth = null;
let root = null;
let bones = { head: null, neck: null, spine: null };
let speaking = false;

function setStatus(t) { document.getElementById('status').textContent = t; }
function setSubtitle(t) { document.getElementById('subtitle').textContent = t; }

async function loadModel(buf, name = 'model.glb') {
  const gltf = await new Promise((res, rej) => loader.parse(buf.slice(0), '', res, rej));
  if (root) scene.remove(root);
  root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    if (o.isBone) {
      if (/head/i.test(o.name) && !/end/i.test(o.name)) bones.head = o;
      else if (/neck/i.test(o.name)) bones.neck = o;
      else if (/spine1$/i.test(o.name)) bones.spine = o;
    }
  });
  scene.add(root);

  mouth = new CharacterMouth(gltf, { strength: 1.5, smoothing: 0.3 });
  const rigged = mouth.targets.length > 0;
  document.getElementById('hint').style.display = 'none';
  setStatus(rigged
    ? `${name}: rig OK (${mouth.targets.length} mesh, morphs: jawOpen${mouth.targets[0].pucker != null ? ' + mouthPucker' : ''})`
    : `⚠ ${name} has no jawOpen morph — export a rigged GLB from the calibration tool`);

  frameCharacter();
}

function frameCharacter() {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // frame head & shoulders: aim slightly below the head, step back a bit
  const aim = new THREE.Vector3(c.x, box.min.y + size.y * 0.78, c.z);
  orbit.target.copy(aim);
  camera.position.set(aim.x + size.y * 0.12, aim.y + size.y * 0.04, aim.z + size.y * 0.8);
  camera.near = size.y / 100;
  camera.far = size.y * 20 + 10;
  camera.updateProjectionMatrix();
}

// procedural idle so the character doesn't stand frozen (works with the
// mixamo skeleton; harmless no-op for static models)
const baseRot = new Map();
function idle(t) {
  for (const [k, b] of Object.entries(bones)) {
    if (!b) continue;
    if (!baseRot.has(b)) baseRot.set(b, b.rotation.clone());
    const r = baseRot.get(b);
    if (k === 'spine') {
      b.rotation.x = r.x + 0.015 * Math.sin(t * 0.9);        // breathing
      b.rotation.z = r.z + 0.008 * Math.sin(t * 0.53);
    } else if (k === 'neck') {
      b.rotation.y = r.y + 0.04 * Math.sin(t * 0.31);
      b.rotation.x = r.x + 0.02 * Math.sin(t * 0.71 + 1);
    } else if (k === 'head') {
      const talk = speaking ? 0.035 * Math.sin(t * 2.1) : 0;
      b.rotation.y = r.y + 0.05 * Math.sin(t * 0.23 + 2) + talk;
      b.rotation.x = r.x + 0.02 * Math.sin(t * 0.47) + (speaking ? 0.02 * Math.sin(t * 1.7) : 0);
    }
  }
}

// ---------------------------------------------------------------------------
// input: file / drag&drop / auto-load last export from the calibration tool
document.getElementById('loadBtn').onclick = () => document.getElementById('fileGlb').click();
document.getElementById('fileGlb').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) await loadModel(await f.arrayBuffer(), f.name);
  e.target.value = '';
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = [...e.dataTransfer.files].find((x) => /\.(glb|gltf)$/i.test(x.name));
  if (f) await loadModel(await f.arrayBuffer(), f.name);
});

(async () => {
  // 1) ?model=<url> 2) last export handed over from the tool 3) wait for drop
  const url = new URLSearchParams(location.search).get('model');
  if (url) {
    try {
      const res = await fetch(url);
      if (res.ok) { await loadModel(await res.arrayBuffer(), url.split('/').pop()); return; }
    } catch (e) { console.warn(e); }
  }
  try {
    const rec = await idbGet('lastRigged');
    if (rec) { await loadModel(rec.bytes.buffer.slice(0), rec.name); setStatus(`Loaded your last export: ${rec.name}`); }
  } catch (e) { console.warn('idb', e); }
})();

// ---------------------------------------------------------------------------
// speak
const speakBtn = document.getElementById('speak');
const sayInput = document.getElementById('say');

async function speak() {
  if (!mouth || !mouth.targets.length) { setStatus('⚠ load a rigged GLB first'); return; }
  const text = sayInput.value.trim();
  if (!text || speaking) return;
  speaking = true;
  speakBtn.disabled = true;
  setSubtitle(text);
  setStatus('…');
  try {
    await mouth.speakViaProxy(text, document.getElementById('voice').value.trim());
    setStatus('');
  } catch (e) {
    setStatus('⚠ ' + e.message + ' — is the server running with ELEVENLABS_API_KEY set?');
  } finally {
    speaking = false;
    speakBtn.disabled = false;
    setTimeout(() => setSubtitle(''), 1200);
  }
}
speakBtn.onclick = speak;
sayInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') speak(); });

// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const t = clock.getElapsedTime();
  if (mouth) mouth.update();
  idle(t);
  orbit.update();
  renderer.render(scene, camera);
}
resize();
tick();

// automation hooks
window.__preview = {
  loadModel,
  get mouth() { return mouth; },
  speak,
  isSpeaking: () => speaking,
};
