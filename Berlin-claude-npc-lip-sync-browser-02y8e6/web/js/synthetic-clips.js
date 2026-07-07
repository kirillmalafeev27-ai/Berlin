// synthetic-clips.js — procedural stand-in body clips.
//
// The real product loads a pool of Mixamo body GLBs (idle/talk/nod/shrug/…)
// from a CDN. This repo ships none of those (Mixamo needs an Adobe login), so
// these build equivalent AnimationClips procedurally, targeting the SAME
// `mixamorig:` bone names Mixamo uses. They exercise the identical
// name-based retargeting path the real clips do — a clip authored here binds
// to any GLB with the mixamo skeleton — so the GesturePlayer wiring is fully
// testable without the asset pool. Swap `loadClips({url})` in when you have it.

import * as THREE from 'three';

// three's GLTFLoader sanitizes node names — `mixamorig:Head` becomes
// `mixamorigHead` (reserved chars stripped) — and it sanitizes the tracks of
// clips loaded FROM a GLB the same way, so real Mixamo clips bind. Our
// hand-built tracks must apply the identical transform or they bind to
// nothing. sanitizeNodeName is the exact function three uses internally.
const sanitize = THREE.PropertyBinding.sanitizeNodeName;

// Build a QuaternionKeyframeTrack for one bone from a list of XYZ-euler keys.
function eulerTrack(bone, times, eulers) {
  const values = new Float32Array(times.length * 4);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < times.length; i++) {
    e.set(eulers[i][0], eulers[i][1], eulers[i][2], 'XYZ');
    q.setFromEuler(e);
    values.set([q.x, q.y, q.z, q.w], i * 4);
  }
  return new THREE.QuaternionKeyframeTrack(`${sanitize(bone)}.quaternion`, times, values);
}

// sample a smooth loop of a per-bone euler function into N keys over `dur`
function sampledClip(name, dur, keys, boneFns) {
  const times = Array.from({ length: keys }, (_, i) => (i / (keys - 1)) * dur);
  const tracks = Object.entries(boneFns).map(([bone, fn]) =>
    eulerTrack(bone, times, times.map((t) => fn(t / dur))));
  return new THREE.AnimationClip(name, dur, tracks);
}

const P = `mixamorig:`;
const TAU = Math.PI * 2;

// Idle: breathing spine + slow neck drift. Loops seamlessly (uses sin/cos of a
// full period so first and last keys match).
export function makeIdleClip() {
  return sampledClip('idle', 4.0, 33, {
    [`${P}Spine`]:  (u) => [0.02 * Math.sin(u * TAU) - 0.01, 0.015 * Math.sin(u * TAU * 0.5), 0],
    [`${P}Spine1`]: (u) => [0.015 * Math.sin(u * TAU + 0.5), 0, 0.01 * Math.sin(u * TAU * 0.5)],
    [`${P}Neck`]:   (u) => [0.02 * Math.sin(u * TAU * 0.5 + 1), 0.05 * Math.sin(u * TAU * 0.33), 0],
    [`${P}Head`]:   (u) => [0.02 * Math.sin(u * TAU * 0.5), 0.04 * Math.sin(u * TAU * 0.25 + 2), 0],
  });
}

// Talk: livelier head/spine motion, loops — layered under a spoken line.
export function makeTalkClip() {
  return sampledClip('talk', 2.2, 23, {
    [`${P}Spine1`]: (u) => [0.02 * Math.sin(u * TAU), 0.02 * Math.sin(u * TAU * 0.5), 0],
    [`${P}Neck`]:   (u) => [0.03 * Math.sin(u * TAU + 0.5), 0.04 * Math.sin(u * TAU * 0.5), 0],
    [`${P}Head`]:   (u) => [0.035 * Math.sin(u * TAU * 1.5), 0.05 * Math.sin(u * TAU), 0.02 * Math.sin(u * TAU * 0.5)],
  });
}

// Nod: one-shot pitch down then back up (~agreement).
export function makeNodClip() {
  const bell = (u) => Math.sin(Math.PI * u); // 0→1→0
  return sampledClip('nod', 1.1, 17, {
    [`${P}Head`]: (u) => [0.35 * bell(u), 0, 0],
    [`${P}Neck`]: (u) => [0.12 * bell(u), 0, 0],
  });
}

// Shrug: one-shot shoulders up + slight head tilt (~"I don't know").
export function makeShrugClip() {
  const bell = (u) => Math.sin(Math.PI * u);
  return sampledClip('shrug', 1.3, 17, {
    [`${P}LeftShoulder`]:  (u) => [0, 0, -0.35 * bell(u)],
    [`${P}RightShoulder`]: (u) => [0, 0,  0.35 * bell(u)],
    [`${P}Head`]:          (u) => [0.05 * bell(u), 0, 0.08 * bell(u)],
  });
}

// Turn: one-shot head yaw to the side and back — used to prove the mouth stays
// welded to the face while the head bone animates (the §10 hard invariant).
export function makeTurnClip(angle = 0.6) {
  const bell = (u) => Math.sin(Math.PI * u);
  return sampledClip('turn', 1.4, 17, {
    [`${P}Head`]: (u) => [0, angle * bell(u), 0],
    [`${P}Neck`]: (u) => [0, 0.3 * angle * bell(u), 0],
  });
}

// The default demo pool (registered directly, no fetch).
export function registerSyntheticPool(player) {
  player.registerClip('idle', makeIdleClip());
  player.registerClip('talk', makeTalkClip());
  player.registerClip('nod', makeNodClip());
  player.registerClip('shrug', makeShrugClip());
  player.registerClip('turn', makeTurnClip());
  return player;
}
