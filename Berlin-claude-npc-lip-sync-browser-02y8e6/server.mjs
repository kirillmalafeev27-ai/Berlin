// server.mjs — facerig web service (zero-dependency node http server).
//
//   ELEVENLABS_API_KEY=sk_... node server.mjs
//
// Serves:
//   /            → web/ (calibration tool at /, game preview at /preview.html)
//   /models/*    → *.glb files from the repo root (demo characters)
//   POST /api/tts    → ElevenLabs text-to-speech WITH timestamps (key stays here)
//   GET  /api/voices → ElevenLabs voice list (for picking a voice id)
//   GET  /api/health → { ok, hasKey }
//
// Env: ELEVENLABS_API_KEY (required for TTS), ELEVENLABS_VOICE_ID (default
// voice), ELEVENLABS_MODEL_ID (default eleven_multilingual_v2), PORT.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.ELEVENLABS_API_KEY || '';
const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // "Rachel"
const DEFAULT_MODEL = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJSON(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((res, rej) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { rej(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

async function handleTTS(req, res) {
  if (!API_KEY) return sendJSON(res, 503, { error: 'ELEVENLABS_API_KEY is not set on the server' });
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return sendJSON(res, 400, { error: 'invalid JSON' }); }
  const text = (body.text || '').trim();
  if (!text) return sendJSON(res, 400, { error: 'text is required' });
  if (text.length > 2000) return sendJSON(res, 400, { error: 'text too long (2000 chars max)' });
  const voice = (body.voice_id || DEFAULT_VOICE).replace(/[^A-Za-z0-9]/g, '');
  const model = body.model_id || DEFAULT_MODEL;

  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps`, {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: model }),
    });
  const payload = await r.text();
  if (!r.ok) return send(res, r.status, payload, { 'Content-Type': 'application/json' });
  send(res, 200, payload, { 'Content-Type': 'application/json' });
}

async function handleVoices(res) {
  if (!API_KEY) return sendJSON(res, 503, { error: 'ELEVENLABS_API_KEY is not set on the server' });
  const r = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': API_KEY },
  });
  const data = await r.json();
  if (!r.ok) return sendJSON(res, r.status, data);
  sendJSON(res, 200, {
    voices: (data.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name, labels: v.labels })),
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);

    if (req.method === 'POST' && p === '/api/tts') return await handleTTS(req, res);
    if (req.method === 'GET' && p === '/api/voices') return await handleVoices(res);
    if (req.method === 'GET' && p === '/api/health') {
      return sendJSON(res, 200, { ok: true, hasKey: !!API_KEY });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

    // demo models from the repo root: /models/<file>.glb
    if (p.startsWith('/models/')) {
      const name = path.basename(p);
      if (!name.toLowerCase().endsWith('.glb')) return send(res, 404, 'not found');
      return serveFile(res, path.join(ROOT, name));
    }

    // static site from web/
    let file = path.normalize(path.join(WEB, p === '/' ? 'index.html' : p));
    if (!file.startsWith(WEB)) return send(res, 403, 'forbidden');
    serveFile(res, file);
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`facerig server on :${PORT} — tool at /, game preview at /preview.html`);
  if (!API_KEY) console.log('note: ELEVENLABS_API_KEY not set — /api/tts disabled');
});
