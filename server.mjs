import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const text = readFileSync(filePath, 'utf8');

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');

    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(path.join(root, '.env'));

const port = Number(process.env.PORT || 5173);
// Render (and most PaaS) route traffic to 0.0.0.0; binding to 127.0.0.1 makes
// the service unreachable and fails the health check. Allow an override but
// default to all interfaces so the container is reachable.
const host = process.env.HOST || '0.0.0.0';
// Static files may live at the repo root (index.html, src/, fantasy-town.glb)
// or under public/ (Vite convention). Requests are resolved against both.
const staticRoots = [root, path.join(root, 'public')];
const DEFAULT_AI_TUNNEL_BASE_URL = 'https://api.aitunnel.ru/v1';
const DEFAULT_AI_TUNNEL_MODEL = 'gpt-5.4-mini';
const DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.fbx', 'application/octet-stream'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

// Stable URL prefix the game uses for character/animation GLBs. The real files
// may sit under ./Mixamo (legacy layout) or ./public/assets/mixamo (committed
// layout); we resolve whichever base exists and alias its whole tree — so both
// /Mixamo/glb/<clip> (body animations) and /Mixamo/characters/<model> (rigged
// characters) resolve.
const MIXAMO_URL_PREFIX = '/Mixamo/';
const MIXAMO_BASE_CANDIDATES = ['Mixamo', 'public/assets/mixamo'];

function firstExistingDir(candidates) {
  for (const relativeDir of candidates) {
    const absoluteDir = path.resolve(root, relativeDir);

    if (absoluteDir.startsWith(root) && existsSync(absoluteDir)) {
      return relativeDir;
    }
  }

  return candidates[0];
}

const mixamoBaseDir = firstExistingDir(MIXAMO_BASE_CANDIDATES);
const animationSearchDirs = ['', 'animations', 'mixamo', 'assets'];
// Rigged, lip-synced characters live under characters/; Mixamo body-animation
// clips under glb/.
const riggedCharacterDirs = [path.join(mixamoBaseDir, 'characters')];
const bodyAnimationDir = path.join(mixamoBaseDir, 'glb');
const characterFile = 'Meshy_AI_Character_output.fbx';
const bodyAnimationFiles = new Set([
  'Acknowledging.glb',
  'Agreeing.glb',
  'Annoyed Head Shake.glb',
  'Bored.glb',
  'Disappointed.glb',
  'Dismissing Gesture.glb',
  'Happy Hand Gesture.glb',
  'Happy Idle.glb',
  'Head Nod Yes.glb',
  'Idle Default beliner.glb',
  'Laughing.glb',
  'Look Around.glb',
  'Looking.glb',
  'Nervously Look Around.glb',
  'Pointing Forward.glb',
  'Pouting.glb',
  'Quick Formal Bow.glb',
  'Relieved Sigh.glb',
  'Sad Idle.glb',
  'Shaking Head No.glb',
  'Shrugging.glb',
  'Sitting Idle.glb',
  'Sitting Laughing.glb',
  'Standing Arguing.glb',
  'Standing Greeting.glb',
  'Standing Idle.glb',
  'Surprised.glb',
  'Talking At Watercooler.glb',
  'Telling A Secret.glb',
  'Thankful.glb',
  'Thinking.glb',
  'Walking.glb',
  'Waving.glb',
  'Yawn.glb',
  'Yelling While Standing.glb',
]);

function assetUrl(relativePath) {
  return `/${relativePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`;
}

// Expose a mixamo file under the stable /Mixamo/<subpath> alias, preserving the
// glb/ vs characters/ subdirectory regardless of where the base lives on disk.
function mixamoAssetUrl(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  const base = mixamoBaseDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const sub = normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : path.basename(normalized);
  return MIXAMO_URL_PREFIX + sub.split('/').map(encodeURIComponent).join('/');
}

