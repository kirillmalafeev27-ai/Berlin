const CLOSED_CHARS = new Set('mbp');
const ROUND_CHARS = new Set('ouw');
const OPEN_CHARS = new Set('aeiouy');
const CYRILLIC_CLOSED = new Set(['\u043c', '\u0431', '\u043f']);
const CYRILLIC_ROUND = new Set(['\u043e', '\u0443', '\u044e']);
const CYRILLIC_OPEN = new Set(['\u0430', '\u044d', '\u0435', '\u0451', '\u0438', '\u044b', '\u044f']);
const A1_SPEECH_RATE = 0.74;

// NPC lines are displayed with emoji hints after object nouns; strip them from
// anything sent to TTS or the browser voice so they are never read aloud.
function stripPictographs(text) {
  return String(text || '')
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

function normalizeMorphName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function estimateDuration(text) {
  const letters = String(text || '').replace(/\s+/g, '').length;
  return Math.min(8, Math.max(1.1, letters * 0.065));
}

function charProfile(rawChar) {
  const char = String(rawChar || '').toLowerCase();
  const closed = CLOSED_CHARS.has(char) || CYRILLIC_CLOSED.has(char);
  const round = ROUND_CHARS.has(char) || CYRILLIC_ROUND.has(char) || char === '\u00f6' || char === '\u00fc';
  const open = OPEN_CHARS.has(char) || CYRILLIC_OPEN.has(char);
  const pause = /[\s.,!?;:()[\]{}"'-]/.test(char);

  if (closed) {
    return { gate: 0.04, round: 0, open: 0.02 };
  }

  if (pause) {
    return { gate: 0.25, round: 0, open: 0.03 };
  }

  return {
    gate: 1,
    round: round ? 1 : 0,
    open: open ? 0.34 : 0.18,
  };
}

function makeTextTrack(text, duration) {
  const chars = [...String(text || '').trim()];
  const usable = chars.length ? chars : ['.'];
  const step = duration / usable.length;

  return usable.map((char, index) => ({
    t0: index * step,
    t1: (index + 1) * step,
    ...charProfile(char),
  }));
}

function makeAlignmentTrack(alignment, fallbackText = '') {
  const characters = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;

  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)) {
    return null;
  }

  const track = [];

  for (let index = 0; index < characters.length; index += 1) {
    const t0 = Number(starts[index]);
    const t1 = Number(ends[index]);

    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) {
      continue;
    }

    track.push({
      t0,
      t1: Math.max(t1, t0 + 0.018),
      ...charProfile(characters[index]),
    });
  }

  if (track.length) {
    return track;
  }

  return makeTextTrack(fallbackText, estimateDuration(fallbackText));
}

function alignmentDuration(track) {
  return Math.max(0, ...track.map((segment) => segment.t1));
}

function normalizeSpeechRate(rate) {
  const value = Number(rate);

  if (!Number.isFinite(value)) {
    return A1_SPEECH_RATE;
  }

  return Math.min(1, Math.max(0.55, value));
}

function stretchTrack(track, factor) {
  if (!Array.isArray(track) || factor === 1) {
    return track;
  }

  return track.map((segment) => ({
    ...segment,
    t0: segment.t0 * factor,
    t1: segment.t1 * factor,
  }));
}

