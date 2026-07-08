import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { NAV_KINDS, NAVMESH_CONFIG, getDefaultNavKind, getObjectNavName, normalizeText } from './navConfig.js';
import { NavigationSystem } from './navigation.js';
import { WorldRegistry } from './worldRegistry.js';
import { TextLipSync } from './lipsync.js';

const canvas = document.querySelector('#scene');
const statusElement = document.querySelector('#status');
const statusDot = document.querySelector('#status-dot');
const commandForm = document.querySelector('#command-form');
const commandInput = document.querySelector('#command-input');
const targetList = document.querySelector('#target-list');
const meshList = document.querySelector('#mesh-list');
const meshStats = document.querySelector('#mesh-stats');
const toggleNavmesh = document.querySelector('#toggle-navmesh');
const toggleTargets = document.querySelector('#toggle-targets');
const rebuildNavmeshButton = document.querySelector('#rebuild-navmesh');
const pickTargetButton = document.querySelector('#pick-target');
const copyTargetsButton = document.querySelector('#copy-targets');
const flyModeButton = document.querySelector('#fly-mode');
const cutNavmeshButton = document.querySelector('#cut-navmesh');
const cutRadiusInput = document.querySelector('#cut-radius');
const cutRadiusValue = document.querySelector('#cut-radius-value');
const undoCutButton = document.querySelector('#undo-cut');
const clearCutsButton = document.querySelector('#clear-cuts');
const pickForm = document.querySelector('#pick-form');
const pickDetails = document.querySelector('#pick-details');
const pickLabel = document.querySelector('#pick-label');
const pickAction = document.querySelector('#pick-action');
const pickCancel = document.querySelector('#pick-cancel');
const exportOutput = document.querySelector('#export-output');
const dialoguePanel = document.querySelector('.dialogue-panel');
const questStatus = document.querySelector('#quest-status');
const dialogueTarget = document.querySelector('#dialogue-target');
const dialogueLog = document.querySelector('#dialogue-log');
const questChips = document.querySelector('#quest-chips');
const dialogueForm = document.querySelector('#dialogue-form');
const dialogueInput = document.querySelector('#dialogue-input');
const dialogueSubmit = document.querySelector('#dialogue-submit');
const interactNpcButton = document.querySelector('#interact-npc');
const micButton = document.querySelector('#mic-button');
const micTranscript = document.querySelector('#mic-transcript');

if (dialogueInput) {
  dialogueInput.placeholder = 'Напишите или скажите 🎤 немецкую фразу';
}

const NAV_KIND_STORAGE_KEY = 'berlin-game.nav-kinds.v1';
const CUSTOM_TARGET_STORAGE_KEY = 'berlin-game.custom-targets.v1';
const DELETED_TARGET_STORAGE_KEY = 'berlin-game.deleted-targets.v1';
const NAV_AREA_BLOCK_STORAGE_KEY = 'berlin-game.nav-area-blocks.v1';
const MAP_URL = '/fantasy-town.glb';
const CHARACTER_MODEL_URL = '/Meshy_AI_Character_output.fbx';
const EMPTY_TEXTURE_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lb9ZfwAAAABJRU5ErkJggg==';
const NPC_ID = 'npc_character';
const NPC_LABEL = 'NPC';
const NPC_ALIASES = ['npc', 'нпс', 'персонаж', 'человек', 'mann', 'person', 'charakter', 'character'];

const NPC_INTERACTION_DISTANCE = 6;
const NPC_TALK_STOP_DISTANCE = 4.1;
const NPC_APPROACH_DISTANCE = 3;
const NPC_PATROL_WAIT_MIN = 1.2;
const NPC_PATROL_WAIT_MAX = 4.8;
const NPC_PATROL_REPATH_INTERVAL = 0.7;
const MAX_DIALOGUE_LINES = 12;

const QUEST_ENABLED = true;
const QUEST_GUARD_ID = 'guard_gate_01';
const QUEST_GUARD_LABEL = 'Bruno';
const QUEST_TRIGGER_ALERT = 12;
const QUEST_TRIGGER_HALT = 6;
const QUEST_TRIGGER_DIALOGUE = 3.2;
const QUEST_POINTS = {
  playerSpawn: new THREE.Vector3(58.8, 4.82, 133.2),
  guard: new THREE.Vector3(58.8, 4.82, 126.6),
  guardOpen: new THREE.Vector3(53.9, 4.82, 126.5),
  gate: new THREE.Vector3(58.8, 4.82, 131.5),
  insideVillage: new THREE.Vector3(58.8, 4.82, 116.5),
  plaza: new THREE.Vector3(58.8, 4.82, 61.1),
  market: new THREE.Vector3(78.0, 4.82, 73.0),
  well: new THREE.Vector3(34.2, 4.82, 115.5),
};
const QUEST_GUARD_IDLE_URL = '/Mixamo/glb/Idle%20Default%20beliner.glb';
// Used only when the asset manifest reports no rigged characters, so the gate
// still has a guard to talk to.
const QUEST_GUARD_MODEL_FALLBACK_URL =
  '/Mixamo/characters/Idle%20Meshy_AI_Police_Officer_in_T_P_0705154259_texture_YUP_baked.rigged.glb';
const QUEST_WALKABLE_RECTS = [
  { name: 'Quest_Walkable_Gate_Approach', x: 58.8, y: 4.82, z: 132.0, sx: 9, sz: 28 },
  { name: 'Quest_Walkable_Main_Street', x: 58.8, y: 4.82, z: 91.0, sx: 9, sz: 62 },
  { name: 'Quest_Walkable_Plaza', x: 58.8, y: 4.82, z: 61.1, sx: 48, sz: 42 },
  { name: 'Quest_Walkable_Market', x: 76.0, y: 4.82, z: 73.0, sx: 34, sz: 28 },
  { name: 'Quest_Walkable_Well', x: 37.0, y: 4.82, z: 113.0, sx: 28, sz: 30 },
];

const NPC_HOME_TARGET_SETS = [
  ['doener', 'haltestelle', 'mosche'],
  ['haltestelle', 'bank_an_der_haltestelle', 'doener'],
  ['das_haus_gegenueber_dem_cafe', 'stuehle_neben_dem_cafe', 'haltestelle'],
  ['die_tuer_in_den_markt', 'okolo_gruzovika', 'doener'],
  ['doener', 'stuehle_neben_dem_cafe', 'mosche'],
  ['bank_an_der_haltestelle', 'haltestelle', 'das_haus_gegenueber_dem_cafe'],
  ['mosche', 'okolo_gruzovika', 'haltestelle'],
];

const NPC_GROUND_POINTS = [
  { id: 'south_gate', x: 58.8, y: 4.7, z: 126.6 },
  { id: 'inside_gate', x: 58.8, y: 4.7, z: 116.5 },
  { id: 'village_plaza', x: 58.8, y: 4.3, z: 61.1 },
  { id: 'market_ring', x: 78.0, y: 4.6, z: 73.0 },
  { id: 'west_well', x: 34.2, y: 4.9, z: 115.5 },
  { id: 'north_bridge', x: -0.7, y: 4.7, z: 40.7 },
  { id: 'south_bridge', x: -2.1, y: 4.7, z: 99.0 },
];
const NPC_SPAWN_OFFSETS = [
  [0, 0],
  [1.8, 0.4],
  [-1.6, 0.7],
  [0.7, -1.5],
  [-0.9, -1.4],
  [1.3, 1.3],
  [-1.4, 1.2],
];
const NPC_GROUND_SNAP_MAX_Y_DELTA = 0.9;
const NPC_MIN_START_DISTANCE = 2.35;

const ELEVENLABS_VOICES = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  domi: 'AZnzlk1XvdvUeBnXmlld',
  bella: 'EXAVITQu4vr4xnSDxMaL',
  antoni: 'ErXwobaYiN019PkySvjV',
  elli: 'MF3mGyEYCl7XYWbV9V6O',
  josh: 'TxGEqnHWrfWFTfGW9Xj',
  arnold: 'VR6AewLTigWG4xSOukaG',
  adam: 'pNInz6obpgDQGcFmaJgB',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
};
const NPC_VOICE_FALLBACKS = [
  ELEVENLABS_VOICES.josh,
  ELEVENLABS_VOICES.rachel,
  ELEVENLABS_VOICES.antoni,
  ELEVENLABS_VOICES.elli,
  ELEVENLABS_VOICES.adam,
  ELEVENLABS_VOICES.bella,
  ELEVENLABS_VOICES.sam,
];

const DIALOGUE_ANIMATION_HINTS = {
  greeting: ['standing greeting', 'waving', 'acknowledging'],
  thinking: ['thinking', 'look around', 'looking'],
  thankful: ['thankful', 'quick formal bow', 'acknowledging'],
  negative: ['shaking head no', 'dismissing gesture', 'annoyed head shake'],
  happy: ['laughing', 'happy hand gesture', 'happy idle'],
  helpful: ['pointing forward', 'acknowledging', 'talking at watercooler'],
  talk: ['talking at watercooler', 'telling a secret', 'acknowledging'],
};

const MIXAMO_ACTION_HINTS = [
  {
    command: ['idle', 'стоять', 'стой', 'warte', 'stehen'],
    clip: ['idle', 'breathing', 'standing'],
    loop: true,
  },
  {
    command: ['walk', 'walking', 'иди', 'идти', 'gehen', 'lauf langsam'],
    clip: ['walk', 'walking'],
    loop: true,
  },
  {
    command: ['run', 'running', 'беги', 'бежать', 'rennen', 'lauf'],
    clip: ['run', 'running', 'jog'],
    loop: true,
  },
  {
    command: ['sit', 'sitzen', 'setze', 'садись', 'сядь', 'сесть'],
    clip: ['sit', 'sitting', 'sitzen'],
    loop: false,
  },
  {
    command: ['dance', 'dancing', 'танцуй', 'танцевать', 'tanz', 'tanzen'],
    clip: ['dance', 'dancing', 'tut hip hop', 'salsa', 'rumba', 'samba'],
    loop: true,
  },
  {
    command: ['jump', 'jumping', 'прыгай', 'прыгни', 'springen', 'sprung'],
    clip: ['jump', 'jumping'],
    loop: false,
  },
  {
    command: ['wave', 'waving', 'помаши', 'маши', 'winken'],
    clip: ['wave', 'waving'],
    loop: false,
  },
  {
    command: ['clap', 'clapping', 'хлопай', 'аплодируй', 'klatschen'],
    clip: ['clap', 'clapping', 'applause'],
    loop: false,
  },
  {
    command: ['talk', 'talking', 'говори', 'разговаривай', 'reden', 'sprechen'],
    clip: ['talk', 'talking', 'conversation'],
    loop: true,
  },
  {
    command: ['greet', 'greeting', 'hello', 'hallo', 'wave'],
    clip: ['greeting', 'waving', 'acknowledging'],
    loop: false,
  },
  {
    command: ['agree', 'yes', 'nod', 'ok', 'ja'],
    clip: ['agreeing', 'acknowledging', 'head nod yes'],
    loop: false,
  },
  {
    command: ['no', 'nein', 'disagree', 'dismiss', 'negative'],
    clip: ['shaking head no', 'dismissing', 'annoyed'],
    loop: false,
  },
  {
    command: ['think', 'thinking', 'question', 'wonder'],
    clip: ['thinking', 'looking', 'look around'],
    loop: false,
  },
  {
    command: ['happy', 'laugh', 'smile', 'funny'],
    clip: ['laughing', 'happy hand gesture', 'happy idle'],
    loop: false,
  },
  {
    command: ['sad', 'tired', 'sorry'],
    clip: ['sad idle', 'disappointed', 'yawn'],
    loop: false,
  },
  {
    command: ['thanks', 'thankful', 'danke', 'bow'],
    clip: ['thankful', 'quick formal bow', 'relieved sigh'],
    loop: false,
  },
  {
    command: ['point', 'show', 'help', 'direction'],
    clip: ['pointing forward', 'acknowledging', 'talking at watercooler'],
    loop: false,
  },
  {
    command: ['surprise', 'surprised', 'wow'],
    clip: ['surprised', 'nervously look around', 'look around'],
    loop: false,
  },
  {
    command: ['punch', 'boxing', 'бей', 'ударь', 'boxen', 'schlag'],
    clip: ['punch', 'boxing', 'jab', 'hook'],
    loop: false,
  },
  {
    command: ['kick', 'пни', 'удар ногой', 'tritt'],
    clip: ['kick', 'kicking'],
    loop: false,
  },
  {
    command: ['crouch', 'crouching', 'присядь', 'duck', 'hocken'],
    clip: ['crouch', 'crouching'],
    loop: true,
  },
  {
    command: ['crawl', 'ползти', 'ползи', 'kriechen'],
    clip: ['crawl', 'crawling'],
    loop: true,
  },
  {
    command: ['fall', 'falling', 'упади', 'падай', 'fallen'],
    clip: ['fall', 'falling'],
    loop: false,
  },
  {
    command: ['death', 'die', 'умри', 'sterben'],
    clip: ['death', 'dying', 'die'],
    loop: false,
  },
  {
    command: ['turn', 'повернись', 'drehen'],
    clip: ['turn', 'turning'],
    loop: false,
  },
];

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x89aebc);
scene.fog = new THREE.Fog(0x89aebc, 90, 260);

const camera = new THREE.PerspectiveCamera(68, 1, 0.05, 600);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let lastFrameTime = performance.now();

const sun = new THREE.DirectionalLight(0xffffff, 2.8);
sun.position.set(-20, 45, 20);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xddeeff, 0x4b584f, 2.4));

const targetMarkers = new THREE.Group();
targetMarkers.name = 'Target_Markers';
scene.add(targetMarkers);

const characterRig = new THREE.Group();
characterRig.name = 'NPC_Rig';
scene.add(characterRig);

const npcContainer = new THREE.Group();
npcContainer.name = 'City_NPCs';
scene.add(npcContainer);

const navAreaBlockMarkers = new THREE.Group();
navAreaBlockMarkers.name = 'Nav_Area_Block_Markers';
scene.add(navAreaBlockMarkers);

let cityRoot = null;
let navigation = null;
let registry = null;
let meshInfos = [];
let navKindOverrides = loadNavKindOverrides();
let customTargets = loadCustomTargets();
let deletedTargetIds = loadDeletedTargetIds();
let navAreaBlocks = loadNavAreaBlocks();
let lookYaw = 0;
let lookPitch = -0.08;
let pointerStart = null;
let isPointerDragging = false;
let isPickMode = false;
let isFlyMode = false;
let isCutMode = false;
let pendingPick = null;
const pressedKeys = new Set();
let characterModel = null;
let characterMixer = null;
let currentCharacterAction = null;
let currentCharacterAnimationName = null;
const characterAnimations = new Map();
const characterAnimationAliases = new Map();
const characterAnimationMeta = new Map();
let npcTarget = null;
let npcs = [];
const npcById = new Map();
let selectedNpc = null;
let nearbyNpc = null;
let pendingDialogue = null;
let lastNpcUiRefresh = 0;
let audioUnlockPromise = null;
let gameAudioUnlocked = false;
const questState = {
  stage: 'approach',
  alerted: false,
  halted: false,
  completed: false,
  playerName: '',
  playerOrigin: '',
  attempts: 0,
  currentLine: null,
};

const agent = {
  position: new THREE.Vector3(0, 0, 0),
  yaw: 0,
  eyeHeight: 1.66,
  speed: 3.1,
  path: [],
  pathIndex: 0,
  pendingAction: null,
  pendingNpcAction: null,
  pendingArrivalPoint: null,
};