// Resolve a URL path to an on-disk file, trying the repo root first and then
// public/. Returns null if the path escapes every static root (traversal).
function resolveStaticFile(pathname) {
  const cleanPath = decodeURIComponent(pathname);
  const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');

  for (const base of staticRoots) {
    const filePath = path.resolve(base, relativePath);

    if (!filePath.startsWith(base)) {
      continue;
    }

    if (existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

// Serve the stable /Mixamo/<subpath> alias from whichever real base exists.
function resolveMixamoFile(pathname) {
  const sub = decodeURIComponent(pathname.slice(MIXAMO_URL_PREFIX.length));
  const dir = path.resolve(root, mixamoBaseDir);
  const filePath = path.resolve(dir, sub);

  if (!filePath.startsWith(dir) || !existsSync(filePath)) {
    return null;
  }

  return filePath;
}

async function listFbxFiles(relativeDir = '') {
  const dir = path.resolve(root, relativeDir);

  if (!dir.startsWith(root)) {
    return [];
  }

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await listFbxFiles(relativePath)));
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.fbx') {
        files.push(relativePath.replace(/\\/g, '/'));
      }
    }

    return files;
  } catch (error) {
    return [];
  }
}

async function listMatchingFiles(relativeDir, predicate) {
  const dir = path.resolve(root, relativeDir);

  if (!dir.startsWith(root)) {
    return [];
  }

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await listMatchingFiles(relativePath, predicate)));
      } else if (entry.isFile() && predicate(entry.name, relativePath)) {
        files.push(relativePath.replace(/\\/g, '/'));
      }
    }

    return files;
  } catch (error) {
    return [];
  }
}

async function listRiggedCharacters() {
  const files = [];

  for (const dir of riggedCharacterDirs) {
    files.push(
      ...(await listMatchingFiles(
        dir,
        (name, relativePath) =>
          name.toLowerCase().endsWith('.rigged.glb') &&
          !relativePath.toLowerCase().includes('/node_modules/'),
      )),
    );
  }

  return files.sort((a, b) => a.localeCompare(b, 'en'));
}

async function listBodyAnimationGlbs() {
  const files = await listMatchingFiles(
    bodyAnimationDir,
    (name, relativePath) =>
      bodyAnimationFiles.has(name) &&
      !relativePath.toLowerCase().includes('/normalized/'),
  );

  return files.sort((a, b) => a.localeCompare(b, 'en'));
}

async function sendAssetManifest(response) {
  const files = new Set();

  for (const dir of animationSearchDirs) {
    for (const file of await listFbxFiles(dir)) {
      files.add(file);
    }
  }

  const fbxFiles = [...files].sort((a, b) => a.localeCompare(b, 'en'));
  const animations = fbxFiles.filter((file) => path.basename(file) !== characterFile);

  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  response.end(
    JSON.stringify({
      character: fbxFiles.includes(characterFile) ? assetUrl(characterFile) : null,
      animations: animations.map(assetUrl),
      fbxFiles: fbxFiles.map(assetUrl),
      characters: (await listRiggedCharacters()).map(mixamoAssetUrl),
      bodyAnimations: (await listBodyAnimationGlbs()).map(mixamoAssetUrl),
    }),
  );
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;

      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  response.end(JSON.stringify(payload));
}

function normalizedText(value) {
  return String(value || '').toLowerCase();
}

function detectLanguage(message) {
  if (/[\u0400-\u04ff]/.test(message)) {
    return 'ru';
  }

  if (/\b(ich|du|sie|hallo|guten|danke|bitte|wo|wie|gehen|komm|stadt)\b/i.test(message)) {
    return 'de';
  }

  return 'en';
}

