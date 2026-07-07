// gesture-player.js — the BODY animation channel.
//
// Plays skeletal Mixamo clips (bones + keyframes, "without skin" export) on a
// character, completely independent of the MOUTH channel (CharacterMouth's
// jawOpen/mouthPucker morphs). The two are separate animation systems in
// three.js — the mixer writes bone transforms, the mouth writes morph
// influences — and they compose automatically: morph is applied in the mesh's
// local space, then skinning carries those vertices with the bones. So a nod
// clip and an open mouth just work at the same time.
//
//   import { GesturePlayer } from './gesture-player.js';
//   const body = new GesturePlayer(gltf);
//   await body.loadClips({ idle: '/clips/idle.glb', nod: '/clips/nod.glb', ... });
//   body.playIdle();
//   body.playGesture('nod', { returnToIdle: true });
//   // per frame, alongside mouth.update():
//   body.update(dt);
//
// Clips are shared across all 16 characters (one Mixamo skeleton): the cache is
// module-level and keyed by URL, so a clip GLB is fetched once and its
// AnimationClip is reused by every character's own mixer. Retargeting is by
// bone NAME (three's PropertyBinding), which is why the mixamorig: prefix must
// stay consistent.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const _loader = new GLTFLoader();
const _clipCache = new Map(); // url -> Promise<AnimationClip[]>

// Fetch a body-GLB once; return its (non-empty) animation clips.
export function fetchClips(url) {
  if (!_clipCache.has(url)) {
    _clipCache.set(url, new Promise((resolve, reject) => {
      _loader.load(url,
        (gltf) => resolve(gltf.animations.filter((c) => c.duration > 0)),
        undefined,
        (err) => { _clipCache.delete(url); reject(err); });
    }));
  }
  return _clipCache.get(url);
}

export class GesturePlayer {
  constructor(gltf, opts = {}) {
    this.root = gltf.scene || gltf;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.defaultFade = opts.fade ?? 0.3;
    this.clips = new Map();      // name -> AnimationClip
    this.actions = new Map();    // name -> AnimationAction
    this.idleName = null;
    this.current = null;         // currently-featured action (idle or gesture)
    this._returnTimer = null;

    // does this character actually have a skeleton the clips can drive?
    this.hasSkeleton = false;
    this.root.traverse((o) => { if (o.isBone || o.isSkinnedMesh) this.hasSkeleton = true; });

    // return-to-idle on one-shot gesture end
    this.mixer.addEventListener('finished', (e) => {
      if (e.action._facerigReturnToIdle && this.idleName) {
        this._crossFadeToIdle(e.action._facerigReturnToIdle);
      }
    });
  }

  // Register a clip directly (e.g. a synthetic/procedural clip). Idempotent.
  registerClip(name, clip) {
    clip.name = name;
    this.clips.set(name, clip);
    return clip;
  }

  // Lazy-load a pool of body clips: { name: url }. URLs are cached module-wide
  // so a second character reuses the same fetched clip. If several clips live
  // in one GLB, pass { name: [url, clipName] }.
  async loadClips(pool) {
    await Promise.all(Object.entries(pool).map(async ([name, spec]) => {
      const [url, clipName] = Array.isArray(spec) ? spec : [spec, null];
      const clips = await fetchClips(url);
      const clip = clipName ? clips.find((c) => c.name === clipName) : clips[0];
      if (clip) this.registerClip(name, clip);
      else console.warn(`GesturePlayer: no clip "${clipName || '(first)'}" in ${url}`);
    }));
    return this;
  }

  _action(name) {
    if (this.actions.has(name)) return this.actions.get(name);
    const clip = this.clips.get(name);
    if (!clip) return null;
    const action = this.mixer.clipAction(clip);
    this.actions.set(name, action);
    return action;
  }

  // Base layer: idle loops forever underneath everything.
  playIdle(name = 'idle') {
    this.idleName = name;
    const action = this._action(name);
    if (!action) { console.warn(`GesturePlayer: no idle clip "${name}"`); return this; }
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    this.current = action;
    return action;
  }

  // Gesture layer: crossfade a clip in over the current pose, optionally loop,
  // optionally crossfade back to idle when a one-shot finishes.
  //   playGesture('nod', { fade: 0.3, loop: false, returnToIdle: true })
  playGesture(name, { fade = this.defaultFade, loop = false, returnToIdle = true } = {}) {
    const action = this._action(name);
    if (!action) { console.warn(`GesturePlayer: no gesture clip "${name}"`); return null; }
    if (this._returnTimer) { clearTimeout(this._returnTimer); this._returnTimer = null; }

    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;   // hold last frame until the crossfade back
    action._facerigReturnToIdle = (!loop && returnToIdle) ? fade : 0;
    action.play();

    if (this.current && this.current !== action) {
      this.current.crossFadeTo(action, fade, false);
    }
    this.current = action;
    return action;
  }

  _crossFadeToIdle(fade) {
    const idle = this._action(this.idleName);
    if (!idle) return;
    idle.reset();
    idle.enabled = true;
    idle.setEffectiveWeight(1);
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.play();
    if (this.current && this.current !== idle) this.current.crossFadeTo(idle, fade, false);
    this.current = idle;
  }

  // Explicitly return to idle (e.g. when a looping gesture should stop).
  returnToIdle(fade = this.defaultFade) { this._crossFadeToIdle(fade); return this; }

  // Drive the bone channel. Call every frame with the frame delta in seconds.
  update(dt) { this.mixer.update(dt); }

  dispose() {
    if (this._returnTimer) clearTimeout(this._returnTimer);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
