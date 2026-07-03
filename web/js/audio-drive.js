// audio-drive.js — amplitude → mouth-openness signal for the calibration
// preview. Same RMS approach as lipsync-runtime.js (the game runtime); this
// copy also supports local audio files and the microphone for quick tests.

export class AmplitudeDriver {
  constructor(opts = {}) {
    this.strength = opts.strength ?? 1.3;
    this.smoothing = opts.smoothing ?? 0.35;
    this.floor = opts.floor ?? 0.06;
    this.value = 0;
    this._ctx = null;
    this._analyser = null;
    this._data = null;
    this._elSources = new WeakMap(); // MediaElementSource can be created once per element
    this._micStream = null;
    this._micSource = null;
  }

  _ensure() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._data = new Uint8Array(this._analyser.fftSize);
    this._analyser.connect(this._ctx.destination);
  }

  async resume() {
    this._ensure();
    if (this._ctx.state === 'suspended') await this._ctx.resume();
  }

  connectElement(audioEl) {
    this._ensure();
    let src = this._elSources.get(audioEl);
    if (!src) {
      src = this._ctx.createMediaElementSource(audioEl);
      this._elSources.set(audioEl, src);
      src.connect(this._analyser);
    }
    return src;
  }

  async playFile(file) {
    await this.resume();
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    this.connectElement(audio);
    await audio.play();
    return new Promise((res) => {
      audio.onended = () => { URL.revokeObjectURL(url); res(); };
    });
  }

  async micOn() {
    await this.resume();
    if (this._micSource) return;
    this._micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._micSource = this._ctx.createMediaStreamSource(this._micStream);
    // mic goes to the analyser only — don't feed it back to the speakers
    this._micSource.connect(this._analyser);
    this._analyser.disconnect();
  }

  micOff() {
    if (!this._micSource) return;
    this._micSource.disconnect();
    this._micStream.getTracks().forEach((t) => t.stop());
    this._micSource = null;
    this._micStream = null;
    this._analyser.connect(this._ctx.destination);
  }

  async playArrayBuffer(buf, mime = 'audio/mpeg') {
    const url = URL.createObjectURL(new Blob([buf], { type: mime }));
    const audio = new Audio(url);
    await this.resume();
    this.connectElement(audio);
    await audio.play();
    return new Promise((r) => { audio.onended = () => { URL.revokeObjectURL(url); r(); }; });
  }

  // TTS through the facerig server (server holds the ElevenLabs key). The
  // /api/tts endpoint returns { audio_base64, alignment } from the
  // with-timestamps ElevenLabs endpoint.
  async speakViaProxy(text, voiceId, base = '') {
    const res = await fetch(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId || undefined }),
    });
    if (!res.ok) throw new Error(`tts proxy ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const bin = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
    return this.playArrayBuffer(bin.buffer);
  }

  async speakFromElevenLabs(text, voiceId, apiKey, opts = {}) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: opts.model_id ?? 'eleven_multilingual_v2' }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    const buf = await res.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    await this.resume();
    this.connectElement(audio);
    await audio.play();
    return new Promise((r) => { audio.onended = () => { URL.revokeObjectURL(url); r(); }; });
  }

  // Call every frame; returns smoothed openness 0..1.
  update() {
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
    this.value += (target - this.value) * (1 - this.smoothing);
    return this.value;
  }
}