function detectIntent(message) {
  const text = normalizedText(message);

  if (/\b(hi|hello|hey|hallo|guten|privet)\b/.test(text) || /[\u043f][\u0440][\u0438][\u0432][\u0435][\u0442]/i.test(text)) {
    return 'greeting';
  }

  if (/[?]/.test(text) || /\b(where|what|why|how|wo|was|warum|wie|gde|kak)\b/.test(text)) {
    return 'thinking';
  }

  if (/\b(thanks|thank|danke|spasibo)\b/.test(text) || /[\u0441][\u043f][\u0430][\u0441][\u0438][\u0431][\u043e]/i.test(text)) {
    return 'thankful';
  }

  if (/\b(no|not|nein|nicht|stop|danger|angry|bad|net|nelzya)\b/.test(text)) {
    return 'negative';
  }

  if (/\b(fun|joke|laugh|smile|happy|witz)\b/.test(text)) {
    return 'happy';
  }

  if (/\b(help|hilf|hilfe|pomogi|work|job|arbeit)\b/.test(text)) {
    return 'helpful';
  }

  return 'talk';
}

function animationKeywordsForIntent(intent) {
  const map = {
    greeting: ['standing greeting', 'waving', 'acknowledging'],
    thinking: ['thinking', 'look around', 'looking'],
    thankful: ['thankful', 'quick formal bow', 'acknowledging'],
    negative: ['shaking head no', 'dismissing gesture', 'annoyed head shake'],
    happy: ['laughing', 'happy hand gesture', 'happy idle'],
    helpful: ['pointing forward', 'acknowledging', 'talking at watercooler'],
    talk: ['talking at watercooler', 'telling a secret', 'acknowledging'],
  };

  return map[intent] || map.talk;
}

function localReplyFor({ npc, message }) {
  const name = npc?.label || 'NPC';
  const language = detectLanguage(message);
  const intent = detectIntent(message);

  const replies = {
    ru: {
      greeting: `\u041f\u0440\u0438\u0432\u0435\u0442. \u042f \u0440\u044f\u0434\u043e\u043c, \u0435\u0441\u043b\u0438 \u043d\u0443\u0436\u043d\u043e \u0431\u044b\u0441\u0442\u0440\u043e \u0441\u043e\u0440\u0438\u0435\u043d\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u0433\u043e\u0440\u043e\u0434\u0435.`,
      thinking: `\u0414\u0430\u0439 \u043f\u043e\u0434\u0443\u043c\u0430\u0442\u044c. \u041f\u043e\u0445\u043e\u0436\u0435, \u043b\u0443\u0447\u0448\u0435 \u0438\u0434\u0442\u0438 \u043f\u043e \u0442\u0440\u043e\u0442\u0443\u0430\u0440\u0443 \u0438 \u0434\u0435\u0440\u0436\u0430\u0442\u044c\u0441\u044f \u0431\u043b\u0438\u0436\u0435 \u043a \u043e\u0442\u043a\u0440\u044b\u0442\u044b\u043c \u043c\u0435\u0441\u0442\u0430\u043c.`,
      thankful: `\u041f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430. \u0415\u0441\u043b\u0438 \u0447\u0442\u043e, \u043c\u043e\u0436\u0435\u0448\u044c \u043e\u0431\u0440\u0430\u0442\u0438\u0442\u044c\u0441\u044f \u0441\u043d\u043e\u0432\u0430.`,
      negative: `\u041d\u0435\u0442, \u044f \u0431\u044b \u0442\u0430\u043a \u043d\u0435 \u0434\u0435\u043b\u0430\u043b. \u041b\u0443\u0447\u0448\u0435 \u0432\u044b\u0431\u0440\u0430\u0442\u044c \u0441\u043f\u043e\u043a\u043e\u0439\u043d\u044b\u0439 \u043c\u0430\u0440\u0448\u0440\u0443\u0442.`,
      happy: `\u0425\u0430, \u0445\u043e\u0440\u043e\u0448\u043e \u0441\u043a\u0430\u0437\u0430\u043d\u043e. \u0413\u043e\u0440\u043e\u0434 \u0441\u0440\u0430\u0437\u0443 \u043a\u0430\u0436\u0435\u0442\u0441\u044f \u0442\u0435\u043f\u043b\u0435\u0435.`,
      helpful: `\u041c\u043e\u0433\u0443 \u043f\u043e\u043c\u043e\u0447\u044c. \u0421\u043f\u0440\u043e\u0441\u0438 \u043a\u043e\u0440\u043e\u0442\u043a\u043e, \u0438 \u044f \u043f\u043e\u043a\u0430\u0436\u0443 \u043d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435.`,
      talk: `\u0421\u043b\u044b\u0448\u0443 \u0442\u0435\u0431\u044f. \u0414\u0430\u0432\u0430\u0439 \u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c \u043f\u0440\u043e\u0449\u0435 \u0438 \u043f\u043e \u0434\u0435\u043b\u0443.`,
    },
    de: {
      greeting: `Hallo. Ich bleibe in der Naehe, falls du eine schnelle Orientierung brauchst.`,
      thinking: `Einen Moment. Am besten bleibst du auf dem Gehweg und gehst Richtung offener Platz.`,
      thankful: `Gern. Sprich mich wieder an, wenn du noch etwas brauchst.`,
      negative: `Nein, das wuerde ich nicht machen. Nimm lieber den ruhigeren Weg.`,
      happy: `Ha, das ist gut. So klingt die Stadt gleich freundlicher.`,
      helpful: `Ich helfe dir. Frag kurz, und ich zeige dir die Richtung.`,
      talk: `Ich hoere dir zu. Sag mir kurz, was du wissen willst.`,
    },
    en: {
      greeting: `Hello. I am nearby if you need quick city guidance.`,
      thinking: `Let me think. The calm route is usually along the open sidewalk.`,
      thankful: `You are welcome. Talk to me again if you need anything else.`,
      negative: `No, I would not do that. Choose the quieter route instead.`,
      happy: `That is a good one. The city feels warmer already.`,
      helpful: `I can help. Ask briefly, and I will point you in the right direction.`,
      talk: `I hear you. Tell me what you want to know.`,
    },
  };

  return {
    reply: replies[language][intent] || replies.en.talk,
    animationIntent: intent,
    animationKeywords: animationKeywordsForIntent(intent),
    source: 'local',
  };
}