window.__berlinGame = {
  get agent() {
    return agent;
  },
  get navigation() {
    return navigation;
  },
  get registry() {
    return registry;
  },
  get meshInfos() {
    return meshInfos;
  },
  get customTargets() {
    return customTargets;
  },
  get deletedTargetIds() {
    return [...deletedTargetIds];
  },
  get navAreaBlocks() {
    return navAreaBlocks;
  },
  get characterAnimations() {
    return [...characterAnimations.keys()];
  },
  exportCustomTargets,
  executeCommand,
  unlockGameAudio,
  moveToTarget,
  playCharacterAnimation,
};

function setStatus(message, state = 'loading') {
  statusElement.textContent = message;
  statusDot.classList.toggle('ready', state === 'ready');
  statusDot.classList.toggle('error', state === 'error');
  publishDebugState();
}

function isGameAudioUnlocked() {
  return gameAudioUnlocked && TextLipSync.isAudioUnlocked();
}

async function unlockGameAudio(options = {}) {
  if (isGameAudioUnlocked()) {
    return true;
  }

  if (audioUnlockPromise) {
    return audioUnlockPromise;
  }

  audioUnlockPromise = TextLipSync.unlockAudio()
    .then((unlocked) => {
      gameAudioUnlocked = unlocked;

      if (unlocked && options.showStatus) {
        setStatus('Звук NPC включен', 'ready');
      }

      return unlocked;
    })
    .catch((error) => {
      gameAudioUnlocked = false;
      console.warn('Audio unlock failed:', error);

      if (options.showStatus) {
        setStatus('Кликните по игре или нажмите Enter, чтобы включить звук NPC', 'ready');
      }

      return false;
    })
    .finally(() => {
      audioUnlockPromise = null;
    });

  return audioUnlockPromise;
}

function requestGameAudioUnlock(options = {}) {
  unlockGameAudio(options).catch((error) => {
    console.warn('Audio unlock request failed:', error);
  });
}

function installQuestWalkables(root) {
  if (!QUEST_ENABLED || !root) {
    return;
  }

  root.getObjectByName('Quest_Walkables')?.removeFromParent();

  const group = new THREE.Group();
  group.name = 'Quest_Walkables';

  for (const rect of QUEST_WALKABLE_RECTS) {
    const geometry = new THREE.PlaneGeometry(rect.sx, rect.sz);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
    });
    material.visible = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = rect.name;
    mesh.position.set(rect.x, rect.y, rect.z);
    mesh.userData.navmesh = 'walkable';
    mesh.userData.navName = rect.name;
    mesh.raycast = () => {};
    group.add(mesh);
  }

  root.add(group);
}

function serializeVector(vector) {
  if (!vector) {
    return null;
  }

  return {
    x: Number(vector.x.toFixed(3)),
    y: Number(vector.y.toFixed(3)),
    z: Number(vector.z.toFixed(3)),
  };
}

function publishDebugState() {
  const lastPathDebug = navigation?.lastPathDebug || null;
  const targets = registry?.targets.map((target) => ({
    id: target.id,
    label: target.label,
    type: target.type,
    source: target.source,
    center: serializeVector(target.center),
    approach: serializeVector(target.approachPoint),
    route: serializeVector(target.routePoint),
    arrival: serializeVector(target.arrivalPoint),
    pathLength: target.routePoint || target.approachPoint ? null : 0,
  }));

  if (navigation) {
    navigation.lastPathDebug = lastPathDebug;
  }

  document.body.dataset.debugState = JSON.stringify({
    status: statusElement.textContent,
    agent: serializeVector(agent.position),
    navStats: navigation?.stats || null,
    lastPathDebug,
    customTargets,
    deletedTargetIds: [...deletedTargetIds],
    navAreaBlocks,
    flyMode: isFlyMode,
    cutMode: isCutMode,
    quest: {
      enabled: QUEST_ENABLED,
      stage: questState.stage,
      alerted: questState.alerted,
      halted: questState.halted,
      completed: questState.completed,
      playerName: questState.playerName,
      playerOrigin: questState.playerOrigin,
    },
    character: {
      loaded: Boolean(characterModel),
      animations: [...characterAnimations.keys()],
      currentAnimation: currentCharacterAnimationName,
      role: 'npc',
      target: npcTarget
        ? {
            id: npcTarget.id,
            label: npcTarget.label,
            center: serializeVector(npcTarget.center),
            route: serializeVector(npcTarget.routePoint),
          }
        : null,
    },
    npcs: npcs.map((npc) => ({
      id: npc.id,
      label: npc.label,
      role: npc.role,
      loaded: Boolean(npc.model),
      state: npc.state,
      currentAnimation: npc.currentAnimationName,
      idleAnimation: npc.idleAnimationName,
      position: serializeVector(npc.root?.position),
      target: serializeVector(npc.target?.center),
      pathLength: npc.path?.length || 0,
      lipSyncTargets: npc.mouth?.targets?.length || 0,
    })),
    selectedNpc: selectedNpc?.id || null,
    nearbyNpc: nearbyNpc?.id || null,
    targets: targets || [],
  });
}

