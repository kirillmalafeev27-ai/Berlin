// lipsync-runtime.js — the game runtime. Drives the `jawOpen` (and, if
// present, `mouthPucker`) morph targets created by facerig from live audio.
//
//   import { CharacterMouth } from './lipsync-runtime.js';
//   const mouth = new CharacterMouth(gltf, { strength: 1.4 });
//   await mouth.speakViaProxy('Guten Tag!');        // server holds the key
//   // or: await mouth.speakFromElevenLabs(text, voiceId, apiKey);
//   // per frame: mouth.update();
//
// Openness comes from audio amplitude (RMS). When ElevenLabs timestamps are
// available (both speak methods use the with-timestamps endpoint), a viseme
// track refines it: the mouth *closes* on m/b/p and *rounds* on o/u/ö/ü —
// driving mouthPucker — which is what makes the sync read as speech rather
// than flapping.

const CLOSED_CHARS = new Set('mbpмбп');
const ROUND_CHARS = new Set('ouöüоуwœ');

export class CharacterMouth {
  constructor(gltf, opts = {}) {
    this.strength = opts.strength ?? 1.3;
    this.smoothing = opts.smoothing ?? 0.35;
    this.floor = opts.floor ?? 0.06;
    this.puckerScale = opts.puckerScale ?? 0.8;
    this.value = 0;
    this._gate = 1;
    this._round = 0;

    // every mesh with a jawOpen morph (multi-material heads export as several
    // primitives → several three.js meshes; drive them all)
    this.targets = [];
    const rootScene = gltf.scene || gltf;
    rootScene.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary && 'jawOpen' in o.morphTargetDictionary) {
        this.targets.push({
          mesh: o,
          jaw: o.morphTargetDictionary.jawOpen,
          pucker: o.morphTargetDictionary.mouthPucker ?? null,
        });
      }
    });
    // back-compat aliases
    this.mesh = this.targets[0]?.mesh ?? null;
    this.jawIndex = this.targets[0]?.jaw ?? -1;
    if (!this.targets.length) console.warn('CharacterMouth: no jawOpen morph found');

    this._ctx = null;
    this._analyser = null;
    this._data = null;
    this._elSources = new WeakMap();
    this._track = null;        // [{t0, t1, gate, round}]
    this._audio = null;        // currently playing element
  }

  _ensureAudio() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._data = new Uint8Array(this._analyser.fftSize);
    this._analyser.connect(this._ctx.destination);
  }

  async _resume() {
    this._ensureAudio();
    if (this._ctx.state === 'suspended') await this._ctx.resume();
  }

  connectAudioElement(audioEl) {
    this._ensureAudio();
    let src = this._elSources.get(audioEl);
    if (!src) {
      src = this._ctx.createMediaElementSource(audioEl);
      this._elSources.set(audioEl, src);
      src.connect(this._analyser);
    }
  }

  // alignment: ElevenLabs with-timestamps shape
  // { characters, character_start_times_seconds, character_end_times_seconds }
  static visemeTrack(alignment) {
    if (!alignment || !alignment.characters) return null;
    const { characters, character_start_times_seconds: t0s,
            character_end_times_seconds: t1s } = alignment;
    const track = [];
    for (let i = 0; i < characters.length; i++) {
      const ch = characters[i].toLowerCase();
      track.push({
        t0: t0s[i], t1: t1s[i],
        gate: CLOSED_CHARS.has(ch) ? 0 : 1,
        round: ROUND_CHARS.has(ch) ? 1 : 0,
      });
    }
    return track;
  }

  _trackAt(t) {
    if (!this._track || !this._audio) return { gate: 1, round: 0 };
    // linear scan with memo — tracks are short (one line of dialogue)
    for (const seg of this._track) {
      if (t >= seg.t0 && t < seg.t1) return seg;
    }
    return { gate: 1, round: 0 };
  }

  async playAligned(audioArrayBuffer, alignment) {
    await this._resume();
    const url = URL.createObjectURL(new Blob([audioArrayBuffer], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    this.connectAudioElement(audio);
    this._track = CharacterMouth.visemeTrack(alignment);
    this._audio = audio;
    await audio.play();
    return new Promise((r) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        this._track = null;
        this._audio = null;
        r();
      };
    });
  }

  // TTS via the facerig server (key stays server-side). base = server origin.
  async speakViaProxy(text, voiceId, base = '') {
    const res = await fetch(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId || undefined }),
    });
    if (!res.ok) throw new Error(`tts proxy ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const bin = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
    return this.playAligned(bin.buffer, data.alignment);
  }

  // Direct ElevenLabs call (testing only — don't ship a key in the client).
  async speakFromElevenLabs(text, voiceId, apiKey, opts = {}) {
    const model = opts.model_id ?? 'eleven_multilingual_v2';
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: model }),
      });
    if (res.ok) {
      const data = await res.json();
      const bin = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
      return this.playAligned(bin.buffer, data.alignment);
    }
    // fall back to the plain endpoint (older keys), amplitude-only sync
    const res2 = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: model }),
    });
    if (!res2.ok) throw new Error(`ElevenLabs ${res2.status}: ${await res2.text()}`);
    return this.playAligned(await res2.arrayBuffer(), null);
  }

  // Call every frame.
  update() {
    if (!this.targets.length) return;
    let target = 0;
    if (this._analyser) {
      this._analyser.getByteTimeDomainData(this._data);
      let sum = 0;
      for (let i = 0; i < this._data.length; i++) {
        const v = (this._data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this._data.length);
      target = Math.min(1, Math.max(0, rms - this.floor) * this.strength);
    }

    // viseme refinement from timestamps (when playing an aligned clip)
    const seg = this._audio ? this._trackAt(this._audio.currentTime) : { gate: 1, round: 0 };
    this._gate += (seg.gate - this._gate) * 0.45;   // closures need to be fast
    this._round += (seg.round - this._round) * 0.25;

    this.value += (target - this.value) * (1 - this.smoothing);
    const jaw = this.value * this._gate;
    const pucker = this._round * this.puckerScale;
    for (const t of this.targets) {
      t.mesh.morphTargetInfluences[t.jaw] = jaw;
      if (t.pucker != null) t.mesh.morphTargetInfluences[t.pucker] = pucker;
    }
  }
}