function chooseBrowserSpeechVoice(lang = 'de-DE') {
  const synth = window.speechSynthesis;
  const voices = synth?.getVoices?.() || [];
  const normalizedLang = String(lang || '').toLowerCase();
  const languageFamily = normalizedLang.split(/[-_]/)[0];
  const languageMatcher = new RegExp(`^${languageFamily}(?:[-_]|$)`, 'i');
  const nameMatcher =
    languageFamily === 'ru'
      ? /russian|рус/i
      : languageFamily === 'de'
      ? /german|deutsch/i
      : null;

  return (
    voices.find((voice) => String(voice.lang || '').toLowerCase() === normalizedLang) ||
    voices.find((voice) => languageMatcher.test(voice.lang || '')) ||
    (nameMatcher ? voices.find((voice) => nameMatcher.test(voice.name || '')) : null) ||
    voices.find((voice) => /^de[-_]/i.test(voice.lang || '')) ||
    voices.find((voice) => /german|deutsch/i.test(voice.name || '')) ||
    null
  );
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

let sharedAudioContext = null;
let sharedAudioUnlocked = false;

export class TextLipSync {
  constructor(root, options = {}) {
    this.root = root;
    this.strength = options.strength ?? 0.48;
    this.smoothing = options.smoothing ?? 0.42;
    this.floor = options.floor ?? 0.018;
    this.maxJaw = options.maxJaw ?? 0.34;
    this.puckerScale = options.puckerScale ?? 0.34;
    this.targets = [];
    this.value = 0;
    this.gate = 1;
    this.round = 0;
    this.active = false;
    this.track = null;
    this.startedAt = 0;
    this.duration = 0;
    this.audio = null;
    this.ctx = null;
    this.analyser = null;
    this.data = null;
    this.elementSources = new WeakMap();
    this.browserUtterance = null;

    this.refreshTargets(root);
  }

  static ensureAudioContext() {
    if (!sharedAudioContext) {
      sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    return sharedAudioContext;
  }

  static isAudioUnlocked() {
    return sharedAudioUnlocked && sharedAudioContext?.state === 'running';
  }

  static async unlockAudio() {
    const ctx = TextLipSync.ensureAudioContext();

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);

    sharedAudioUnlocked = ctx.state === 'running';
    return sharedAudioUnlocked;
  }

  refreshTargets(root = this.root) {
    this.root = root;
    this.targets = [];

    root?.traverse?.((object) => {
      const dictionary = object.morphTargetDictionary;

      if (!object.isMesh || !dictionary || !object.morphTargetInfluences) {
        return;
      }

      const entries = Object.entries(dictionary);
      const jaw = entries.find(([name]) => normalizeMorphName(name) === 'jawopen')?.[1];
      const pucker = entries.find(([name]) => normalizeMorphName(name) === 'mouthpucker')?.[1];

      if (jaw !== undefined) {
        this.targets.push({
          mesh: object,
          jaw,
          pucker: pucker ?? null,
        });
      }
    });

    return this.targets.length;
  }

  ensureAudio() {
    if (this.ctx) {
      return;
    }

    this.ctx = TextLipSync.ensureAudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.data = new Uint8Array(this.analyser.fftSize);
    this.analyser.connect(this.ctx.destination);
  }

  async resumeAudio() {
    this.ensureAudio();

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    sharedAudioUnlocked = this.ctx.state === 'running';
    return sharedAudioUnlocked;
  }

  connectAudioElement(audioElement) {
    this.ensureAudio();

    if (!this.elementSources.has(audioElement)) {
      const source = this.ctx.createMediaElementSource(audioElement);
      this.elementSources.set(audioElement, source);
      source.connect(this.analyser);
    }
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
    }

    if (this.browserUtterance && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    this.audio = null;
    this.browserUtterance = null;
    this.active = false;
    this.track = null;
    this.duration = 0;
    this.startedAt = 0;
  }

  async speak(text, options = {}) {
    // Displayed lines may carry emoji hints after nouns; never read them aloud.
    text = stripPictographs(text);
    this.stop();

    if (options.requireUnlocked !== false && !TextLipSync.isAudioUnlocked()) {
      console.warn('TTS request skipped until browser audio is unlocked; using browser speech fallback.');
      return this.speakFromBrowserVoice(text, options);
    }

    try {
      const response = await fetch(options.endpoint || '/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice_id: options.voiceId,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = await response.json();
      const audioBuffer = base64ToArrayBuffer(payload.audio_base64);
      return await this.playAligned(audioBuffer, payload.alignment, text, payload.output_format, options);
    } catch (error) {
      console.warn('TTS unavailable, using browser speech fallback:', error);
      return this.speakFromBrowserVoice(text, options);
    }
  }

  async playAligned(audioBuffer, alignment, text = '', outputFormat = '', options = {}) {
    await this.resumeAudio();

    const mime = outputFormat?.includes('pcm') ? 'audio/wav' : 'audio/mpeg';
    const blobUrl = URL.createObjectURL(new Blob([audioBuffer], { type: mime }));
    const audio = new Audio(blobUrl);
    const track = makeAlignmentTrack(alignment, text) || makeTextTrack(text, estimateDuration(text));
    const speechRate = normalizeSpeechRate(options.rate ?? options.playbackRate);
    const timeScale = 1 / speechRate;
    const slowedTrack = stretchTrack(track, timeScale);
    const duration = (alignmentDuration(slowedTrack) || estimateDuration(text) * timeScale);

    audio.preload = 'auto';
    audio.playbackRate = speechRate;
    audio.volume = options.volume ?? 0.82;
    audio.muted = false;
    audio.playsInline = true;
    this.connectAudioElement(audio);
    this.audio = audio;
    this.track = slowedTrack;
    this.duration = duration;
    this.active = true;
    this.startedAt = performance.now() / 1000;

    audio.onended = () => {
      URL.revokeObjectURL(blobUrl);
      this.active = false;
      this.audio = null;
    };
    audio.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      this.active = false;
      this.audio = null;
    };

    try {
      await audio.play();
      sharedAudioUnlocked = true;
    } catch (error) {
      sharedAudioUnlocked = false;
      throw error;
    }

    return duration;
  }

  speakFromText(text) {
    const duration = estimateDuration(text) / A1_SPEECH_RATE;
    this.track = makeTextTrack(text, duration);
    this.duration = duration;
    this.startedAt = performance.now() / 1000;
    this.active = true;
    return duration;
  }

  speakFromBrowserVoice(text, options = {}) {
    text = stripPictographs(text);
    const speechRate = normalizeSpeechRate(options.rate);
    const duration = estimateDuration(text) / speechRate;
    this.track = makeTextTrack(text, duration);
    this.duration = duration;
    this.startedAt = performance.now() / 1000;
    this.active = true;

    const synth = window.speechSynthesis;
    const Utterance = window.SpeechSynthesisUtterance;

    if (!synth || !Utterance) {
      return duration;
    }

    try {
      synth.cancel();
      const utterance = new Utterance(String(text || ''));
      utterance.lang = options.lang || 'de-DE';
      utterance.rate = speechRate;
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 0.86;
      const voice = chooseBrowserSpeechVoice(utterance.lang);

      if (voice) {
        utterance.voice = voice;
      }

      utterance.onend = () => {
        if (this.browserUtterance === utterance) {
          this.active = false;
          this.browserUtterance = null;
        }
      };
      utterance.onerror = () => {
        if (this.browserUtterance === utterance) {
          this.active = false;
          this.browserUtterance = null;
        }
      };
      this.browserUtterance = utterance;
      synth.speak(utterance);
    } catch (error) {
      console.warn('Browser speech fallback failed:', error);
    }

    return duration;
  }

  trackAt(time) {
    if (!this.track) {
      return { gate: 1, round: 0, open: 0 };
    }

    for (const segment of this.track) {
      if (time >= segment.t0 && time < segment.t1) {
        return segment;
      }
    }

    return { gate: 1, round: 0, open: 0 };
  }

  audioOpenness() {
    if (!this.analyser || !this.data || !this.audio) {
      return 0;
    }

    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;

    for (let index = 0; index < this.data.length; index += 1) {
      const value = (this.data[index] - 128) / 128;
      sum += value * value;
    }

    const rms = Math.sqrt(sum / this.data.length);
    return Math.min(this.maxJaw, Math.max(0, rms - this.floor) * this.strength * 2.4);
  }

  update(deltaTime) {
    const time = this.audio
      ? this.audio.currentTime
      : Math.max(0, performance.now() / 1000 - this.startedAt);

    if (this.active && !this.audio && time >= this.duration) {
      this.active = false;
    }

    const segment = this.active ? this.trackAt(time) : { gate: 1, round: 0, open: 0 };
    const visemeOpen = this.active ? Math.min(this.maxJaw, segment.open * this.maxJaw) : 0;
    const target = Math.min(this.maxJaw, Math.max(this.audioOpenness(), visemeOpen));
    const alpha = Math.min(1, deltaTime * (segment.gate < this.gate ? 22 : 12));

    this.gate += (segment.gate - this.gate) * alpha;
    this.round += (segment.round - this.round) * Math.min(1, deltaTime * 10);
    this.value += (target - this.value) * (1 - this.smoothing);

    const jaw = Math.min(this.maxJaw, Math.max(0, this.value * this.gate));
    const pucker = Math.min(1, Math.max(0, this.round * this.puckerScale));

    for (const targetInfo of this.targets) {
      targetInfo.mesh.morphTargetInfluences[targetInfo.jaw] = jaw;

      if (targetInfo.pucker != null) {
        targetInfo.mesh.morphTargetInfluences[targetInfo.pucker] = pucker;
      }
    }
  }
}
