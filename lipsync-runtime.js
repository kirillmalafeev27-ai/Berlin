// lipsync-runtime.js
// Drives the `jawOpen` morph target (created by facerig.py) from live audio.
// Works with any GLB that has a head mesh with a `jawOpen` morph — including
// the ElevenLabs TTS output for your German dialogue lines.
//
// Usage:
//   import { CharacterMouth } from './lipsync-runtime.js';
//   const mouth = new CharacterMouth(gltf, { strength: 1.4, smoothing: 0.35 });
//   // when a line plays:
//   await mouth.speakFromElevenLabs(text, voiceId, apiKey);   // fetch + play + sync
//   // in your render loop:
//   mouth.update();

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class CharacterMouth {
  constructor(gltf, opts = {}) {
    this.strength   = opts.strength   ?? 1.3;   // multiplier on mouth openness
    this.smoothing  = opts.smoothing  ?? 0.35;  // 0 = snappy, 1 = very smooth
    this.floor      = opts.floor      ?? 0.06;  // ignore quiet room tone
    this.value      = 0;

    // find the head mesh + jawOpen morph index
    this.mesh = null; this.jawIndex = -1;
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary &&
          'jawOpen' in o.morphTargetDictionary) {
        this.mesh = o;
        this.jawIndex = o.morphTargetDictionary['jawOpen'];
      }
    });
    if (!this.mesh) console.warn('CharacterMouth: no jawOpen morph found');

    this._audioCtx = null;
    this._analyser = null;
    this._data = null;
  }

  _ensureAudio() {
    if (this._audioCtx) return;
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._data = new Uint8Array(this._analyser.fftSize);
  }

  // Connect an <audio> / AudioBuffer source and play it through the analyser.
  connectAudioElement(audioEl) {
    this._ensureAudio();
    const src = this._audioCtx.createMediaElementSource(audioEl);
    src.connect(this._analyser);
    this._analyser.connect(this._audioCtx.destination);
  }

  // Fetch a line from ElevenLabs and lip-sync it. (No timestamps needed — we
  // read the amplitude of the audio itself. German or any language just works.)
  async speakFromElevenLabs(text, voiceId, apiKey, opts = {}) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: opts.model_id ?? 'eleven_multilingual_v2',
        }),
      });
    const buf = await res.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    await this._audioCtxResume();
    this.connectAudioElement(audio);
    await audio.play();
    return new Promise((r) => { audio.onended = r; });
  }

  async _audioCtxResume() {
    this._ensureAudio();
    if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
  }

  // Call every frame.
  update() {
    if (this.jawIndex < 0) return;
    let target = 0;
    if (this._analyser) {
      this._analyser.getByteTimeDomainData(this._data);
      // RMS of the waveform → loudness 0..1
      let sum = 0;
      for (let i = 0; i < this._data.length; i++) {
        const v = (this._data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this._data.length);
      target = Math.max(0, (rms - this.floor)) * this.strength;
      target = Math.min(1, target);
    }
    // exponential smoothing so the jaw doesn't chatter
    this.value += (target - this.value) * (1 - this.smoothing);
    this.mesh.morphTargetInfluences[this.jawIndex] = this.value;
  }
}