function normalizeDialoguePayload(payload, fallback) {
  const intent = payload?.animationIntent || fallback?.animationIntent || 'talk';
  const keywords = Array.isArray(payload?.animationKeywords) && payload.animationKeywords.length
    ? payload.animationKeywords
    : animationKeywordsForIntent(intent);

  return {
    reply: String(payload?.reply || fallback?.reply || ''),
    animationIntent: intent,
    animationKeywords: keywords.map(String),
    source: payload?.source || fallback?.source || 'local',
  };
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== '')
      .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
  );
}

// Emoji hints decorate displayed NPC lines; keep them out of the model input.
function stripPictographs(text) {
  return String(text || '')
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

// The stored per-NPC conversation becomes real chat turns, so the model sees
// ONE continuous dialogue instead of a JSON blob and stops looping over
// questions the player already answered.
function buildDialogueHistoryMessages(history, latestMessage) {
  const lines = (Array.isArray(history) ? history : [])
    .filter((line) => line && typeof line.text === 'string' && line.text.trim())
    .map((line) => ({
      role: line.speaker === 'player' ? 'user' : 'assistant',
      content: stripPictographs(line.text),
    }));

  // The client appends the player's line to the log before calling us; drop
  // that trailing duplicate so the final user turn appears exactly once.
  const last = lines[lines.length - 1];

  if (last && last.role === 'user' && last.content === stripPictographs(latestMessage)) {
    lines.pop();
  }

  return lines;
}

async function callRemoteDialogue(input, fallback) {
  const baseUrl =
    process.env.AI_TUNNEL_BASE_URL ||
    process.env.AI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    DEFAULT_AI_TUNNEL_BASE_URL;
  const apiKey =
    process.env.AI_TUNNEL_API_KEY ||
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  const model =
    process.env.AI_TUNNEL_MODEL ||
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    DEFAULT_AI_TUNNEL_MODEL;

  if (!baseUrl || !apiKey) {
    return null;
  }

  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const npc = input.npc || {};
  const context = input.context || {};
  const knownFacts = [
    context.playerName ? `The player's name is ${context.playerName}.` : '',
    context.playerOrigin ? `The player comes from ${context.playerOrigin}.` : '',
    Number.isFinite(Number(context.day)) ? `It is day ${context.day} in the village.` : '',
    Array.isArray(context.completedQuests) && context.completedQuests.length
      ? `The player already finished these quests: ${context.completedQuests.join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const system = [
    'You role-play a non-player character in a German-learning village game (Grünbach).',
    `Your character: ${npc.label || 'a villager'} - ${npc.role || 'a friendly villager'}.`,
    'The player is a beginner learning German.',
    'This is ONE continuous conversation; the previous turns are the messages before the last one. Remember everything said in them.',
    'NEVER ask again for information the player already gave in this conversation or in the known facts (name, origin, job and so on) - use it instead.',
    "First react briefly to the player's last message, then move the conversation forward: ask ONE short new question or make a remark about something not yet discussed.",
    knownFacts ? `Known facts: ${knownFacts}` : '',
    'Always answer in simple, correct German at A1 level: 1-2 short sentences, common words, present tense.',
    'Be warm, calm and encouraging. Never shout and never use ALL CAPS or many exclamation marks.',
    'You may gently correct the player in one short clause, then answer their question.',
    'Keep it small and everyday; do not invent a big plot or leave the village.',
    'Do not use emoji.',
    'Return only JSON with fields: reply, animationIntent, animationKeywords.',
    'Do not prefix the reply with the NPC name.',
    'animationKeywords must be 1-3 calm Mixamo hints like talking at watercooler, thinking, waving, standing greeting, pointing forward, acknowledging, thankful.',
  ]
    .filter(Boolean)
    .join(' ');

  const remoteResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(stripUndefined({
      model,
      messages: [
        { role: 'system', content: system },
        ...buildDialogueHistoryMessages(input.history, input.message || ''),
        { role: 'user', content: String(input.message || '') },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    })),
  });

  if (!remoteResponse.ok) {
    throw new Error(`AI engine ${remoteResponse.status}: ${await remoteResponse.text()}`);
  }

  const data = await remoteResponse.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);

  // A plain-text answer is still a usable reply - better than dropping to the
  // canned local fallback mid-conversation.
  if (!match) {
    const plain = content.trim();

    if (!plain) {
      throw new Error('AI engine returned an empty reply');
    }

    return normalizeDialoguePayload({ reply: plain, source: 'remote' }, fallback);
  }

  return normalizeDialoguePayload({ ...JSON.parse(match[0]), source: 'remote' }, fallback);
}

async function handleDialogue(request, response) {
  try {
    const input = await readJsonBody(request);
    const fallback = localReplyFor(input);
    const remote = await callRemoteDialogue(input, fallback).catch((error) => {
      console.warn(error.message);
      return null;
    });

    sendJson(response, 200, normalizeDialoguePayload(remote || fallback, fallback));
  } catch (error) {
    sendJson(response, 400, { error: error.message || 'Dialogue failed' });
  }
}

function getElevenLabsConfig() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId: process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID,
    modelId: process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL_ID,
    outputFormat: process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128',
  };
}

function cleanTextForSpeech(text) {
  return String(text || '')
    .replace(/^[^:]{1,32}:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function handleTts(request, response) {
  try {
    const input = await readJsonBody(request);
    const text = cleanTextForSpeech(input.text);
    const config = getElevenLabsConfig();
    const voiceId = input.voice_id || config.voiceId;

    if (!text) {
      sendJson(response, 400, { error: 'TTS text is empty' });
      return;
    }

    if (!config.apiKey) {
      sendJson(response, 503, {
        error: 'ELEVENLABS_API_KEY is not configured on the server',
      });
      return;
    }

    const endpoint = new URL(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
    );
    endpoint.searchParams.set('output_format', config.outputFormat);

    const ttsResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(stripUndefined({
        text,
        model_id: input.model_id || config.modelId,
        voice_settings: {
          stability: Number(process.env.ELEVENLABS_STABILITY || 0.45),
          similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY_BOOST || 0.75),
          style: Number(process.env.ELEVENLABS_STYLE || 0),
          use_speaker_boost: process.env.ELEVENLABS_SPEAKER_BOOST !== 'false',
        },
      })),
    });

    if (!ttsResponse.ok) {
      sendJson(response, ttsResponse.status, {
        error: `ElevenLabs ${ttsResponse.status}: ${await ttsResponse.text()}`,
      });
      return;
    }

    const data = await ttsResponse.json();

    sendJson(response, 200, {
      audio_base64: data.audio_base64,
      alignment: data.normalized_alignment || data.alignment || null,
      raw_alignment: data.alignment || null,
      voice_id: voiceId,
      model_id: input.model_id || config.modelId,
      output_format: config.outputFormat,
    });
  } catch (error) {
    sendJson(response, 400, { error: error.message || 'TTS failed' });
  }
}

function readRawBody(request, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;

      if (size > limit) {
        reject(new Error('Audio body is too large'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

// Whisper detects the audio format from the filename, so an mp4/ogg recording
// sent as .webm can be rejected. Map the recorder's content-type to a matching
// extension.
function audioFilename(contentType) {
  const ct = String(contentType || '').toLowerCase();

  if (ct.includes('mp4') || ct.includes('m4a') || ct.includes('aac')) {
    return 'speech.mp4';
  }

  if (ct.includes('ogg') || ct.includes('oga')) {
    return 'speech.ogg';
  }

  if (ct.includes('wav')) {
    return 'speech.wav';
  }

  if (ct.includes('mpeg') || ct.includes('mp3') || ct.includes('mpga')) {
    return 'speech.mp3';
  }

  return 'speech.webm';
}

function isLikelySubtitleHallucination(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[\s.,:;!?'"()[\]{}<>_-]+/g, ' ')
    .trim();

  return (
    normalized.includes('amara org') ||
    normalized.includes('untertitel der amara') ||
    normalized.includes('subtitles by the amara') ||
    normalized.includes('captions by the amara') ||
    normalized.includes('subtitle by the amara')
  );
}

// Primary STT: OpenAI-compatible Whisper. Prefer a real OpenAI key and host
// when present, otherwise use the AI tunnel. Pinning German keeps answers in
// Latin script for the quest parser.
async function transcribeWithWhisper(audio, contentType, language) {
  let baseUrl;
  let apiKey;

  if (process.env.OPENAI_API_KEY) {
    apiKey = process.env.OPENAI_API_KEY;
    baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  } else {
    apiKey = process.env.AI_TUNNEL_API_KEY || process.env.AI_API_KEY || '';
    baseUrl = process.env.AI_TUNNEL_BASE_URL || process.env.AI_BASE_URL || DEFAULT_AI_TUNNEL_BASE_URL;
  }

  if (!apiKey) {
    return null;
  }

  const form = new FormData();
  form.append('file', new Blob([audio], { type: contentType || 'audio/webm' }), audioFilename(contentType));
  form.append('model', process.env.STT_MODEL || 'whisper-1');

  if (language) {
    form.append('language', language);
  }

  const remoteResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!remoteResponse.ok) {
    throw new Error(`Whisper STT ${remoteResponse.status}: ${await remoteResponse.text()}`);
  }

  const data = await remoteResponse.json();
  return String(data.text || '').trim();
}

// Fallback STT: ElevenLabs Scribe (reuses the TTS key).
async function transcribeWithElevenLabs(audio, contentType, language) {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';

  if (!apiKey) {
    return null;
  }

  const form = new FormData();
  form.append('file', new Blob([audio], { type: contentType || 'audio/webm' }), audioFilename(contentType));
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v1');

  const code = process.env.ELEVENLABS_STT_LANGUAGE || language;

  if (code) {
    form.append('language_code', code);
  }

  const remoteResponse = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });

  if (!remoteResponse.ok) {
    throw new Error(`ElevenLabs STT ${remoteResponse.status}: ${await remoteResponse.text()}`);
  }

  const data = await remoteResponse.json();
  return String(data.text || '').trim();
}

async function handleStt(request, response) {
  try {
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    const language = url.searchParams.get('lang') || 'de';
    const contentType = request.headers['content-type'] || 'audio/webm';
    const audio = await readRawBody(request);

    if (!audio.length) {
      sendJson(response, 400, { error: 'Пустая аудиозапись' });
      return;
    }

    const providers = [
      { name: 'whisper', run: transcribeWithWhisper },
      { name: 'elevenlabs', run: transcribeWithElevenLabs },
    ];
    const errors = [];
    let hadProvider = false;
    let text = null;
    let provider = null;

    for (const candidate of providers) {
      try {
        const result = await candidate.run(audio, contentType, language);

        if (result === null || result === undefined) {
          continue;
        }

        hadProvider = true;

        if (!result) {
          errors.push(`${candidate.name}: empty transcript`);
          continue;
        }

        if (isLikelySubtitleHallucination(result)) {
          console.warn(`STT ${candidate.name} ignored subtitle hallucination: ${result}`);
          errors.push(`${candidate.name}: subtitle hallucination`);
          continue;
        }

        text = result;
        provider = candidate.name;
        break;
      } catch (error) {
        console.warn(`STT ${candidate.name} failed: ${error.message}`);
        errors.push(`${candidate.name}: ${error.message}`);
      }
    }

    if (text === null) {
      if (hadProvider) {
        sendJson(response, 200, {
          ok: false,
          error: 'Не расслышал речь. Проверьте выбранный микрофон и повторите фразу ближе к микрофону.',
          detail: errors.join(' | ') || undefined,
        });
      } else {
        sendJson(response, 503, {
          error:
            'Распознавание речи не настроено (нужен OPENAI_API_KEY или AI_TUNNEL_API_KEY для Whisper, либо ELEVENLABS_API_KEY).',
          detail: errors.join(' | ') || undefined,
        });
      }

      return;
    }

    console.log(`STT(${provider}) "${text}"`);
    sendJson(response, 200, { ok: true, text, provider });
  } catch (error) {
    sendJson(response, 400, { error: error.message || 'STT failed' });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);

  if (url.pathname === '/api/assets') {
    await sendAssetManifest(response);
    return;
  }

  if (url.pathname === '/api/dialogue' && request.method === 'POST') {
    await handleDialogue(request, response);
    return;
  }

  if (url.pathname === '/api/tts' && request.method === 'POST') {
    await handleTts(request, response);
    return;
  }

  if (url.pathname === '/api/stt' && request.method === 'POST') {
    await handleStt(request, response);
    return;
  }

  if (url.pathname === '/favicon.ico') {
    response.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
    response.end();
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  const filePath = url.pathname.startsWith(MIXAMO_URL_PREFIX)
    ? resolveMixamoFile(url.pathname)
    : resolveStaticFile(url.pathname);

  if (!filePath) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    const finalPath = fileStat.isDirectory()
      ? path.join(filePath, 'index.html')
      : filePath;
    const extension = path.extname(finalPath).toLowerCase();

    response.writeHead(200, {
      'Content-Type': mimeTypes.get(extension) || 'application/octet-stream',
      'Cache-Control': extension === '.glb' ? 'public, max-age=3600' : 'no-cache',
    });

    createReadStream(finalPath).pipe(response);
  } catch (error) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Berlin language nav game: http://${host}:${port}`);
});