function loadNavKindOverrides() {
  try {
    return JSON.parse(localStorage.getItem(NAV_KIND_STORAGE_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function saveNavKindOverrides() {
  localStorage.setItem(NAV_KIND_STORAGE_KEY, JSON.stringify(navKindOverrides));
}

function loadCustomTargets() {
  try {
    const value = JSON.parse(localStorage.getItem(CUSTOM_TARGET_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveCustomTargets() {
  localStorage.setItem(CUSTOM_TARGET_STORAGE_KEY, JSON.stringify(customTargets));
}

function loadDeletedTargetIds() {
  try {
    const value = JSON.parse(localStorage.getItem(DELETED_TARGET_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter(Boolean) : []);
  } catch (error) {
    return new Set();
  }
}

function saveDeletedTargetIds() {
  localStorage.setItem(DELETED_TARGET_STORAGE_KEY, JSON.stringify([...deletedTargetIds]));
}

function loadNavAreaBlocks() {
  try {
    const value = JSON.parse(localStorage.getItem(NAV_AREA_BLOCK_STORAGE_KEY) || '[]');

    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((area) => ({
        id: String(area.id || `cut_${Date.now()}`),
        x: Number(area.x),
        y: Number(area.y),
        z: Number(area.z),
        radius: Number(area.radius),
      }))
      .filter((area) =>
        Number.isFinite(area.x) &&
        Number.isFinite(area.y) &&
        Number.isFinite(area.z) &&
        Number.isFinite(area.radius) &&
        area.radius > 0,
      );
  } catch (error) {
    return [];
  }
}

function saveNavAreaBlocks() {
  localStorage.setItem(NAV_AREA_BLOCK_STORAGE_KEY, JSON.stringify(navAreaBlocks));
}

function exportNavAreaBlocks() {
  return navAreaBlocks.map((area) => ({
    id: String(area.id),
    x: Number(area.x),
    y: Number(area.y),
    z: Number(area.z),
    radius: Number(area.radius),
  }));
}

function createIdFromLabel(label) {
  return (
    label
      .toLocaleLowerCase('de-DE')
      .replace(/ß/g, 'ss')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '') || `ziel_${Date.now()}`
  );
}

function serializePoint(vector) {
  return {
    x: Number(vector.x.toFixed(4)),
    y: Number(vector.y.toFixed(4)),
    z: Number(vector.z.toFixed(4)),
  };
}

function getAssetName(url) {
  const filename = decodeURIComponent(String(url || '').split('/').pop() || 'animation');
  return filename.replace(/\.[^.]+$/, '');
}

function uniqueUrls(urls) {
  const seen = new Set();

  return urls.filter((url) => {
    const key = decodeURIComponent(String(url || '')).toLocaleLowerCase('en-US');

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function humanizeAnimationName(name) {
  return String(name || 'animation')
    .replace(/mixamo\.com/gi, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'animation';
}

function addAnimationAlias(alias, animationName) {
  const normalized = normalizeText(alias);

  if (!normalized || !animationName) {
    return;
  }

  if (!characterAnimationAliases.has(normalized)) {
    characterAnimationAliases.set(normalized, animationName);
  }
}

function findAnimationByClipKeywords(keywords) {
  const normalizedKeywords = keywords.map(normalizeText).filter(Boolean);

  for (const keyword of normalizedKeywords) {
    for (const [name] of characterAnimations) {
      const normalizedName = normalizeText(name);

      if (normalizedName.includes(keyword)) {
        return name;
      }
    }

    for (const [alias, name] of characterAnimationAliases) {
      if (alias.includes(keyword)) {
        return name;
      }
    }
  }

  return null;
}

function registerCharacterClip(clip, sourceName, meta = {}) {
  if (!clip) {
    return null;
  }

  const baseName = humanizeAnimationName(sourceName || clip.name || `animation ${characterAnimations.size + 1}`);
  let name = baseName;
  let suffix = 2;

  while (characterAnimations.has(name)) {
    name = `${baseName} ${suffix}`;
    suffix += 1;
  }

  const clonedClip = clip.clone();
  clonedClip.name = name;
  characterAnimations.set(name, clonedClip);
  characterAnimationMeta.set(name, {
    loop: meta.loop ?? !/jump|fall|death|punch|kick|wave|clap|sit|nod|shrug|bow|thank|laugh|point|surpris|dismiss|annoy|yell|pout|yawn/i.test(name),
    source: sourceName || clip.name || name,
  });

  addAnimationAlias(name, name);
  addAnimationAlias(baseName, name);
  addAnimationAlias(sourceName, name);
  addAnimationAlias(clip.name, name);

  for (const hint of MIXAMO_ACTION_HINTS) {
    const clipMatches = hint.clip.some((keyword) => normalizeText(name).includes(normalizeText(keyword)));

    if (!clipMatches) {
      continue;
    }

    characterAnimationMeta.set(name, {
      ...characterAnimationMeta.get(name),
      loop: hint.loop,
    });

    for (const alias of hint.command) {
      addAnimationAlias(alias, name);
    }
  }

  return name;
}

function getTrackTargetName(trackName) {
  return String(trackName || '').split('.')[0] || '';
}

function getAnimationTargetNames(root) {
  const names = new Set();

  root?.traverse?.((object) => {
    if (!object.name) {
      return;
    }

    names.add(object.name);
    names.add(THREE.PropertyBinding.sanitizeNodeName(object.name));
  });

  return names;
}

function getNpcAnimationClip(npc, animationName) {
  if (!npc || !characterAnimations.has(animationName)) {
    return null;
  }

  if (!npc.compatibleAnimationClips) {
    npc.compatibleAnimationClips = new Map();
  }

  if (npc.compatibleAnimationClips.has(animationName)) {
    return npc.compatibleAnimationClips.get(animationName);
  }

  const clip = characterAnimations.get(animationName);
  const targetNames = getAnimationTargetNames(npc.root);
  const tracks = clip.tracks.filter((track) => targetNames.has(getTrackTargetName(track.name)));
  const compatibleClip =
    tracks.length === clip.tracks.length
      ? clip
      : new THREE.AnimationClip(clip.name, clip.duration, tracks);

  compatibleClip.blendMode = clip.blendMode;
  npc.compatibleAnimationClips.set(animationName, compatibleClip);

  return compatibleClip;
}

function findAnimationCommand(input) {
  const normalized = normalizeText(input);
  let best = null;
  let bestScore = 0;

  for (const [alias, name] of characterAnimationAliases) {
    if (!normalized.includes(alias)) {
      continue;
    }

    const score = alias.length;

    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }

  if (best) {
    return {
      name: best,
      loop: characterAnimationMeta.get(best)?.loop ?? true,
    };
  }

  for (const hint of MIXAMO_ACTION_HINTS) {
    const commandMatches = hint.command.some((keyword) => normalized.includes(normalizeText(keyword)));

    if (!commandMatches) {
      continue;
    }

    const name = findAnimationByClipKeywords(hint.clip);

    if (name) {
      return { name, loop: hint.loop };
    }

    if (characterAnimations.size === 1) {
      const [singleName] = characterAnimations.keys();
      return { name: singleName, loop: hint.loop };
    }
  }

  return null;
}

function inputMentionsNpc(input) {
  const normalized = normalizeText(input);
  const aliases = [
    ...NPC_ALIASES,
    ...npcs.flatMap((npc) => [npc.id, npc.label, ...(npc.aliases || [])]),
  ];

  return aliases.some((alias) => normalized.includes(normalizeText(alias)));
}

function createNpcTarget(point) {
  const center = point.clone();

  return {
    id: NPC_ID,
    label: NPC_LABEL,
    aliases: NPC_ALIASES,
    action: 'interact',
    type: 'interactive',
    source: 'npc',
    hiddenFromList: false,
    object: characterModel,
    box: null,
    center,
    size: new THREE.Vector3(1, 1.8, 1),
    approachPoint: center.clone(),
    routePoint: center.clone(),
    arrivalPoint: center.clone(),
    isPointTarget: true,
  };
}

function placeNpcTarget() {
  syncAllNpcTargets();
  npcTarget = (selectedNpc || nearbyNpc || npcs[0])?.target || null;
}

function getNpcTarget() {
  const npc = selectedNpc || nearbyNpc || getNearestNpc() || npcs[0] || null;
  npcTarget = npc?.target || null;
  return npcTarget;
}

function playCharacterAnimation(animationName, options = {}) {
  if (!characterMixer || !characterAnimations.has(animationName)) {
    return false;
  }

  const clip = characterAnimations.get(animationName);
  const action = characterMixer.clipAction(clip);
  const meta = characterAnimationMeta.get(animationName) || {};
  const shouldLoop = options.loop ?? meta.loop ?? true;

  action.reset();
  action.enabled = true;
  action.clampWhenFinished = !shouldLoop;
  action.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, shouldLoop ? Infinity : 1);

  if (currentCharacterAction && currentCharacterAction !== action) {
    currentCharacterAction.fadeOut(options.fade ?? 0.18);
  }

  action.fadeIn(options.fade ?? 0.18).play();
  currentCharacterAction = action;
  currentCharacterAnimationName = animationName;
  publishDebugState();
  return true;
}

function playPreferredCharacterAnimation(keywords, options = {}) {
  const name = findAnimationByClipKeywords(keywords);

  if (!name || currentCharacterAnimationName === name) {
    return false;
  }

  return playCharacterAnimation(name, options);
}

function normalizeCharacterModel(model) {
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const height = box.max.y - box.min.y;

  if (Number.isFinite(height) && height > 0.001) {
    model.scale.multiplyScalar(1.72 / height);
  }

  model.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = scaledBox.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= scaledBox.min.y;
}

function setupCharacterModel(model, sourceUrl) {
  characterRig.clear();
  characterAnimations.clear();
  characterAnimationAliases.clear();
  characterAnimationMeta.clear();
  currentCharacterAction = null;
  currentCharacterAnimationName = null;
  characterModel = model;
  characterModel.name = 'NPC_Character';

  characterModel.traverse((object) => {
    if (!object.isMesh) {
      return;
    }

    object.frustumCulled = false;
    object.castShadow = false;
    object.receiveShadow = true;
  });

  normalizeCharacterModel(characterModel);
  characterRig.add(characterModel);
  characterRig.visible = true;

  if (npcTarget) {
    npcTarget.object = characterModel;
    characterRig.position.copy(npcTarget.center);
  }

  characterMixer = new THREE.AnimationMixer(characterModel);
  characterMixer.addEventListener('finished', () => {
    playPreferredCharacterAnimation(['idle', 'standing', 'breathing'], { loop: true });
  });

  for (const clip of characterModel.animations || []) {
    registerCharacterClip(clip, getAssetName(sourceUrl) || clip.name);
  }

  playPreferredCharacterAnimation(['idle', 'standing', 'breathing'], { loop: true, fade: 0 });
  publishDebugState();
}

function loadFbx(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function loadGltf(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

async function loadAssetManifest() {
  try {
    const response = await fetch('/api/assets', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`assets manifest ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.warn(error);
    return {
      character: CHARACTER_MODEL_URL,
      animations: [],
      fbxFiles: [CHARACTER_MODEL_URL],
      characters: [],
      bodyAnimations: [],
    };
  }
}

async function loadCharacterAndAnimations() {
  let FBXLoader;

  try {
    ({ FBXLoader } = await import('three/addons/loaders/FBXLoader.js'));
  } catch (error) {
    console.error(error);
    setStatus('FBXLoader не загрузился, навигация работает без персонажа', 'error');
    return;
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const value = String(url || '');

    if (
      value.startsWith('data:') ||
      value.startsWith('blob:') ||
      value.endsWith('.fbx') ||
      value.includes('/Meshy_AI_Character_output.fbx')
    ) {
      return value;
    }

    return EMPTY_TEXTURE_URL;
  });

  const loader = new FBXLoader(manager);
  const manifest = await loadAssetManifest();
  const characterUrl = manifest.character || CHARACTER_MODEL_URL;

  try {
    const model = await loadFbx(loader, characterUrl);
    setupCharacterModel(model, characterUrl);
  } catch (error) {
    console.error(error);
    setStatus('Не удалось загрузить FBX персонажа', 'error');
    return;
  }

  const animationUrls = (manifest.animations || []).filter((url) => url !== characterUrl);
  const results = await Promise.allSettled(
    animationUrls.map(async (url) => {
      const animationFbx = await loadFbx(loader, url);
      const clips = animationFbx.animations || [];

      for (const clip of clips) {
        registerCharacterClip(clip, getAssetName(url) || clip.name);
      }
    }),
  );
  const failed = results.filter((result) => result.status === 'rejected').length;

  if (failed) {
    console.warn(`Не загрузились Mixamo FBX animations: ${failed}`);
  }

  playPreferredCharacterAnimation(['idle', 'standing', 'breathing'], { loop: true, fade: 0 });
  publishDebugState();
}

function getNpcById(id) {
  return npcById.get(id) || null;
}

function getNpcForTargetId(targetId) {
  const npc = getNpcById(targetId);

  if (npc) {
    return npc;
  }

  for (const item of npcs) {
    if (item.target?.id === targetId || item.target?.npcId === targetId) {
      return item;
    }
  }

  return null;
}

function getAssetLabel(url) {
  const label = decodeURIComponent(String(url || '').split('/').pop() || 'character')
    .replace(/\.rigged\.glb$/i, '')
    .replace(/_YUP_baked/gi, '')
    .replace(/_Y_UP_baked/gi, '')
    .replace(/Meshy_AI_/gi, '')
    .replace(/\d{10,}_texture/gi, '')
    .replace(/\bidle on\b/gi, '')
    .replace(/\bIdle\b/gi, '')
    .replace(/\bon\b/gi, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return label || 'Character';
}

function getNpcRoleForLabel(label) {
  const normalized = normalizeText(label);

  if (/police|officer/.test(normalized)) {
    return 'police officer';
  }

  if (/chef|cook|welcoming/.test(normalized)) {
    return 'street food chef';
  }

  if (/elder|elderly|old/.test(normalized)) {
    return 'elderly city resident';
  }

  if (/hijabi|professional/.test(normalized)) {
    return 'local professional';
  }

  if (/sage|desert/.test(normalized)) {
    return 'calm older resident';
  }

  if (/berliner|man/.test(normalized)) {
    return 'berliner resident';
  }

  if (/olive|coat/.test(normalized)) {
    return 'city resident in an olive coat';
  }

  return 'city character';
}

function getNpcVoiceId(label, index) {
  const normalized = normalizeText(label);

  if (/police|officer/.test(normalized)) {
    return ELEVENLABS_VOICES.arnold;
  }

  if (/chef|cook|welcoming/.test(normalized)) {
    return ELEVENLABS_VOICES.antoni;
  }

  if (/elder|elderly|old/.test(normalized)) {
    return ELEVENLABS_VOICES.sam;
  }

  if (/hijabi|professional/.test(normalized)) {
    return ELEVENLABS_VOICES.rachel;
  }

  if (/sage|desert/.test(normalized)) {
    return ELEVENLABS_VOICES.adam;
  }

  if (/berliner|man/.test(normalized)) {
    return ELEVENLABS_VOICES.josh;
  }

  if (/olive|coat/.test(normalized)) {
    return ELEVENLABS_VOICES.bella;
  }

  return NPC_VOICE_FALLBACKS[index % NPC_VOICE_FALLBACKS.length];
}

function makeNpcSlot(index, url) {
  const label = getAssetLabel(url);

  if (QUEST_ENABLED && index === 0) {
    return {
      id: QUEST_GUARD_ID,
      label: QUEST_GUARD_LABEL,
      role: 'Bruno, the friendly and calm gate guard of Grünbach village',
      // Calm, warm voice (not the loud Arnold) so he doesn't come across as
      // shouting.
      voiceId: ELEVENLABS_VOICES.adam,
      idleKeywords: ['idle default beliner', 'idle default', 'standing idle'],
      aliases: [QUEST_GUARD_LABEL, 'bruno', 'guard', 'wachmann', 'wache', 'стражник', 'охранник'],
      homeTargetIds: [],
      stationary: true,
    };
  }

  const id = createIdFromLabel(`npc_${label}_${index + 1}`);

  return {
    id,
    label,
    role: getNpcRoleForLabel(label),
    voiceId: getNpcVoiceId(label, index),
    aliases: [label, 'npc', 'person', 'character'],
    homeTargetIds: NPC_HOME_TARGET_SETS[index % NPC_HOME_TARGET_SETS.length],
  };
}

function createNpcTargetFromNpc(npc) {
  const center = npc.root.position.clone();
  const approach = getNpcApproachPoint(npc);

  return {
    id: npc.id,
    npcId: npc.id,
    label: npc.label,
    aliases: [...(npc.aliases || []), npc.label, 'npc', 'person', 'character'],
    action: 'interact',
    type: 'interactive',
    source: 'npc',
    hiddenFromList: false,
    object: npc.root,
    box: null,
    center,
    size: new THREE.Vector3(1, 1.8, 1),
    approachPoint: approach.clone(),
    routePoint: approach.clone(),
    arrivalPoint: approach.clone(),
    isPointTarget: true,
  };
}

function getNpcApproachPoint(npc) {
  const center = npc.root.position.clone();
  const toAgent = agent.position.clone().sub(center);
  toAgent.y = 0;

  if (toAgent.lengthSq() < 0.01) {
    toAgent.set(-Math.sin(npc.root.rotation.y), 0, -Math.cos(npc.root.rotation.y));
  }

  toAgent.normalize();

  const candidates = [];

  for (const angle of [0, Math.PI / 5, -Math.PI / 5, Math.PI / 3, -Math.PI / 3, Math.PI]) {
    candidates.push(
      center.clone().addScaledVector(
        toAgent.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle),
        NPC_APPROACH_DISTANCE,
      ),
    );
  }

  for (const candidate of candidates) {
    const point = getSameLevelNavPoint(candidate);

    if (point) {
      return point;
    }
  }

  return candidates[0] || center;
}

function syncNpcTarget(npc) {
  if (!npc?.target) {
    return;
  }

  const approachPoint = getNpcApproachPoint(npc);

  npc.target.center.copy(npc.root.position);
  npc.target.approachPoint.copy(approachPoint);
  npc.target.routePoint.copy(approachPoint);
  npc.target.arrivalPoint.copy(approachPoint);

  if (npc.marker) {
    npc.marker.position.copy(npc.root.position).add(new THREE.Vector3(0, 1.35, 0));
  }
}

function syncAllNpcTargets() {
  for (const npc of npcs) {
    syncNpcTarget(npc);
  }
}

function routePointForTargetId(targetId) {
  const target = registry?.getById(targetId);
  return target?.routePoint || target?.approachPoint || target?.center || null;
}

function createGroundPoint(point, offsetIndex = 0) {
  const offset = NPC_SPAWN_OFFSETS[offsetIndex % NPC_SPAWN_OFFSETS.length] || [0, 0];
  const ring = Math.floor(offsetIndex / NPC_SPAWN_OFFSETS.length);
  const spread = ring * 0.7;

  return new THREE.Vector3(
    point.x + offset[0] + spread,
    point.y,
    point.z + offset[1] - spread,
  );
}

function getSameLevelNavPoint(point) {
  const snapped = navigation?.snapToNavMesh(point, { allowFallback: false });

  if (snapped && Math.abs(snapped.y - point.y) <= NPC_GROUND_SNAP_MAX_Y_DELTA) {
    return snapped;
  }

  return null;
}

function snapToNpcGround(point) {
  return getSameLevelNavPoint(point) || point.clone();
}

function isNpcStartPointFree(point, ignoredNpc = null) {
  for (const npc of npcs) {
    if (npc === ignoredNpc) {
      continue;
    }

    const dx = point.x - npc.root.position.x;
    const dz = point.z - npc.root.position.z;

    if (dx * dx + dz * dz < NPC_MIN_START_DISTANCE * NPC_MIN_START_DISTANCE) {
      return false;
    }
  }

  return true;
}

function createNpcSpawnCandidates(slot, index, total) {
  const candidates = [];
  const baseStart = index % NPC_GROUND_POINTS.length;

  for (let i = 0; i < NPC_GROUND_POINTS.length; i += 1) {
    const groundPoint = NPC_GROUND_POINTS[(baseStart + i) % NPC_GROUND_POINTS.length];
    candidates.push(createGroundPoint(groundPoint, index + i));
  }

  for (const targetId of slot.homeTargetIds || []) {
    const point = routePointForTargetId(targetId);

    if (point) {
      candidates.push(point.clone());
    }
  }

  return candidates.map((point) => snapToNpcGround(point));
}

function placeNpcOnNavmesh(npc, index, total) {
  if (npc?.id === QUEST_GUARD_ID) {
    const point = snapToNpcGround(QUEST_POINTS.guard);
    npc.root.position.copy(point);
    npc.root.rotation.y = Math.atan2(QUEST_POINTS.playerSpawn.x - point.x, QUEST_POINTS.playerSpawn.z - point.z);
    syncNpcTarget(npc);
    return;
  }

  const candidates = createNpcSpawnCandidates(npc, index, total);
  const point =
    candidates.find((candidate) => isNpcStartPointFree(candidate, npc)) ||
    candidates[0] ||
    agent.position.clone();

  npc.root.position.copy(point);
  npc.root.rotation.y = angleToAgent(npc.root.position);
  syncNpcTarget(npc);
}

const _groundBox = new THREE.Box3();
const _groundVertex = new THREE.Vector3();

// Lowest world-space Y across an object's meshes, honouring skeletal skinning.
// THREE.Box3.setFromObject() reads the bind-pose geometry and ignores bone
// transforms, so for an animated SkinnedMesh it returns the T-pose bounds. A
// Mixamo idle then shifts the body up via its Hips track, which is exactly why
// the character floats. We sample the actually-deformed vertices for skinned
// meshes (falling back to the bounding box otherwise) so grounding matches what
// the player sees on screen.
function computeSkinnedMinWorldY(object) {
  object.updateMatrixWorld(true);
  let minY = Infinity;

  object.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    if (
      child.isSkinnedMesh &&
      typeof child.getVertexPosition === 'function' &&
      child.geometry?.attributes?.position
    ) {
      const count = child.geometry.attributes.position.count;

      for (let i = 0; i < count; i += 1) {
        child.getVertexPosition(i, _groundVertex);
        _groundVertex.applyMatrix4(child.matrixWorld);

        if (_groundVertex.y < minY) {
          minY = _groundVertex.y;
        }
      }

      return;
    }

    _groundBox.setFromObject(child);

    if (!_groundBox.isEmpty() && _groundBox.min.y < minY) {
      minY = _groundBox.min.y;
    }
  });

  return minY;
}

// Measure the constant gap between the cheap rest-pose bounding box (evaluated
// every frame) and the true skinned feet, so per-frame grounding stays O(1) yet
// lands the animated model on the ground instead of floating. Recomputed at
// spawn and whenever the active clip changes (see updateNpcs).
function calibrateNpcGroundBias(npc) {
  if (!npc?.visual) {
    return;
  }

  npc.visual.updateMatrixWorld(true);
  _groundBox.setFromObject(npc.visual);
  const restMinY = _groundBox.min.y;
  const skinnedMinY = computeSkinnedMinWorldY(npc.visual);

  npc.groundBiasY =
    Number.isFinite(restMinY) && Number.isFinite(skinnedMinY) ? skinnedMinY - restMinY : 0;
}

function fitNpcVisualToGround(npc) {
  if (!npc?.visual) {
    return;
  }

  npc.visual.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(npc.visual);

  if (!Number.isFinite(box.min.y) || box.isEmpty()) {
    return;
  }

  const height = box.max.y - box.min.y;

  if (Number.isFinite(height) && height > 0.001) {
    const targetHeight = 1.72;
    const scale = targetHeight / height;
    npc.visual.scale.multiplyScalar(scale);
    npc.visual.updateMatrixWorld(true);
  }

  const fittedBox = new THREE.Box3().setFromObject(npc.visual);
  const center = fittedBox.getCenter(new THREE.Vector3());
  npc.visual.position.x -= center.x - npc.root.position.x;
  npc.visual.position.z -= center.z - npc.root.position.z;
  npc.visual.position.y -= fittedBox.min.y - npc.root.position.y;
}

function refitNpcToGround(npc) {
  if (!npc?.visual) {
    return;
  }

  npc.visual.updateMatrixWorld(true);
  _groundBox.setFromObject(npc.visual);

  if (!Number.isFinite(_groundBox.min.y) || _groundBox.isEmpty()) {
    return;
  }

  // _groundBox is the rest-pose box; add the calibrated skin bias to recover the
  // real animated feet without a per-frame vertex scan.
  const skinnedBottom = _groundBox.min.y + (npc.groundBiasY || 0);
  const bottomOffset = skinnedBottom - npc.root.position.y;

  if (Math.abs(bottomOffset) > 0.02) {
    npc.visual.position.y -= bottomOffset;
  }
}

function configureNpcModel(root) {
  root.traverse((object) => {
    if (!object.isMesh) {
      return;
    }

    object.frustumCulled = false;
    object.castShadow = false;
    object.receiveShadow = true;

    if (object.material) {
      object.material.depthWrite = true;
    }
  });
}

function playNpcAnimation(npc, animationName, options = {}) {
  if (!npc?.mixer || !animationName || !characterAnimations.has(animationName)) {
    return false;
  }

  const clip = getNpcAnimationClip(npc, animationName);

  if (!clip || !clip.tracks.length) {
    return false;
  }

  const action = npc.mixer.clipAction(clip);
  const meta = characterAnimationMeta.get(animationName) || {};
  const shouldLoop = options.loop ?? meta.loop ?? true;

  // Stationary NPCs ask for idle every frame. Do not reset an already-playing
  // loop, or the guard gets pinned to the clip's first bind/T-pose frame.
  if (npc.currentAnimationName === animationName && npc.currentAction === action && options.restart !== true) {
    return true;
  }

  action.reset();
  action.enabled = true;
  action.clampWhenFinished = !shouldLoop;
  action.setEffectiveWeight(1);
  action.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, shouldLoop ? Infinity : 1);

  if (npc.currentAction && npc.currentAction !== action) {
    npc.currentAction.fadeOut(options.fade ?? 0.2);
  }

  action.fadeIn(options.fade ?? 0.2).play();
  npc.currentAction = action;

  // A different clip may plant the feet at a different height relative to the
  // rest pose, so re-measure the grounding bias on the next frame.
  if (npc.currentAnimationName !== animationName) {
    npc.groundBiasDirty = true;
  }

  npc.currentAnimationName = animationName;
  return true;
}

function playNpcPreferredAnimation(npc, keywords, options = {}) {
  // The rigged, lip-synced guard has no gesture clips that retarget onto his
  // skeleton, so any external clip would leave him in a T-pose. Keep him in his
  // bound embedded idle no matter which gesture is requested.
  if (isQuestGuard(npc) && !options.allowQuestGuardExternal) {
    if (npc.currentAnimationName !== npc.idleAnimationName) {
      playNpcIdle(npc);
    }

    return npc.currentAnimationName === npc.idleAnimationName;
  }

  const name = findAnimationByClipKeywords(keywords);

  if (!name) {
    return false;
  }

  if (npc.currentAnimationName === name && options.restart !== true) {
    return true;
  }

  return playNpcAnimation(npc, name, options);
}

function playNpcIdle(npc, options = {}) {
  // A procedurally-posed character drives its own body; don't fight it with an
  // unbindable clip.
  if (npc?.useProceduralIdle) {
    return false;
  }

  if (npc?.idleAnimationName && characterAnimations.has(npc.idleAnimationName)) {
    return playNpcAnimation(npc, npc.idleAnimationName, {
      loop: true,
      ...options,
    });
  }

  return playNpcPreferredAnimation(npc, ['standing idle', 'idle', 'breathing'], {
    loop: true,
    ...options,
  });
}

function playNpcWalk(npc) {
  return playNpcPreferredAnimation(npc, ['walking', 'walk'], {
    loop: true,
    allowQuestGuardExternal: npc?.scriptedMovement === true,
  });
}

// Fallback for characters with no bindable idle clip: pose the arms down out of
// the Mixamo T-pose and add a gentle breathing sway, so the model is never
// frozen with arms straight out. No-op when a real idle animation exists.
function setupProceduralIdle(npc) {
  if (!npc?.visual || npc.idleAnimationName) {
    return;
  }

  const bones = {};

  npc.visual.traverse((object) => {
    if (!object.isBone) {
      return;
    }

    const name = object.name.toLowerCase();

    if (name.includes('leftarm') && !name.includes('fore')) {
      bones.leftArm = object;
    } else if (name.includes('rightarm') && !name.includes('fore')) {
      bones.rightArm = object;
    } else if (!bones.spine && /spine1?$/.test(name)) {
      bones.spine = object;
    }
  });

  // Rotate the upper arms down toward the body (T-pose -> relaxed A-pose).
  if (bones.leftArm) {
    bones.leftArm.rotation.z += 1.15;
  }

  if (bones.rightArm) {
    bones.rightArm.rotation.z -= 1.15;
  }

  npc.proceduralBones = bones;
  npc.proceduralSpineBaseX = bones.spine ? bones.spine.rotation.x : 0;
  npc.proceduralPhase = Math.random() * Math.PI * 2;
  npc.useProceduralIdle = true;
}

function updateProceduralIdle(npc, elapsed) {
  const spine = npc?.useProceduralIdle ? npc.proceduralBones?.spine : null;

  if (spine) {
    spine.rotation.x = npc.proceduralSpineBaseX + Math.sin(elapsed * 1.4 + npc.proceduralPhase) * 0.035;
  }
}

function angleToAgent(point) {
  const toAgent = agent.position.clone().sub(point);
  return toAgent.lengthSq() > 0.001 ? Math.atan2(toAgent.x, toAgent.z) : 0;
}

function angleBetweenPoints(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return dx * dx + dz * dz > 0.0001 ? Math.atan2(dx, dz) : 0;
}

function turnNpcTowardYaw(npc, desiredYaw, amount = 1) {
  if (!npc?.root || !Number.isFinite(desiredYaw)) {
    return 0;
  }

  const yawDelta = Math.atan2(
    Math.sin(desiredYaw - npc.root.rotation.y),
    Math.cos(desiredYaw - npc.root.rotation.y),
  );
  npc.root.rotation.y += yawDelta * THREE.MathUtils.clamp(amount, 0, 1);
  return Math.abs(yawDelta);
}

function faceNpcToAgent(npc, amount = 1) {
  if (!npc?.root) {
    return;
  }

  turnNpcTowardYaw(npc, angleToAgent(npc.root.position), amount);
}

function faceAgentToNpc(npc) {
  if (!npc?.root) {
    return;
  }

  const toNpc = npc.root.position.clone().sub(agent.position);

  if (toNpc.lengthSq() > 0.01) {
    lookYaw = Math.atan2(toNpc.x, toNpc.z);
    lookPitch = THREE.MathUtils.clamp((npc.root.position.y + 1.25 - (agent.position.y + agent.eyeHeight)) * 0.08, -0.22, 0.18);
  }
}

function markNpcObjectTree(npc) {
  npc.root.userData.npcId = npc.id;
  npc.root.traverse((object) => {
    object.userData.npcId = npc.id;
  });
}

function getNpcFromObject(object) {
  let current = object;

  while (current) {
    const npcId = current.userData?.npcId;

    if (npcId) {
      return getNpcById(npcId);
    }

    current = current.parent;
  }

  return null;
}

function prepareNpcForApproach(npc) {
  if (!npc) {
    return;
  }

  npc.path = [];
  npc.pathIndex = 0;
  npc.state = 'idle';
  npc.waitTimer = 3;
  syncNpcTarget(npc);
  playNpcIdle(npc);
}

function createNpcFromGltf(gltf, url, index, total) {
  const slot = makeNpcSlot(index, url);
  const root = new THREE.Group();
  const visual = gltf.scene;
  const embeddedAnimationNames = [];

  for (const clip of gltf.animations || []) {
    const animationName = registerCharacterClip(clip, `${slot.label} ${clip.name || 'Idle'}`, {
      loop: true,
    });

    if (animationName) {
      embeddedAnimationNames.push(animationName);
    }
  }

  // Prefer the model's OWN embedded clip: it is authored for this exact
  // skeleton so it always binds. External Mixamo body clips may fail to
  // retarget onto a rigged character and leave it frozen in its T-pose.
  const idleAnimationName =
    embeddedAnimationNames.find((name) => /idle|standing|breathing|mixamo/i.test(name)) ||
    embeddedAnimationNames[0] ||
    (slot.idleKeywords?.length ? findAnimationByClipKeywords(slot.idleKeywords) : null) ||
    findAnimationByClipKeywords(['standing idle', 'idle', 'breathing']) ||
    null;

  root.name = slot.id;
  visual.name = `${slot.id}_visual`;
  root.add(visual);
  configureNpcModel(visual);

  const npc = {
    ...slot,
    assetUrl: url,
    root,
    visual,
    model: visual,
    mixer: new THREE.AnimationMixer(root),
    mouth: new TextLipSync(root, { strength: 0.48, maxJaw: 0.34 }),
    embeddedAnimationNames,
    idleAnimationName,
    currentAction: null,
    currentAnimationName: null,
    path: [],
    pathIndex: 0,
    waitTimer: 6 + index * 0.45,
    repathTimer: 0,
    speed: 1.05 + (index % 3) * 0.16,
    state: 'idle',
    dialogue: [],
    talkUntil: 0,
    afterTalk: null,
    marker: null,
    target: null,
    groundBiasY: 0,
    groundBiasDirty: false,
    useProceduralIdle: false,
    scriptedMovement: false,
    turnTargetYaw: null,
    finalYaw: null,
  };

  setupProceduralIdle(npc);
  fitNpcVisualToGround(npc);
  npc.target = createNpcTargetFromNpc(npc);
  markNpcObjectTree(npc);
  npc.mixer.addEventListener('finished', () => {
    if (npc.state !== 'talking' && npc.state !== 'walking') {
      playNpcIdle(npc);
    }
  });

  npcContainer.add(root);
  npcById.set(npc.id, npc);
  npcs.push(npc);
  placeNpcOnNavmesh(npc, index, total);
  playNpcIdle(npc, { fade: 0 });
  npc.mixer.update(0);
  // Measure the animated feet once the idle pose is applied so the model lands
  // on the ground on its very first rendered frame instead of floating.
  calibrateNpcGroundBias(npc);
  npc.groundBiasDirty = false;
  refitNpcToGround(npc);
  return npc;
}

async function loadBodyAnimationClips(loader, urls = []) {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const gltf = await loadGltf(loader, url);
      const assetName = getAssetName(url);

      for (const clip of gltf.animations || []) {
        registerCharacterClip(clip, assetName || clip.name);
      }
    }),
  );
  const failed = results.filter((result) => result.status === 'rejected').length;

  if (failed) {
    console.warn(`Body animation GLBs failed: ${failed}`);
  }
}

async function loadNpcCharactersAndAnimations() {
  if (!navigation || !registry) {
    return;
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const manifest = await loadAssetManifest();
  let characterUrls = manifest.characters || [];

  if (QUEST_ENABLED) {
    const guardUrl =
      characterUrls.find((url) => /police|officer|wach|guard/i.test(url)) ||
      characterUrls.find((url) => /berliner|sage|man/i.test(url)) ||
      characterUrls[0] ||
      QUEST_GUARD_MODEL_FALLBACK_URL;
    characterUrls = guardUrl ? [guardUrl] : [];
  }

  npcContainer.clear();
  npcs = [];
  npcById.clear();
  selectedNpc = null;
  nearbyNpc = null;
  pendingDialogue = null;

  if (!characterUrls.length) {
    setStatus('No *.rigged.glb characters found in Mixamo', 'error');
    renderDialogue();
    return;
  }

  const bodyAnimationUrls = uniqueUrls([
    ...(QUEST_ENABLED ? [QUEST_GUARD_IDLE_URL] : []),
    ...(manifest.bodyAnimations || []),
  ]);

  await loadBodyAnimationClips(loader, bodyAnimationUrls);

  const results = await Promise.allSettled(
    characterUrls.map(async (url, index) => {
      const gltf = await loadGltf(loader, url);
      return createNpcFromGltf(gltf, url, index, characterUrls.length);
    }),
  );
  const loaded = results.filter((result) => result.status === 'fulfilled').length;
  const failed = results.length - loaded;

  if (failed) {
    console.warn(`Rigged NPC GLBs failed: ${failed}`);
  }

  if (!selectedNpc && npcs.length && !QUEST_ENABLED) {
    selectedNpc = npcs[0];
  }

  syncAllNpcTargets();
  renderTargets();
  renderDialogue();
  publishDebugState();
  setStatus(`NPCs ready: ${loaded} rigged characters, ${characterAnimations.size} clips`, 'ready');
}

function getRandomPatrolCandidate(npc) {
  const candidates = [];

  const addCandidate = (point) => {
    if (!point) {
      return;
    }

    const candidate = snapToNpcGround(point);

    if (candidate.distanceToSquared(npc.root.position) >= 4) {
      candidates.push(candidate);
    }
  };

  for (const targetId of npc.homeTargetIds || []) {
    addCandidate(routePointForTargetId(targetId));
  }

  for (let i = 0; i < NPC_GROUND_POINTS.length; i += 1) {
    const point = NPC_GROUND_POINTS[Math.floor(Math.random() * NPC_GROUND_POINTS.length)];
    addCandidate(createGroundPoint(point, Math.floor(Math.random() * NPC_SPAWN_OFFSETS.length)));
  }

  if (!candidates.length) {
    return null;
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function finishNpcPath(npc) {
  npc.path = [];
  npc.pathIndex = 0;

  if (Number.isFinite(npc.finalYaw)) {
    npc.turnTargetYaw = npc.finalYaw;
    npc.finalYaw = null;
    npc.state = 'turningFinal';
    playNpcIdle(npc);
    return;
  }

  npc.scriptedMovement = false;
  npc.state = 'idle';
  playNpcIdle(npc);
}

function startNpcPath(npc, destination, options = {}) {
  let path = navigation?.findPath(npc.root.position, destination) || [];

  if (path.length < 2) {
    if (options.allowDirect && npc.root.position.distanceToSquared(destination) > 0.04) {
      path = [npc.root.position.clone(), destination.clone()];
    } else {
      npc.waitTimer = 1.5;
      playNpcIdle(npc);
      return false;
    }
  }

  npc.scriptedMovement = options.scripted === true;
  npc.finalYaw = Number.isFinite(options.finalYaw) ? options.finalYaw : null;
  npc.path = path;
  npc.pathIndex = 1;

  if (options.turnFirst) {
    npc.turnTargetYaw = angleBetweenPoints(npc.root.position, path[npc.pathIndex]);
    npc.state = 'turningToWalk';
    playNpcIdle(npc);
  } else {
    npc.state = 'walking';
    playNpcWalk(npc);
  }

  return true;
}

function startQuestGuardOpenMove(npc) {
  if (!npc) {
    return false;
  }

  const openPoint = snapToNpcGround(QUEST_POINTS.guardOpen);
  const finalYaw = Math.atan2(
    QUEST_POINTS.insideVillage.x - openPoint.x,
    QUEST_POINTS.insideVillage.z - openPoint.z,
  );
  const started = startNpcPath(npc, openPoint, {
    allowDirect: true,
    finalYaw,
    scripted: true,
    turnFirst: true,
  });

  if (started) {
    setStatus('Bruno открывает проход...', 'ready');
    syncNpcTarget(npc);
  }

  return started;
}

function updateNpcMovement(npc, deltaTime) {
  if (npc.state === 'turningToWalk') {
    const target = npc.path[npc.pathIndex];

    if (!target) {
      finishNpcPath(npc);
      return;
    }

    const desiredYaw = angleBetweenPoints(npc.root.position, target);
    const remaining = turnNpcTowardYaw(npc, desiredYaw, Math.min(deltaTime * 5, 1));
    playNpcIdle(npc);

    if (remaining < 0.08) {
      npc.state = 'walking';
      playNpcWalk(npc);
    }

    return;
  }

  if (npc.state === 'turningFinal') {
    const remaining = turnNpcTowardYaw(npc, npc.turnTargetYaw, Math.min(deltaTime * 5, 1));
    playNpcIdle(npc);

    if (remaining < 0.035) {
      npc.turnTargetYaw = null;
      npc.scriptedMovement = false;
      npc.state = 'idle';
      playNpcIdle(npc);
    }

    return;
  }

  if (npc.state === 'talking') {
    faceNpcToAgent(npc, Math.min(deltaTime * 8, 1));
    return;
  }

  if (npc.stationary && !npc.scriptedMovement) {
    npc.path = [];
    npc.pathIndex = 0;
    npc.state = 'idle';

    if (npc.root.position.distanceToSquared(agent.position) <= QUEST_TRIGGER_ALERT * QUEST_TRIGGER_ALERT) {
      faceNpcToAgent(npc, Math.min(deltaTime * 4, 1));
    }

    playNpcIdle(npc);
    return;
  }

  const isCloseToPlayer = npc.root.position.distanceToSquared(agent.position) <= NPC_TALK_STOP_DISTANCE * NPC_TALK_STOP_DISTANCE;

  if (selectedNpc === npc && isCloseToPlayer && !npc.scriptedMovement) {
    npc.path = [];
    npc.pathIndex = 0;
    npc.state = 'idle';
    faceNpcToAgent(npc, Math.min(deltaTime * 4, 1));
    playNpcIdle(npc);
    return;
  }

  if (!npc.path.length || npc.pathIndex >= npc.path.length) {
    if (npc.scriptedMovement) {
      finishNpcPath(npc);
      return;
    }

    npc.waitTimer -= deltaTime;

    if (npc.waitTimer <= 0) {
      const destination = getRandomPatrolCandidate(npc);

      if (!destination || !startNpcPath(npc, destination)) {
        npc.waitTimer = NPC_PATROL_WAIT_MIN + Math.random() * NPC_PATROL_WAIT_MAX;
      }
    } else {
      npc.state = 'idle';
      playNpcIdle(npc);
    }

    return;
  }

  npc.repathTimer -= deltaTime;

  if (npc.repathTimer <= 0) {
    npc.repathTimer = NPC_PATROL_REPATH_INTERVAL;

    const snapped = getSameLevelNavPoint(npc.root.position);

    if (!snapped) {
      npc.path = [];
      npc.waitTimer = 0.4;
      return;
    }

    npc.root.position.copy(snapped);
  }

  const target = npc.path[npc.pathIndex];
  const toTarget = target.clone().sub(npc.root.position);
  const distance = toTarget.length();

  if (distance < 0.16) {
    npc.root.position.copy(target);
    npc.pathIndex += 1;

    if (npc.pathIndex >= npc.path.length) {
      if (npc.scriptedMovement) {
        finishNpcPath(npc);
      } else {
        npc.path = [];
        npc.pathIndex = 0;
        npc.waitTimer = NPC_PATROL_WAIT_MIN + Math.random() * NPC_PATROL_WAIT_MAX;
        npc.state = 'idle';
        playNpcIdle(npc);
      }
    }

    return;
  }

  toTarget.normalize();
  npc.root.position.addScaledVector(toTarget, Math.min(distance, npc.speed * deltaTime));

  const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
  const yawDelta = Math.atan2(Math.sin(desiredYaw - npc.root.rotation.y), Math.cos(desiredYaw - npc.root.rotation.y));
  npc.root.rotation.y += yawDelta * Math.min(deltaTime * 8, 1);
}

function updateNpcs(deltaTime) {
  const now = performance.now() / 1000;

  for (const npc of npcs) {
    npc.mixer?.update(deltaTime);

    if (npc.groundBiasDirty) {
      calibrateNpcGroundBias(npc);
      npc.groundBiasDirty = false;
    }

    updateProceduralIdle(npc, now);
    refitNpcToGround(npc);
    npc.mouth?.update(deltaTime);

    if (npc.state === 'talking' && now > npc.talkUntil && !npc.mouth?.active) {
      const afterTalk = npc.afterTalk;
      npc.afterTalk = null;

      if (afterTalk) {
        afterTalk();
      } else {
        npc.state = 'idle';
        playNpcIdle(npc);
      }
    }

    updateNpcMovement(npc, deltaTime);
    syncNpcTarget(npc);
  }

  if (now - lastNpcUiRefresh > 0.25) {
    lastNpcUiRefresh = now;
    nearbyNpc = getNearestNpc(NPC_INTERACTION_DISTANCE);
    renderDialogueHeader();
  }
}

function isQuestGuard(npc) {
  return QUEST_ENABLED && npc?.id === QUEST_GUARD_ID;
}

function getQuestGuard() {
  return getNpcById(QUEST_GUARD_ID);
}

function setQuestStatus(message) {
  if (questStatus) {
    questStatus.textContent = message;
  }
}

function setQuestSpeechLine(de, ru = '') {
  questState.currentLine = { de, ru };
  renderDialogueHeader();
}

function renderQuestSpeechLine() {
  if (!dialogueTarget || !questState.currentLine) {
    return false;
  }

  dialogueTarget.replaceChildren();
  dialogueTarget.classList.add('quest-line');

  const de = document.createElement('div');
  de.className = 'quest-line-de';
  de.textContent = questState.currentLine.de;
  dialogueTarget.append(de);

  if (questState.currentLine.ru) {
    const ru = document.createElement('div');
    ru.className = 'quest-line-ru';
    ru.textContent = `(${questState.currentLine.ru})`;
    dialogueTarget.append(ru);
  }

  return true;
}

function insertDialogueTemplate(template) {
  const text = String(template || '');
  const cursor = text.indexOf('___');
  dialogueInput.value = text.replace('___', '');
  dialogueInput.focus();

  if (cursor >= 0) {
    dialogueInput.setSelectionRange(cursor, cursor);
  } else {
    dialogueInput.setSelectionRange(dialogueInput.value.length, dialogueInput.value.length);
  }
}

function renderQuestChips(chips = []) {
  if (!questChips) {
    return;
  }

  questChips.replaceChildren();
  questChips.hidden = chips.length === 0;

  for (const chip of chips) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quest-chip';
    button.textContent = chip.label;
    button.addEventListener('click', () => {
      if (chip.template) {
        insertDialogueTemplate(chip.template);
        return;
      }

      if (chip.submit) {
        dialogueInput.value = chip.submit;
        submitDialogueLine();
        return;
      }

      if (chip.action === 'repeat') {
        repeatQuestPrompt();
        return;
      }

      if (chip.action === 'help') {
        showQuestHelp();
      }
    });
    questChips.append(button);
  }
}

function questChipsForStage(stage = questState.stage) {
  if (stage === 'ask_name') {
    const greeting = guardGreeting();
    return [
      { label: `${greeting.de}! Ich bin ___`, template: `${greeting.de}! Ich bin ___` },
      { label: 'Ich bin ___', template: 'Ich bin ___' },
      { label: 'Wie bitte?', action: 'repeat' },
      { label: 'Hilfe', action: 'help' },
    ];
  }

  if (stage === 'ask_origin') {
    return [
      { label: 'Ich komme aus ___', template: 'Ich komme aus ___' },
      { label: 'Wie bitte?', action: 'repeat' },
      { label: 'Hilfe', action: 'help' },
    ];
  }

  if (stage === 'confirm') {
    return [
      { label: 'Danke!', submit: 'Danke!' },
      { label: 'Hallo, Bruno!', submit: 'Hallo, Bruno!' },
    ];
  }

  return [];
}

function capitalizeQuestValue(value) {
  const text = String(value || '').trim();
  return text ? text[0].toLocaleUpperCase('de-DE') + text.slice(1) : '';
}

function hasCyrillic(text) {
  return /[А-Яа-яЁё]/.test(text);
}

// Strip a leading greeting ("Guten Morgen! ...", "Hallo, ...") so mirrored
// greeting chips like "Guten Morgen! Ich bin ___" still parse the name.
function stripLeadingGreeting(text) {
  return text
    .replace(/^\s*(?:guten\s+(?:morgen|tag|abend)|hallo|hi|hey|servus|moin)\s*[!.,:-]*\s*/i, '')
    .trim();
}

function parseQuestName(input) {
  const text = String(input || '').trim().replace(/\s+/g, ' ');

  if (!text || hasCyrillic(text)) {
    return null;
  }

  const cleaned = stripLeadingGreeting(text).replace(/[.,!?;:]+$/, '').trim();

  if (!cleaned) {
    return null;
  }

  const exact = cleaned.match(/^(?:ich\s+(?:bin|hei(?:ss|ß)e)|mein\s+name\s+ist)\s+([\p{L}-]{2,20})$/iu);

  if (exact) {
    return { value: capitalizeQuestValue(exact[1]), exact: true };
  }

  const singleWord = cleaned.match(/^([\p{L}-]{2,20})$/u);

  if (singleWord && !/^(ich|bin|du|bist|wer|woher|hallo|danke|ja|nein)$/i.test(singleWord[1])) {
    return { value: capitalizeQuestValue(singleWord[1]), exact: false };
  }

  return null;
}

function parseQuestOrigin(input) {
  const text = String(input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/, '');

  if (!text || hasCyrillic(text)) {
    return null;
  }

  const exact = text.match(/^(?:ich\s+komme\s+aus|aus)\s+([\p{L}\s'-]{2,32})$/iu);

  if (exact) {
    return { value: capitalizeQuestValue(exact[1]), exact: true };
  }

  const singlePlace = text.match(/^([\p{L}\s'-]{2,32})$/u);

  if (singlePlace && !/^(ich|komme|aus|woher|hallo|danke|ja|nein)$/i.test(singlePlace[1])) {
    return { value: capitalizeQuestValue(singlePlace[1]), exact: false };
  }

  return null;
}

async function speakQuestLine(npc, de, ru = '', options = {}) {
  if (!npc) {
    return 0;
  }

  if (options.append !== false) {
    appendDialogue(npc, 'npc', de);
  }

  setQuestSpeechLine(de, ru);
  faceNpcToAgent(npc, 1);
  playNpcDialogueAnimation(npc, { animationIntent: options.intent || 'talk' });

  const audioReady = isGameAudioUnlocked();
  const duration =
    (await npc.mouth?.speak(de, { voiceId: npc.voiceId })) ||
    Math.min(7, Math.max(1.2, de.length * 0.06));

  if (!audioReady && options.showAudioHint !== false) {
    setStatus('Кликните по игре или нажмите Enter: включим звук NPC без лишних TTS-запросов', 'ready');
  }

  npc.state = 'talking';
  npc.talkUntil = performance.now() / 1000 + duration + 0.2;
  return duration;
}

function openQuestDialogue(npc = getQuestGuard()) {
  if (!npc || questState.completed) {
    return;
  }

  setSelectedNpc(npc, { focusInput: true });
  // Stop the player the instant the conversation starts so they can't keep
  // walking through the gate while talking to Bruno.
  agent.path = [];
  agent.pathIndex = 0;
  agent.pendingAction = null;
  agent.pendingNpcAction = null;
  agent.pendingArrivalPoint = null;
  npc.path = [];
  npc.pathIndex = 0;
  npc.state = 'talking';
  questState.stage = questState.stage === 'approach' ? 'ask_name' : questState.stage;
  questState.attempts = 0;
  setQuestStatus('Квест: Der Wachmann - назовите себя');
  renderQuestChips(questChipsForStage());

  const greeting = guardGreeting();
  speakQuestLine(npc, `${greeting.de}. Wer bist du?`, `${greeting.ru}. Кто ты?`, {
    intent: 'greeting',
  });
}

function repeatQuestPrompt() {
  const npc = getQuestGuard();

  if (!npc || !questState.currentLine) {
    return;
  }

  speakQuestLine(npc, questState.currentLine.de, questState.currentLine.ru, {
    append: false,
    intent: 'thinking',
  });
}

function showQuestHelp() {
  const npc = getQuestGuard();

  if (!npc) {
    return;
  }

  questState.attempts = 0;

  if (questState.stage === 'ask_origin') {
    setQuestStatus('Подсказка: скажите откуда вы');
    renderQuestChips(questChipsForStage('ask_origin'));
    speakQuestLine(npc, 'Ich komme aus dem Dorf. Und du?', 'Я из деревни. А ты?', {
      intent: 'helpful',
    });
    return;
  }

  setQuestStatus('Подсказка: скажите свое имя');
  renderQuestChips(questChipsForStage('ask_name'));
  speakQuestLine(npc, 'ICH BIN Bruno. Ich... bin... Bruno. Und du?', 'Я Бруно. А ты?', {
    intent: 'helpful',
  });
}

function finishQuestSuccess(npc) {
  questState.completed = true;
  questState.stage = 'success';
  renderQuestChips([]);
  setQuestStatus('Квест выполнен: Der Wachmann');
  npc.afterTalk = () => {
    startQuestGuardOpenMove(npc);
  };
  speakQuestLine(npc, 'Komm rein!', 'Заходи!', { intent: 'happy' });
}

function handleQuestClarify(npc, helpStage) {
  questState.attempts += 1;

  if (questState.attempts >= 2) {
    showQuestHelp();
    return;
  }

  renderQuestChips(questChipsForStage(helpStage));
  speakQuestLine(npc, 'Hm? Noch einmal, bitte. Langsam.', 'Хм? Еще раз, пожалуйста. Медленно.', {
    intent: 'thinking',
  });
}

async function sendQuestDialogueToGuard(npc, message) {
  const line = String(message || '').trim();

  if (!line || !isQuestGuard(npc)) {
    return;
  }

  if (npc.root.position.distanceToSquared(agent.position) > NPC_INTERACTION_DISTANCE * NPC_INTERACTION_DISTANCE) {
    pendingDialogue = { npcId: npc.id, line };
    moveToTarget(npc.target);
    setStatus('Иду к стражнику', 'ready');
    return;
  }

  await unlockGameAudio({ showStatus: true });

  setSelectedNpc(npc);
  appendDialogue(npc, 'player', line);
  dialogueInput.value = '';
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  if (/^(hilfe|help|помощь)$/i.test(line)) {
    showQuestHelp();
    return;
  }

  if (/^wie bitte\??$/i.test(line)) {
    repeatQuestPrompt();
    return;
  }

  if (questState.stage === 'approach') {
    openQuestDialogue(npc);
    return;
  }

  if (questState.stage === 'ask_name') {
    const parsed = parseQuestName(line);

    if (!parsed) {
      handleQuestClarify(npc, 'ask_name');
      return;
    }

    questState.playerName = parsed.value;
    questState.stage = 'ask_origin';
    questState.attempts = 0;
    renderQuestChips(questChipsForStage('ask_origin'));
    setQuestStatus('Квест: Der Wachmann - скажите откуда вы');

    const de = parsed.exact
      ? `${parsed.value}! Gut. Und woher kommst du?`
      : `${parsed.value}? Ah - ich bin ${parsed.value}. Gut. Und woher kommst du?`;
    const ru = `${parsed.value}! Хорошо. А откуда ты?`;
    speakQuestLine(npc, de, ru, { intent: 'thankful' });
    return;
  }

  if (questState.stage === 'ask_origin') {
    const parsed = parseQuestOrigin(line);

    if (!parsed) {
      handleQuestClarify(npc, 'ask_origin');
      return;
    }

    questState.playerOrigin = parsed.value;
    questState.stage = 'confirm';
    questState.attempts = 0;
    renderQuestChips(questChipsForStage('confirm'));
    setQuestStatus('Квест: Der Wachmann - поздоровайтесь с Bruno');
    speakQuestLine(
      npc,
      `Ah, aus ${parsed.value}! Willkommen, ${questState.playerName}. Ich bin Bruno.`,
      `А, из ${parsed.value}! Добро пожаловать, ${questState.playerName}. Я Бруно.`,
      { intent: 'greeting' },
    );
    return;
  }

  if (questState.stage === 'confirm') {
    finishQuestSuccess(npc);
  }
}

// The player is "held" from the moment Bruno halts them until the quest is
// finished. While held they cannot walk away or slip past the gate.
function isPlayerHeldByGuard() {
  return QUEST_ENABLED && questState.halted && !questState.completed;
}

const GUARD_GREETINGS = {
  morning: { de: 'Guten Morgen', ru: 'Доброе утро' },
  day: { de: 'Guten Tag', ru: 'Добрый день' },
  evening: { de: 'Guten Abend', ru: 'Добрый вечер' },
};

// Day cycle stand-in: derive the phase from the local clock so Bruno greets the
// player differently through the day (A1.1 §1.1).
function getDayPhase(date = new Date()) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 11) {
    return 'morning';
  }

  if (hour >= 11 && hour < 18) {
    return 'day';
  }

  return 'evening';
}

function guardGreeting() {
  return GUARD_GREETINGS[getDayPhase()] || GUARD_GREETINGS.day;
}

// A point a couple of metres in front of the guard, inside dialogue range.
function guardDialogueApproachPoint(npc) {
  const forward = new THREE.Vector3(
    Math.sin(npc.root.rotation.y),
    0,
    Math.cos(npc.root.rotation.y),
  );
  const point = npc.root.position.clone().addScaledVector(forward, 2.6);
  return snapToNpcGround(point);
}

// Pull the player the last couple of metres to Bruno and cancel any walk in
// progress, so the dialogue reliably opens and they cannot wander off.
function holdPlayerAtGuard(npc) {
  if (!npc) {
    return;
  }

  agent.path = [];
  agent.pathIndex = 0;
  agent.pendingAction = null;
  agent.pendingNpcAction = null;
  agent.pendingArrivalPoint = null;
  moveToPoint(guardDialogueApproachPoint(npc));
}

function updateQuest() {
  const npc = getQuestGuard();

  if (!QUEST_ENABLED || !npc || questState.completed) {
    return;
  }

  const distance = npc.root.position.distanceTo(agent.position);

  if (!questState.alerted && distance <= QUEST_TRIGGER_ALERT) {
    questState.alerted = true;
    faceNpcToAgent(npc, 1);
    setQuestStatus('Стражник заметил вас');
  }

  if (!questState.halted && distance <= QUEST_TRIGGER_HALT) {
    questState.halted = true;
    faceNpcToAgent(npc, 1);
    // Bruno stops the player and draws them in without shouting "Halt!".
    holdPlayerAtGuard(npc);
  }

  if (questState.stage === 'approach') {
    // Open at talking range, or as soon as a halted player has come to a stop
    // (pull finished, or no navmesh path existed) so they can never soft-lock
    // just out of range.
    const stopped = agent.path.length === 0;

    if (distance <= QUEST_TRIGGER_DIALOGUE || (questState.halted && stopped)) {
      openQuestDialogue(npc);
    }
  }
}

function getNearestNpc(maxDistance = Infinity) {
  let best = null;
  let bestDistanceSq = maxDistance * maxDistance;

  for (const npc of npcs) {
    const distanceSq = npc.root.position.distanceToSquared(agent.position);

    if (distanceSq < bestDistanceSq) {
      best = npc;
      bestDistanceSq = distanceSq;
    }
  }

  return best;
}

function findNpcInText(input) {
  const normalized = normalizeText(input);
  let best = null;
  let bestScore = 0;

  for (const npc of npcs) {
    const aliases = [npc.id, npc.label, ...(npc.aliases || [])];

    for (const alias of aliases) {
      const text = normalizeText(alias);

      if (text && normalized.includes(text) && text.length > bestScore) {
        best = npc;
        bestScore = text.length;
      }
    }
  }

  return best;
}

function setSelectedNpc(npc, options = {}) {
  if (!npc) {
    return;
  }

  selectedNpc = npc;
  renderDialogue();

  if (options.focusInput) {
    dialogueInput?.focus();
  }
}

function renderDialogueHeader() {
  if (!dialogueTarget) {
    return;
  }

  const target = selectedNpc || nearbyNpc;

  if (isQuestGuard(target) && questState.currentLine && !questState.completed) {
    renderQuestSpeechLine();
    interactNpcButton.disabled = false;
    dialogueInput.disabled = false;
    dialogueSubmit.disabled = false;
    return;
  }

  dialogueTarget.classList.remove('quest-line');

  if (!target) {
    dialogueTarget.textContent = QUEST_ENABLED ? 'Подойдите к стражнику у ворот' : 'Подойдите к персонажу и нажмите E';
    interactNpcButton.disabled = true;
    dialogueInput.disabled = true;
    dialogueSubmit.disabled = true;
    return;
  }

  const lastNpcLine = [...target.dialogue].reverse().find((line) => line.speaker === 'npc');
  dialogueTarget.textContent = lastNpcLine?.text || 'Напишите реплику персонажу';
  interactNpcButton.disabled = false;
  dialogueInput.disabled = false;
  dialogueSubmit.disabled = false;
}

function renderDialogue() {
  renderDialogueHeader();

  if (!dialogueLog) {
    return;
  }

  dialogueLog.replaceChildren();

  const npc = selectedNpc;

  if (!npc || !npc.dialogue.length) {
    const empty = document.createElement('div');
    empty.className = 'dialogue-empty';
    empty.textContent = npc ? 'No lines yet. Type below to talk.' : 'Choose a nearby character.';
    dialogueLog.append(empty);
    return;
  }

  for (const line of npc.dialogue.slice(-MAX_DIALOGUE_LINES)) {
    const row = document.createElement('div');
    row.className = `dialogue-line ${line.speaker === 'player' ? 'player' : 'npc'}`;

    const speaker = document.createElement('div');
    speaker.className = 'dialogue-speaker';
    speaker.textContent = line.speaker === 'player' ? 'You' : npc.label;

    const text = document.createElement('div');
    text.textContent = line.text;

    row.append(speaker, text);
    dialogueLog.append(row);
  }

  dialogueLog.scrollTop = dialogueLog.scrollHeight;
}

function appendDialogue(npc, speaker, text) {
  npc.dialogue.push({
    speaker,
    text,
    at: Date.now(),
  });
  npc.dialogue = npc.dialogue.slice(-MAX_DIALOGUE_LINES * 2);
  renderDialogue();
}

function chooseDialogueAnimationKeywords(payload) {
  if (Array.isArray(payload?.animationKeywords) && payload.animationKeywords.length) {
    return payload.animationKeywords;
  }

  return DIALOGUE_ANIMATION_HINTS[payload?.animationIntent] || DIALOGUE_ANIMATION_HINTS.talk;
}

function playNpcDialogueAnimation(npc, payload) {
  // The rigged, lip-synced guard talks through mouth morphs. External gesture
  // clips may not retarget onto his skeleton and would snap him into a T-pose,
  // so keep him in his reliable embedded idle and let the lips carry it.
  if (isQuestGuard(npc)) {
    if (npc.currentAnimationName !== npc.idleAnimationName) {
      playNpcIdle(npc);
    }

    return;
  }

  const keywords = chooseDialogueAnimationKeywords(payload);
  const played = playNpcPreferredAnimation(npc, keywords, { restart: true });

  if (!played) {
    playNpcPreferredAnimation(npc, DIALOGUE_ANIMATION_HINTS.talk, { loop: true, restart: true });
  }
}

function openDialogueWithNpc(npc, options = {}) {
  if (!npc) {
    return;
  }

  if (isQuestGuard(npc) && !questState.completed) {
    openQuestDialogue(npc);
    return;
  }

  setSelectedNpc(npc, options);
  npc.path = [];
  npc.pathIndex = 0;
  npc.state = 'idle';
  npc.waitTimer = 1.2;
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  if (isQuestGuard(npc)) {
    // Post-quest Bruno keeps his reliable idle (a gesture clip would T-pose him).
    if (npc.currentAnimationName !== npc.idleAnimationName) {
      playNpcIdle(npc);
    }
  } else {
    playNpcPreferredAnimation(npc, ['standing greeting', 'waving', 'acknowledging'], {
      loop: false,
      restart: true,
    });
  }

  setStatus(`Talking to ${npc.label}`, 'ready');
}

async function requestNpcReply(npc, message) {
  const response = await fetch('/api/dialogue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      npc: {
        id: npc.id,
        label: npc.label,
        role: npc.role,
      },
      message,
      history: npc.dialogue.slice(-8),
    }),
  });

  if (!response.ok) {
    throw new Error(`dialogue ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function sendDialogueToNpc(npc, message) {
  const line = String(message || '').trim();

  if (!npc || !line) {
    return;
  }

  // During the quest Bruno runs the scripted FSM. Once he has let the player in
  // ("Komm rein!"), he becomes a normal AI conversation partner who answers
  // follow-up questions in character.
  if (isQuestGuard(npc) && !questState.completed) {
    sendQuestDialogueToGuard(npc, line);
    return;
  }

  const distanceSq = npc.root.position.distanceToSquared(agent.position);

  if (distanceSq > NPC_INTERACTION_DISTANCE * NPC_INTERACTION_DISTANCE) {
    pendingDialogue = { npcId: npc.id, line };
    moveToTarget(npc.target);
    setStatus(`Going to ${npc.label} before talking`, 'ready');
    return;
  }

  await unlockGameAudio({ showStatus: true });

  setSelectedNpc(npc);
  appendDialogue(npc, 'player', line);
  dialogueInput.value = '';
  dialogueTarget.textContent = `${npc.label} думает...`;
  dialogueSubmit.disabled = true;
  npc.path = [];
  npc.pathIndex = 0;
  npc.state = 'talking';
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);
  playNpcPreferredAnimation(npc, DIALOGUE_ANIMATION_HINTS.thinking, { restart: true });
  setStatus(`${npc.label} is thinking...`, 'ready');

  try {
    const payload = await requestNpcReply(npc, line);
    const reply = String(payload.reply || '...');
    appendDialogue(npc, 'npc', reply);
    playNpcDialogueAnimation(npc, payload);
    const duration =
      (await npc.mouth?.speak(reply, { voiceId: npc.voiceId })) ||
      Math.min(7, Math.max(1.4, reply.length * 0.06));
    npc.state = 'talking';
    npc.talkUntil = performance.now() / 1000 + duration + 0.25;
    setStatus(`${npc.label}: ${payload.animationIntent || 'talk'}`, 'ready');
  } catch (error) {
    console.error(error);
    appendDialogue(npc, 'npc', 'I lost the thread for a second. Try again.');
    playNpcPreferredAnimation(npc, ['shrugging', 'thinking'], { restart: true });
    setStatus(error.message || 'Dialogue failed', 'error');
  } finally {
    dialogueSubmit.disabled = false;
    renderDialogueHeader();
    publishDebugState();
  }
}

function interactWithNearestNpc() {
  const npc = getNearestNpc();

  if (!npc) {
    setStatus('No NPC loaded', 'error');
    return;
  }

  if (npc.root.position.distanceToSquared(agent.position) > NPC_INTERACTION_DISTANCE * NPC_INTERACTION_DISTANCE) {
    pendingDialogue = null;
    moveToTarget(npc.target);
    setSelectedNpc(npc);
    return;
  }

  openDialogueWithNpc(npc, { focusInput: true });
}

function submitDialogueLine() {
  const npc = selectedNpc || nearbyNpc || getNearestNpc();

  if (!npc) {
    setStatus('No NPC selected', 'error');
    return;
  }

  sendDialogueToNpc(npc, dialogueInput.value);
}

// --- Voice input (speech-to-text) ---------------------------------------
// Records the microphone with MediaRecorder and transcribes it on the server
// (/api/stt), so speaking works in every modern browser (Chrome, Firefox,
// Safari, Edge) rather than only those with the Web Speech API. The recognised
// text lands in the dialogue line and is submitted through the normal pipeline,
// so the guard FSM (or the AI) evaluates it and advances or asks to repeat.
const dictation = {
  supported:
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined',
  state: 'idle', // 'idle' | 'recording' | 'transcribing'
  recorder: null,
  stream: null,
  chunks: [],
};

function pickAudioMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) {
      return type;
    }
  }

  return '';
}

function updateMicButton() {
  if (!micButton) {
    return;
  }

  if (!dictation.supported) {
    micButton.disabled = true;
    micButton.classList.remove('listening');
    micButton.title = 'Голосовой ввод недоступен: нужен доступ к микрофону в современном браузере';
    return;
  }

  micButton.classList.toggle('listening', dictation.state === 'recording');
  micButton.disabled = dictation.state === 'transcribing';
  micButton.title =
    dictation.state === 'recording'
      ? 'Идёт запись — нажмите, чтобы остановить и распознать'
      : dictation.state === 'transcribing'
        ? 'Распознаю…'
        : 'Ответить голосом';
}

function setMicTranscript(message, state = 'ready') {
  if (!micTranscript) {
    return;
  }

  const text = String(message || '').trim();
  micTranscript.hidden = !text;
  micTranscript.textContent = text;
  micTranscript.classList.toggle('error', state === 'error');
}

function stopMicStream() {
  if (dictation.stream) {
    for (const track of dictation.stream.getTracks()) {
      track.stop();
    }

    dictation.stream = null;
  }
}

async function transcribeRecording(blob, mimeType) {
  dictation.state = 'transcribing';
  updateMicButton();
  setStatus('Распознаю…', 'ready');
  setMicTranscript('Распознаю запись с микрофона…');

  try {
    const response = await fetch('/api/stt?lang=de', {
      method: 'POST',
      headers: { 'Content-Type': mimeType || 'audio/webm' },
      body: blob,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `STT ${response.status}`);
    }

    if (payload.ok === false) {
      const message = payload.error || 'Не распознано: повторите фразу ближе к микрофону.';
      setMicTranscript(message, 'error');
      setStatus(message, 'error');
      return;
    }

    const text = String(payload.text || '').trim();

    if (!text) {
      setMicTranscript('Не распознано: микрофон не вернул текст.', 'error');
      setStatus('Не расслышал. Нажмите 🎤 и повторите.', 'error');
      return;
    }

    if (dialogueInput) {
      // Show the player what was recognised, then run it through evaluation.
      dialogueInput.value = text;
      setMicTranscript(`Вы сказали / распознано: «${text}»`);
      setStatus(`Вы сказали: «${text}»`, 'ready');
      submitDialogueLine();
    }
  } catch (error) {
    setMicTranscript(`Не распознано: ${error.message || 'ошибка распознавания речи'}`, 'error');
    setStatus(error.message || 'Не удалось распознать речь', 'error');
  } finally {
    dictation.state = 'idle';
    updateMicButton();
  }
}

async function startDictation() {
  if (!dictation.supported) {
    setMicTranscript('Голосовой ввод недоступен в этом браузере.', 'error');
    setStatus('Голосовой ввод недоступен в этом браузере', 'error');
    return;
  }

  // Second press stops the recording, which triggers transcription.
  if (dictation.state === 'recording') {
    dictation.recorder?.stop();
    return;
  }

  if (dictation.state === 'transcribing') {
    return;
  }

  // The click is a user gesture — a good moment to unlock NPC audio too.
  requestGameAudioUnlock();

  try {
    dictation.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    setMicTranscript('Доступ к микрофону запрещен. Разрешите его в браузере.', 'error');
    setStatus('Доступ к микрофону запрещён. Разрешите его в браузере.', 'error');
    return;
  }

  const mimeType = pickAudioMimeType();
  const recorder = mimeType
    ? new MediaRecorder(dictation.stream, { mimeType })
    : new MediaRecorder(dictation.stream);
  dictation.recorder = recorder;
  dictation.chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      dictation.chunks.push(event.data);
    }
  };

  recorder.onstop = async () => {
    stopMicStream();
    const type = recorder.mimeType || mimeType || 'audio/webm';
    const blob = new Blob(dictation.chunks, { type });
    dictation.chunks = [];
    dictation.recorder = null;

    if (blob.size < 1200) {
      dictation.state = 'idle';
      updateMicButton();
      setMicTranscript('Слишком коротко: нажмите 🎤 и скажите фразу целиком.', 'error');
      setStatus('Слишком коротко. Нажмите 🎤 и говорите.', 'error');
      return;
    }

    await transcribeRecording(blob, type);
  };

  recorder.onerror = () => {
    stopMicStream();
    dictation.state = 'idle';
    dictation.recorder = null;
    updateMicButton();
    setMicTranscript('Ошибка записи микрофона.', 'error');
    setStatus('Ошибка записи микрофона', 'error');
  };

  recorder.start();
  dictation.state = 'recording';
  updateMicButton();
  setMicTranscript('Слушаю микрофон… нажмите 🎤 еще раз, когда закончите фразу.');
  setStatus('🎤 Запись… нажмите 🎤 ещё раз, когда закончите', 'ready');
}

function exportCustomTargets() {
  const exportedNavAreaBlocks = exportNavAreaBlocks();

  return {
    version: 1,
    storageKey: CUSTOM_TARGET_STORAGE_KEY,
    storageKeys: {
      targets: CUSTOM_TARGET_STORAGE_KEY,
      navAreaBlocks: NAV_AREA_BLOCK_STORAGE_KEY,
    },
    exportedAt: new Date().toISOString(),
    counts: {
      targets: customTargets.length,
      deletedTargetIds: deletedTargetIds.size,
      navAreaBlocks: exportedNavAreaBlocks.length,
    },
    deletedTargetIds: [...deletedTargetIds],
    navAreaBlocks: exportedNavAreaBlocks,
    targets: customTargets,
  };
}

async function writeTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Clipboard write timed out')), 1500);
        }),
      ]);
      return;
    } catch (error) {
      console.warn(error);
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.append(textarea);
  textarea.select();

  try {
    const copied = document.execCommand('copy');

    if (!copied) {
      throw new Error('document.execCommand("copy") returned false');
    }
  } finally {
    textarea.remove();
  }
}

async function copyCustomTargetCoordinates() {
  const payload = JSON.stringify(exportCustomTargets(), null, 2);
  const cutCount = navAreaBlocks.length;
  document.body.dataset.coordinateExport = payload;
  exportOutput.hidden = false;
  exportOutput.value = payload;
  exportOutput.focus();
  exportOutput.select();
  setStatus(`Экспорт подготовлен: ${customTargets.length} Ziele, ${cutCount} cut areas`, 'ready');

  try {
    await writeTextToClipboard(payload);
    setStatus(`Скопировано: ${customTargets.length} Ziele, ${cutCount} cut areas`, 'ready');
  } catch (error) {
    console.error(error);
    setStatus('Не удалось скопировать, но JSON сохранен в body.dataset.coordinateExport', 'error');
  }
}

function getNavKind(object) {
  const name = getObjectNavName(object);
  const explicit = object.userData?.navmesh || object.userData?.navMesh;

  if (QUEST_ENABLED && cityRoot?.name === 'Fantasy_Town') {
    if (Object.values(NAV_KINDS).includes(explicit)) {
      return explicit;
    }

    return NAV_KINDS.DECOR;
  }

  return navKindOverrides[name] || getDefaultNavKind(object);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function countTriangles(object) {
  const geometry = object.geometry;

  if (!geometry?.attributes?.position) {
    return 0;
  }

  const indexCount = geometry.index?.count || geometry.attributes.position.count;
  return Math.floor(indexCount / 3) * (object.isInstancedMesh ? object.count : 1);
}

function collectMeshInfos(root) {
  const infos = [];

  root.traverse((object) => {
    if (!object.isMesh && !object.isInstancedMesh) {
      return;
    }

    infos.push({
      object,
      name: getObjectNavName(object),
      triangles: countTriangles(object),
    });
  });

  infos.sort((a, b) => b.triangles - a.triangles);
  return infos;
}

function renderMeshList() {
  const totals = meshInfos.reduce(
    (acc, info) => {
      acc.count += 1;
      acc.triangles += info.triangles;
      acc[getNavKind(info.object)] += 1;
      return acc;
    },
    { count: 0, triangles: 0, walkable: 0, blocker: 0, decor: 0 },
  );

  meshStats.textContent = `${totals.count} meshes · ${totals.triangles.toLocaleString('ru-RU')} tris · walk ${totals.walkable} · block ${totals.blocker} · decor ${totals.decor}`;
  meshList.replaceChildren();

  for (const info of meshInfos) {
    const row = document.createElement('div');
    row.className = 'mesh-row';

    const name = document.createElement('div');
    name.className = 'mesh-name';
    name.innerHTML = `<strong></strong><span></span>`;
    name.querySelector('strong').textContent = info.name;
    name.querySelector('span').textContent = `${info.triangles.toLocaleString('ru-RU')} triangles`;

    const select = document.createElement('select');

    for (const kind of ['walkable', 'blocker', 'decor']) {
      const option = document.createElement('option');
      option.value = kind;
      option.textContent = kind;
      select.append(option);
    }

    select.value = getNavKind(info.object);
    select.addEventListener('change', () => {
      navKindOverrides[info.name] = select.value;
      saveNavKindOverrides();
      renderMeshList();
    });

    row.append(name, select);
    meshList.append(row);
  }
}

function createMarker(target) {
  const geometry = new THREE.SphereGeometry(target.type === 'interactive' ? 0.55 : 0.75, 16, 12);
  const material = new THREE.MeshStandardMaterial({
    color: target.type === 'interactive' ? 0xffd166 : 0x52f0c0,
    emissive: target.type === 'interactive' ? 0x5a3c00 : 0x064837,
    roughness: 0.55,
  });
  const marker = new THREE.Mesh(geometry, material);
  marker.name = `Marker_${target.id}`;
  const markerPoint = target.isPointTarget ? target.center : target.routePoint || target.approachPoint || target.center;
  marker.position.copy(markerPoint).add(new THREE.Vector3(0, 1.2, 0));
  marker.userData.targetId = target.id;
  return marker;
}

function renderTargets() {
  targetMarkers.clear();
  targetList.replaceChildren();

  if (!registry) {
    return;
  }

  for (const target of registry.targets) {
    if (target.routePoint || target.approachPoint || target.center) {
      targetMarkers.add(createMarker(target));
    }
  }

  const visibleTargets = [...registry.getVisibleTargets()];

  for (const npc of npcs) {
    syncNpcTarget(npc);
    npc.marker = createMarker(npc.target);
    targetMarkers.add(npc.marker);
    visibleTargets.push(npc.target);
  }

  for (const target of visibleTargets) {
    const chip = document.createElement('div');
    chip.className = 'target-chip';

    const go = document.createElement('button');
    go.className = 'target-go';
    go.type = 'button';
    go.textContent = target.label;
    go.title = target.label;
    go.addEventListener('click', () => {
      moveToTarget(target, null);
    });

    const remove = document.createElement('button');
    remove.className = 'target-delete';
    remove.type = 'button';
    remove.textContent = 'x';
    remove.title = `Delete ${target.label}`;
    remove.hidden = target.id === NPC_ID || target.source === 'npc';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteTarget(target);
    });

    chip.append(go, remove);
    targetList.append(chip);
  }
}

function deleteTarget(target) {
  const normalizedLabel = normalizeText(target.label);
  const shouldPersistDeletion = target.source !== 'custom';
  const beforeCustomCount = customTargets.length;
  customTargets = customTargets.filter(
    (item) => item.id !== target.id && normalizeText(item.label) !== normalizedLabel,
  );

  if (customTargets.length !== beforeCustomCount) {
    saveCustomTargets();
  }

  if (shouldPersistDeletion) {
    deletedTargetIds.add(target.id);
    saveDeletedTargetIds();
  }

  rebuildRegistryFromCustomTargets();
  setStatus(`Ziel deleted: ${target.label}`, 'ready');
}

function resolveTargetById(targetId) {
  const npc = getNpcForTargetId(targetId);

  if (npc) {
    return npc.target;
  }

  if (targetId === NPC_ID) {
    return getNpcTarget();
  }

  return registry?.getById(targetId) || null;
}

function renderNavAreaBlocks() {
  navAreaBlockMarkers.clear();

  for (const area of navAreaBlocks) {
    const geometry = new THREE.CircleGeometry(area.radius, 40);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff5c5c,
      depthWrite: false,
      opacity: 0.42,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.name = `Nav_Cut_${area.id}`;
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(area.x, area.y + 0.08, area.z);
    marker.renderOrder = 28;
    navAreaBlockMarkers.add(marker);
  }

  undoCutButton.disabled = navAreaBlocks.length === 0;
  clearCutsButton.disabled = navAreaBlocks.length === 0;
}

function setPickMode(enabled) {
  if (enabled && isCutMode) {
    setCutMode(false);
  }

  isPickMode = enabled;
  pendingPick = null;
  pickTargetButton.classList.toggle('active', enabled);
  pickTargetButton.textContent = enabled ? 'Picking...' : 'Pick Ziel';
  pickForm.hidden = true;
  setStatus(
    enabled ? 'Кликни по Kirche, Stühle или любому объекту, чтобы сохранить Ziel' : 'Pick Ziel выключен',
    enabled ? 'ready' : 'loading',
  );
}

function setCutMode(enabled) {
  if (enabled && isPickMode) {
    setPickMode(false);
  }

  isCutMode = enabled;
  cutNavmeshButton.classList.toggle('active', enabled);
  cutNavmeshButton.textContent = enabled ? 'Cutting...' : 'Cut road';
  setStatus(enabled ? 'Click road/navmesh areas to cut them, then Rebuild' : 'Cut road off', enabled ? 'ready' : 'loading');
}

function setFlyMode(enabled) {
  if (isFlyMode === enabled) {
    return;
  }

  isFlyMode = enabled;
  flyModeButton.classList.toggle('active', enabled);
  flyModeButton.textContent = enabled ? 'Flying' : 'Fly';
  agent.path = [];
  agent.pathIndex = 0;
  agent.pendingAction = null;
  agent.pendingNpcAction = null;
  agent.pendingArrivalPoint = null;

  if (enabled) {
    agent.position.add(new THREE.Vector3(0, agent.eyeHeight, 0));
    agent.eyeHeight = 0;
    setStatus('Fly mode on', 'ready');
  } else {
    const snapped = navigation?.snapToNavMesh(agent.position);

    if (snapped) {
      agent.position.copy(snapped);
    }

    agent.eyeHeight = 1.66;
    setStatus('Fly mode off', 'ready');
  }

  publishDebugState();
}

function showPickForm(hit) {
  const objectName = getObjectNavName(hit.object);
  const snapped = navigation?.snapToNavMesh(hit.point);
  const approachPoint = snapped || hit.point;

  pendingPick = {
    objectName,
    point: hit.point.clone(),
    approachPoint: approachPoint.clone(),
  };

  pickDetails.textContent = `${objectName} · x ${hit.point.x.toFixed(2)}, y ${hit.point.y.toFixed(2)}, z ${hit.point.z.toFixed(2)}`;
  pickLabel.value = /^mesh/i.test(objectName) ? '' : objectName;
  pickAction.value = /stuhl|stühle|stuehle|chair/i.test(objectName) ? 'sit' : '';
  pickForm.hidden = false;
  pickLabel.focus();
  setStatus('Назови выбранный объект по-немецки и сохрани', 'ready');
}

function addNavAreaBlock(point) {
  const radius = Number(cutRadiusInput.value || 3);
  navAreaBlocks = [
    ...navAreaBlocks,
    {
      id: `cut_${Date.now()}_${navAreaBlocks.length}`,
      x: Number(point.x.toFixed(3)),
      y: Number(point.y.toFixed(3)),
      z: Number(point.z.toFixed(3)),
      radius: Number(radius.toFixed(2)),
    },
  ];
  saveNavAreaBlocks();
  renderNavAreaBlocks();
  publishDebugState();
  setStatus(`Cut saved: ${navAreaBlocks.length} areas. Press Rebuild.`, 'ready');
}

function undoNavAreaBlock() {
  if (!navAreaBlocks.length) {
    return;
  }

  navAreaBlocks = navAreaBlocks.slice(0, -1);
  saveNavAreaBlocks();
  renderNavAreaBlocks();
  publishDebugState();
  setStatus(`Cut areas: ${navAreaBlocks.length}. Press Rebuild.`, 'ready');
}

function clearNavAreaBlocks() {
  if (!navAreaBlocks.length) {
    return;
  }

  navAreaBlocks = [];
  saveNavAreaBlocks();
  renderNavAreaBlocks();
  publishDebugState();
  setStatus('Cut areas cleared. Press Rebuild.', 'ready');
}

function rebuildRegistryFromCustomTargets() {
  if (!cityRoot) {
    return;
  }

  registry = new WorldRegistry(cityRoot, customTargets, deletedTargetIds, {
    includeBuiltInTargets: !QUEST_ENABLED,
    includeSceneTargets: !QUEST_ENABLED,
  });

  if (navigation) {
    registry.bindNavigation(navigation);
  }

  renderTargets();
  publishDebugState();
}

function savePendingPick() {
  const label = pickLabel.value.trim();

  if (!pendingPick || !label) {
    setStatus('Сначала выбери объект и введи имя', 'error');
    return;
  }

  const idBase = createIdFromLabel(label);
  let id = idBase;
  let suffix = 2;

  while (customTargets.some((target) => target.id === id)) {
    id = `${idBase}_${suffix}`;
    suffix += 1;
  }

  const action = pickAction.value || undefined;

  customTargets = [
    ...customTargets,
    {
      id,
      label,
      aliases: [label, pendingPick.objectName],
      type: action === 'sit' ? 'interactive' : 'poi',
      action,
      meshName: pendingPick.objectName,
      position: serializePoint(pendingPick.point),
      approachPosition: serializePoint(pendingPick.approachPoint),
    },
  ];

  saveCustomTargets();
  setPickMode(false);
  rebuildRegistryFromCustomTargets();
  setStatus(`Ziel сохранен: ${label}`, 'ready');
}

function setInitialAgentPosition() {
  if (QUEST_ENABLED) {
    const snapped = snapToNpcGround(QUEST_POINTS.playerSpawn);
    agent.position.copy(snapped);
    agent.path = [];
    agent.pathIndex = 0;
    agent.pendingAction = null;
    agent.pendingNpcAction = null;
    agent.pendingArrivalPoint = null;
    agent.eyeHeight = 1.66;
    lookYaw = Math.atan2(QUEST_POINTS.guard.x - agent.position.x, QUEST_POINTS.guard.z - agent.position.z);
    lookPitch = -0.08;
    agent.yaw = lookYaw;
    return;
  }

  const sceneBox = new THREE.Box3().setFromObject(cityRoot);
  const center = sceneBox.getCenter(new THREE.Vector3());
  const registryStarts = ['cafe_haus', 'doener', 'mosche', 'kub']
    .map((id) => registry?.getById(id)?.approachPoint)
    .filter(Boolean);
  const candidates = [
    ...registryStarts,
    center,
    new THREE.Vector3(0, sceneBox.min.y + 0.5, 0),
    new THREE.Vector3(-18, sceneBox.min.y + 0.5, -6),
    new THREE.Vector3(-42, sceneBox.min.y + 0.5, -10),
  ];

  for (const candidate of candidates) {
    const snapped = navigation.snapToNavMesh(candidate);

    if (snapped) {
      agent.position.copy(snapped);
      agent.yaw = lookYaw;
      return;
    }
  }

  agent.position.copy(center);
}

function finishArrival(action = null, arrivalPoint = null, npcAction = null) {
  if (arrivalPoint) {
    agent.position.copy(arrivalPoint);
  }

  if (typeof npcAction === 'string' && npcAction.startsWith('talk:')) {
    const npc = getNpcById(npcAction.slice(5));

    if (npc) {
      openDialogueWithNpc(npc, { focusInput: !pendingDialogue });

      if (pendingDialogue?.npcId === npc.id) {
        const line = pendingDialogue.line;
        pendingDialogue = null;
        window.setTimeout(() => {
          sendDialogueToNpc(npc, line);
        }, 120);
      }

      return;
    }
  }

  const animationCommand = npcAction && npcAction !== 'interact' ? findAnimationCommand(npcAction) : null;
  const isSitAction = action === 'sit';

  if (animationCommand) {
    playCharacterAnimation(animationCommand.name, { loop: animationCommand.loop });
  } else if (npcAction === 'interact') {
    playPreferredCharacterAnimation(['wave', 'waving', 'gesture'], { loop: false });
  }

  if (isSitAction) {
    agent.eyeHeight = 1.08;
    setStatus('Сел на Stuhl', 'ready');
    return;
  }

  agent.eyeHeight = 1.66;
  setStatus(animationCommand ? `Анимация: ${animationCommand.name}` : 'Пришел', 'ready');
}

async function rebuildNavigation() {
  if (!cityRoot) {
    return;
  }

  rebuildNavmeshButton.disabled = true;

  try {
    navigation = new NavigationSystem({
      scene: cityRoot,
      getKind: getNavKind,
      config: NAVMESH_CONFIG,
      onStatus: setStatus,
      blockedAreas: navAreaBlocks,
    });
    await navigation.build();
    scene.add(navigation.debugMesh, navigation.pathLine);
    navigation.debugMesh.visible = toggleNavmesh.checked;

    if (!registry) {
      registry = new WorldRegistry(cityRoot, customTargets, deletedTargetIds, {
        includeBuiltInTargets: !QUEST_ENABLED,
        includeSceneTargets: !QUEST_ENABLED,
      });
    }

    registry.setCustomTargets(customTargets);
    registry.setDeletedTargetIds(deletedTargetIds);
    registry.bindNavigation(navigation);
    renderNavAreaBlocks();
    setInitialAgentPosition();
    placeNpcTarget();
    renderTargets();
    publishDebugState();
    setStatus(
      `Navmesh готов: ${navigation.stats.navTriangles.toLocaleString('ru-RU')} tris`,
      'ready',
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
  } finally {
    rebuildNavmeshButton.disabled = false;
  }
}

function moveAlongPath(path, pendingAction = null, arrivalPoint = null, pendingNpcAction = null) {
  if (path.length < 2) {
    setStatus('Путь не найден: цель не попала на navmesh', 'error');
    return;
  }

  agent.path = path;
  agent.pathIndex = 1;
  agent.pendingAction = pendingAction;
  agent.pendingNpcAction = pendingNpcAction;
  agent.pendingArrivalPoint = arrivalPoint?.clone() || null;
  navigation.setPathDebug(path);
  setStatus(`Иду: ${path.length} точек`, 'ready');
}

function moveToPoint(point, pendingAction = null, arrivalPoint = null, pendingNpcAction = null) {
  if (!navigation) {
    return;
  }

  if (agent.position.distanceToSquared(point) < 0.16) {
    finishArrival(pendingAction, arrivalPoint, pendingNpcAction);
    return;
  }

  const path = navigation.findPath(agent.position, point);
  moveAlongPath(path, pendingAction, arrivalPoint, pendingNpcAction);
}

function moveToTarget(target, pendingAction = null, pendingNpcAction = null) {
  if (target.source === 'npc') {
    const npc = getNpcForTargetId(target.id);

    if (npc) {
      prepareNpcForApproach(npc);
      setSelectedNpc(npc);
      syncNpcTarget(npc);
      moveToPoint(target.routePoint || target.approachPoint || target.center, null, null, `talk:${npc.id}`);
      return;
    }
  }

  const destination = target.routePoint || target.approachPoint || target.center;
  const isNpcTarget = target.id === NPC_ID;
  const action = pendingAction || (!isNpcTarget ? target.action : null) || null;
  const npcAction = pendingNpcAction || (isNpcTarget ? target.action || 'interact' : null);
  const arrivalPoint = action === 'sit' ? target.arrivalPoint || target.center : null;
  moveToPoint(destination, action, arrivalPoint, npcAction);
}

function executeCommand(input) {
  if (!registry || !navigation) {
    setStatus('Сцена еще не готова', 'error');
    return;
  }

  if (isPlayerHeldByGuard()) {
    setStatus('Bruno hält Sie auf. Antworten Sie ihm zuerst.', 'ready');
    return;
  }

  const command = registry.parseCommand(input);
  const animationCommand = findAnimationCommand(input);
  const mentionedNpc = findNpcInText(input);
  const commandNpc = mentionedNpc || selectedNpc || nearbyNpc || getNearestNpc();
  const wantsNpc = Boolean(mentionedNpc) || inputMentionsNpc(input);
  const targetCommand = wantsNpc && commandNpc ? { target: commandNpc.target, actions: [] } : command;

  if (!targetCommand && animationCommand) {
    const actor = commandNpc || getNearestNpc();

    if (actor) {
      actor.path = [];
      actor.pathIndex = 0;
      actor.state = animationCommand.loop ? 'idle' : 'talking';
      playNpcAnimation(actor, animationCommand.name, { loop: animationCommand.loop, restart: true });
      setSelectedNpc(actor);
      setStatus(`Animation: ${actor.label} / ${animationCommand.name}`, 'ready');
      return;
    }

    agent.path = [];
    agent.pathIndex = 0;
    agent.pendingAction = null;
    agent.pendingNpcAction = null;
    agent.pendingArrivalPoint = null;
    playCharacterAnimation(animationCommand.name, { loop: animationCommand.loop });
    setStatus(`Анимация: ${animationCommand.name}`, 'ready');
    return;
  }

  if (!targetCommand) {
    setStatus('Не нашел цель в команде', 'error');
    return;
  }

  const parsedAction = targetCommand.actions.at(-1)?.type || null;
  if (wantsNpc) {
    moveToTarget(targetCommand.target, null, animationCommand?.name || parsedAction || 'interact');
    return;
  }

  moveToTarget(targetCommand.target, parsedAction);
}

function updateAgent(deltaTime) {
  if (!agent.path.length || agent.pathIndex >= agent.path.length) {
    return;
  }

  const target = agent.path[agent.pathIndex];
  const toTarget = target.clone().sub(agent.position);
  const distance = toTarget.length();

  if (distance < 0.18) {
    agent.position.copy(target);
    agent.pathIndex += 1;

    if (agent.pathIndex >= agent.path.length) {
      const action = agent.pendingAction;
      const npcAction = agent.pendingNpcAction;
      const arrivalPoint = agent.pendingArrivalPoint;
      agent.path = [];
      agent.pendingAction = null;
      agent.pendingNpcAction = null;
      agent.pendingArrivalPoint = null;
      finishArrival(action, arrivalPoint, npcAction);

      publishDebugState();
    }

    return;
  }

  agent.eyeHeight += (1.66 - agent.eyeHeight) * Math.min(deltaTime * 5, 1);
  toTarget.normalize();

  const step = Math.min(distance, agent.speed * deltaTime);
  agent.position.addScaledVector(toTarget, step);

  const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
  const yawDelta = Math.atan2(Math.sin(desiredYaw - agent.yaw), Math.cos(desiredYaw - agent.yaw));
  agent.yaw += yawDelta * Math.min(deltaTime * 8, 1);
}

function updateFlight(deltaTime) {
  if (!isFlyMode) {
    return;
  }

  if (isPlayerHeldByGuard()) {
    return;
  }

  const forward = new THREE.Vector3(
    Math.sin(lookYaw) * Math.cos(lookPitch),
    Math.sin(lookPitch),
    Math.cos(lookYaw) * Math.cos(lookPitch),
  ).normalize();
  const right = new THREE.Vector3(Math.cos(lookYaw), 0, -Math.sin(lookYaw)).normalize();
  const movement = new THREE.Vector3();

  if (pressedKeys.has('KeyW')) {
    movement.add(forward);
  }

  if (pressedKeys.has('KeyS')) {
    movement.sub(forward);
  }

  if (pressedKeys.has('KeyD')) {
    movement.add(right);
  }

  if (pressedKeys.has('KeyA')) {
    movement.sub(right);
  }

  if (pressedKeys.has('Space') || pressedKeys.has('KeyE')) {
    movement.y += 1;
  }

  if (pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight') || pressedKeys.has('KeyQ')) {
    movement.y -= 1;
  }

  if (movement.lengthSq() <= 0) {
    return;
  }

  movement.normalize();
  const speed = pressedKeys.has('ControlLeft') || pressedKeys.has('ControlRight') ? 14 : 7;
  agent.position.addScaledVector(movement, speed * deltaTime);
  agent.yaw = lookYaw;
}

function updateCharacter(deltaTime) {
  updateNpcs(deltaTime);

  if (characterMixer) {
    characterMixer.update(deltaTime);
  }

  if (!characterModel) {
    return;
  }

  characterRig.visible = true;

  if (npcTarget) {
    characterRig.position.copy(npcTarget.center);
    const toAgent = agent.position.clone().sub(npcTarget.center);

    if (toAgent.lengthSq() > 0.01) {
      characterRig.rotation.y = Math.atan2(toAgent.x, toAgent.z);
    }
  }
}

function updateCamera() {
  const eye = isFlyMode
    ? agent.position.clone()
    : agent.position.clone().add(new THREE.Vector3(0, agent.eyeHeight, 0));
  const lookDirection = new THREE.Vector3(
    Math.sin(lookYaw) * Math.cos(lookPitch),
    Math.sin(lookPitch),
    Math.cos(lookYaw) * Math.cos(lookPitch),
  );

  camera.position.copy(eye);
  camera.lookAt(eye.clone().add(lookDirection));
}

function animate() {
  const now = performance.now();
  const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  if (isFlyMode) {
    updateFlight(deltaTime);
  } else {
    updateAgent(deltaTime);
  }

  updateCharacter(deltaTime);
  updateQuest();
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function isUiTarget(target) {
  return Boolean(target.closest?.('.panel'));
}

function isEditableTarget(target) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function handleCanvasClick(event) {
  if (!cityRoot || !navigation || isUiTarget(event.target)) {
    return;
  }

  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);

  if (isCutMode) {
    const hits = raycaster.intersectObject(cityRoot, true);

    if (hits.length) {
      addNavAreaBlock(hits[0].point);
    } else {
      setStatus('No surface under cursor', 'error');
    }

    return;
  }

  if (isPickMode) {
    const hits = raycaster.intersectObject(cityRoot, true);

    if (hits.length) {
      showPickForm(hits[0]);
    } else {
      setStatus('Под курсором нет меша', 'error');
    }

    return;
  }

  if (isFlyMode) {
    return;
  }

  if (isPlayerHeldByGuard()) {
    setStatus('Bruno hält Sie auf. Antworten Sie ihm zuerst.', 'ready');
    return;
  }

  const npcHits = raycaster.intersectObject(npcContainer, true);

  if (npcHits.length) {
    const npc = getNpcFromObject(npcHits[0].object);

    if (npc) {
      prepareNpcForApproach(npc);
      moveToTarget(npc.target);
      return;
    }
  }

  const targetHits = raycaster.intersectObjects(targetMarkers.children, false);

  if (targetHits.length) {
    const targetId = targetHits[0].object.userData.targetId;
    const target = resolveTargetById(targetId);

    if (target) {
      moveToTarget(target);
      return;
    }
  }

  const hits = raycaster.intersectObject(cityRoot, true);

  if (hits.length) {
    moveToPoint(hits[0].point);
  }
}

function setupInputEvents() {
  commandForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await unlockGameAudio({ showStatus: true });
    executeCommand(commandInput.value);
  });

  dialogueForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await unlockGameAudio({ showStatus: true });
    submitDialogueLine();
  });

  interactNpcButton.addEventListener('click', () => {
    requestGameAudioUnlock({ showStatus: true });
    interactWithNearestNpc();
  });

  if (micButton) {
    micButton.addEventListener('click', startDictation);
    updateMicButton();
  }

  rebuildNavmeshButton.addEventListener('click', rebuildNavigation);

  pickTargetButton.addEventListener('click', () => {
    setPickMode(!isPickMode);
  });

  copyTargetsButton.addEventListener('click', () => {
    copyCustomTargetCoordinates();
  });

  flyModeButton.addEventListener('click', () => {
    setFlyMode(!isFlyMode);
  });

  cutNavmeshButton.addEventListener('click', () => {
    setCutMode(!isCutMode);
  });

  cutRadiusInput.addEventListener('input', () => {
    cutRadiusValue.value = Number(cutRadiusInput.value || 3).toFixed(1);
  });

  undoCutButton.addEventListener('click', undoNavAreaBlock);
  clearCutsButton.addEventListener('click', clearNavAreaBlocks);

  pickForm.addEventListener('submit', (event) => {
    event.preventDefault();
    savePendingPick();
  });

  pickCancel.addEventListener('click', () => {
    setPickMode(false);
  });

  toggleNavmesh.addEventListener('change', () => {
    if (navigation?.debugMesh) {
      navigation.debugMesh.visible = toggleNavmesh.checked;
    }
  });

  toggleTargets.addEventListener('change', () => {
    targetMarkers.visible = toggleTargets.checked;
  });

  window.addEventListener('keydown', (event) => {
    if (isEditableTarget(event.target)) {
      return;
    }

    requestGameAudioUnlock();

    if (event.code === 'Escape') {
      if (isPickMode) {
        setPickMode(false);
      }

      if (isCutMode) {
        setCutMode(false);
      }
    }

    if (!isFlyMode && event.code === 'KeyE') {
      interactWithNearestNpc();
      event.preventDefault();
      return;
    }

    pressedKeys.add(event.code);

    if (isFlyMode) {
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    pressedKeys.delete(event.code);
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (isUiTarget(event.target)) {
      return;
    }

    requestGameAudioUnlock();
    pointerStart = { x: event.clientX, y: event.clientY };
    isPointerDragging = false;
  });

  window.addEventListener('pointermove', (event) => {
    if (!pointerStart || isUiTarget(event.target)) {
      return;
    }

    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;

    if (Math.abs(dx) + Math.abs(dy) > 3) {
      isPointerDragging = true;
      lookYaw -= dx * 0.003;
      lookPitch = THREE.MathUtils.clamp(lookPitch - dy * 0.002, -0.8, 0.45);
      pointerStart = { x: event.clientX, y: event.clientY };
    }
  });

  window.addEventListener('pointerup', (event) => {
    const wasDragging = isPointerDragging;
    pointerStart = null;
    isPointerDragging = false;

    if (!wasDragging) {
      handleCanvasClick(event);
    }
  });
}

function loadCity() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  loader.load(
    MAP_URL,
    async (gltf) => {
      cityRoot = gltf.scene;
      cityRoot.name = 'Fantasy_Town';
      installQuestWalkables(cityRoot);
      scene.add(cityRoot);

      meshInfos = collectMeshInfos(cityRoot);
      renderMeshList();

      setStatus('Деревня загружена, строю navmesh...');
      await rebuildNavigation();
      window.setTimeout(() => {
        loadNpcCharactersAndAnimations();
      }, 100);
    },
    (event) => {
      if (event.total) {
        const progress = Math.round((event.loaded / event.total) * 100);
        setStatus(`Загрузка деревни: ${progress}%`);
      }
    },
    (error) => {
      console.error(error);
      setStatus('Не удалось загрузить fantasy-town.glb', 'error');
    },
  );
}

window.addEventListener('resize', resize);
resize();
setupInputEvents();
cutRadiusValue.value = Number(cutRadiusInput.value || 3).toFixed(1);
targetMarkers.visible = toggleTargets.checked;
renderNavAreaBlocks();
loadCity();
animate();
