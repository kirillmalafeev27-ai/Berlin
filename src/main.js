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
const hudQuestLabel = document.querySelector('#hud-quest');
const dialogueTarget = document.querySelector('#dialogue-target');
const dialogueLog = document.querySelector('#dialogue-log');
const questChips = document.querySelector('#quest-chips');
const dialogueForm = document.querySelector('#dialogue-form');
const dialogueInput = document.querySelector('#dialogue-input');
const dialogueSubmit = document.querySelector('#dialogue-submit');
const interactNpcButton = document.querySelector('#interact-npc');
const micButton = document.querySelector('#mic-button');
const micDeviceSelect = document.querySelector('#mic-device');
const micMeter = document.querySelector('#mic-meter');
const micMeterBar = micMeter?.querySelector('span') || null;
const micTranscript = document.querySelector('#mic-transcript');
const transitionOverlay = document.querySelector('#transition-overlay');
const transitionTitle = document.querySelector('#transition-title');
const sceneHint = document.querySelector('#scene-hint');
const locationLabel = document.querySelector('#location-label');
const dayLabel = document.querySelector('#day-label');
const exitLocationButton = document.querySelector('#exit-location');
const dorfbuchOpenButton = document.querySelector('#dorfbuch-open');
const dorfbuchPanel = document.querySelector('#dorfbuch-panel');
const dorfbuchCloseButton = document.querySelector('#dorfbuch-close');
const dorfbuchContent = document.querySelector('#dorfbuch-content');
const walletOpenButton = document.querySelector('#wallet-open');
const walletPanel = document.querySelector('#wallet-panel');
const walletCloseButton = document.querySelector('#wallet-close');
const walletStatus = document.querySelector('#wallet-status');
const walletCount = document.querySelector('#wallet-count');
const counterCount = document.querySelector('#counter-count');
const coinGame = document.querySelector('#coin-game');
const coinResetButton = document.querySelector('#coin-reset');
const coinPayButton = document.querySelector('#coin-pay');
const npcToolOpenButton = document.querySelector('#npc-tool-open');
const npcToolPanel = document.querySelector('#npc-tool-panel');
const npcToolCloseButton = document.querySelector('#npc-tool-close');
const npcToolSelect = document.querySelector('#npc-tool-select');
const npcToolCoords = document.querySelector('#npc-tool-coords');
const npcToolStepInput = document.querySelector('#npc-tool-step-input');
const npcToolStepValue = document.querySelector('#npc-tool-step-value');
const npcToolClickPlace = document.querySelector('#npc-tool-clickplace');
const npcToolExportButton = document.querySelector('#npc-tool-export');
const npcToolResetButton = document.querySelector('#npc-tool-reset');
const npcToolOutput = document.querySelector('#npc-tool-output');

if (dialogueInput) {
  dialogueInput.placeholder = 'Напишите или скажите 🎤 немецкую фразу';
}

const NAV_KIND_STORAGE_KEY = 'berlin-game.nav-kinds.v1';
const CUSTOM_TARGET_STORAGE_KEY = 'berlin-game.custom-targets.v1';
const DELETED_TARGET_STORAGE_KEY = 'berlin-game.deleted-targets.v1';
const NAV_AREA_BLOCK_STORAGE_KEY = 'berlin-game.nav-area-blocks.v1';
const NPC_OVERRIDE_STORAGE_KEY = 'berlin-game.npc-overrides.v1';
const MAP_URL = '/fantasy-town.glb';
const GASTHAUS_INTERIOR_URL = '/Tavern%20noch%20eine.glb';
const BAKERY_INTERIOR_URL = '/bakery_filled_shelves.glb';
// The interior is fitted + centred on its ground-floor tiles so roof overhangs
// never shrink or offset the playable area (see normalizeGasthausModel).
const GASTHAUS_FLOOR_SPAN = 10.8;
const CHARACTER_MODEL_URL = '/Meshy_AI_Character_output.fbx';
// Declared before the Gasthaus roster below references it (const has no
// hoisting, so ordering matters for module-load-time evaluation).
const ELEVENLABS_VOICES = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  domi: 'AZnzlk1XvdvUeBnXmlld',
  bella: 'EXAVITQu4vr4xnSDxMaL',
  antoni: 'ErXwobaYiN019PkySvjV',
  elli: 'MF3mGyEYCl7XYWbV9V6O',
  josh: 'TxGEqnHWrfWFTfGW9Xjo',
  arnold: 'VR6AewLTigWG4xSOukaG',
  adam: 'pNInz6obpgDQGcFmaJgB',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
  // ElevenLabs multilingual narrator for Russian teaching overlays.
  russianNarrator: 'EXAVITQu4vr4xnSDxMaL',
  // Warm European female, reads German cleanly with eleven_multilingual_v2 -
  // used for the innkeeper at the bar.
  charlotte: 'XB0fDUnXU5powFXDhCwa',
};
// Rigged, lip-synced character GLBs. NPCs must use these real models from the
// characters collection; do not replace a failed model with procedural shapes.
const GASTHAUS_CHARACTER_URLS = {
  grandmother: '/Mixamo/characters/Idle_Grandmother_Y_UP_baked.rigged%20(2).glb',
  berliner: '/Mixamo/characters/Idle%20berliner%20man_YUP_baked.rigged.glb',
  chef: '/Mixamo/characters/Idle%20Meshy_AI_The_Welcoming_Chef_0705154142_texture_YUP_baked.rigged.glb',
  oliveCoat: '/Mixamo/characters/idle%20olive%20coat_YUP_baked.rigged.glb',
  hijabiProfessional: '/Mixamo/characters/idle%20on%20Meshy_AI_Hijabi_Professional_0705154041_texture_YUP_baked.rigged.glb',
};
// Seated NPCs loop this Mixamo body clip; it retargets onto the shared
// mixamorig skeleton the characters use.
const GASTHAUS_SITTING_CLIP_URLS = [
  '/Mixamo/glb/Sitting%20Laughing.glb',
  '/Mixamo/glb/Sitting%20Idle.glb',
];
const EMPTY_TEXTURE_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lb9ZfwAAAABJRU5ErkJggg==';
const NPC_ID = 'npc_character';
const NPC_LABEL = 'NPC';
const NPC_ALIASES = ['npc', 'нпс', 'персонаж', 'человек', 'mann', 'person', 'charakter', 'character'];

const NPC_INTERACTION_DISTANCE = 6;
const NPC_TALK_STOP_DISTANCE = 4.1;
const NPC_APPROACH_DISTANCE = 3;
const NPC_TARGET_HEIGHT = 2.3;
// The player matches the villagers' height (NPC_TARGET_HEIGHT): eyes sit at
// ~93% of body height, so the camera meets the NPCs at eye level.
const PLAYER_EYE_HEIGHT = 2.14;
const PLAYER_SEATED_EYE_HEIGHT = 1.39;
// The bakery interior is authored at real-life scale (ceiling ≈ 2.5, counter
// tops ≈ 0.9 above the floor boards), so the 2.3-unit villagers loom against
// the ceiling there. Use human proportions inside: 1.75 tall, eyes at ~93%.
const BAKERY_NPC_HEIGHT = 1.75;
const BAKERY_PLAYER_EYE_HEIGHT = 1.63;
const NPC_PATROL_WAIT_MIN = 1.2;
const NPC_PATROL_WAIT_MAX = 4.8;
const NPC_PATROL_REPATH_INTERVAL = 0.7;
const NPC_AUTONOMOUS_PATROL_ENABLED = false;
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
const LOCATION_VILLAGE = 'village';
const LOCATION_GASTHAUS = 'gasthaus';
const LOCATION_BAKERY = 'bakery';
const GASTHAUS_ENTRY_TARGET_ID = 'gasthaus_gruenbach';
const BAKERY_ENTRY_TARGET_ID = 'baeckerei_gruenbach';
const GASTHAUS_DOOR_POINT = new THREE.Vector3(72.0, 4.82, 57.0);
const GASTHAUS_APPROACH_POINT = new THREE.Vector3(71.35, 4.82, 57.65);
const GASTHAUS_RETURN_POINT = new THREE.Vector3(70.2, 4.82, 61.0);
const GASTHAUS_ENTRY_RADIUS = 1.15;
const BAKERY_DOOR_POINT = new THREE.Vector3(39.452, 5.02, 80.653);
const BAKERY_APPROACH_POINT = new THREE.Vector3(39.452, 5.02, 80.653);
const BAKERY_RETURN_POINT = new THREE.Vector3(40.6, 5.02, 79.5);
const BAKERY_ENTRY_RADIUS = 1.15;
// Interior coordinates for "Tavern noch eine": the floor is centred on the
// origin (X in [-5.4, 5.4], Z in [-4.3, 4.3]) with its surface at y = 0. The
// entrance is on the +Z (front) side; the bar sits front-left, the fireplace
// back-right.
const GASTHAUS_PLAYER_SPAWN = new THREE.Vector3(2.2, 0.03, 3.4);
const GASTHAUS_BOUNDS = { minX: -4.9, maxX: 4.9, minZ: -3.9, maxZ: 3.9, y: 0.03 };
const BAKERY_PLAYER_SPAWN = new THREE.Vector3(-2.548, 0.04, -0.121);
const BAKERY_BOUNDS = { minX: -4.8, maxX: 4.8, minZ: -3.8, maxZ: 3.8, y: 0.04 };
const GASTHAUS_ENTRY_TARGET = {
  id: GASTHAUS_ENTRY_TARGET_ID,
  label: 'Gasthaus Grünbach',
  aliases: ['gasthaus', 'gasthaus gruenbach', 'gasthaus grünbach', 'hotel', 'inn', 'tavern', 'гостиница'],
  type: 'interactive',
  action: 'enter_gasthaus',
  position: serializePlainVector(GASTHAUS_DOOR_POINT),
  approachPosition: serializePlainVector(GASTHAUS_APPROACH_POINT),
};
const BAKERY_ENTRY_TARGET = {
  id: BAKERY_ENTRY_TARGET_ID,
  label: 'Bäckerei',
  aliases: ['baeckerei', 'bäckerei', 'backerei', 'bakery', 'baker', 'пекарня'],
  type: 'interactive',
  action: 'enter_bakery',
  position: serializePlainVector(BAKERY_DOOR_POINT),
  approachPosition: serializePlainVector(BAKERY_APPROACH_POINT),
};
const GASTHAUS_NPCS = [
  {
    id: 'frau_berta',
    label: 'Frau Berta',
    role: 'Frau Berta, the loud, warm, businesslike innkeeper of Gasthaus Grünbach',
    aliases: ['berta', 'frau berta', 'wirtin', 'innkeeper', 'хозяйка'],
    // Default placement saved from the in-game Gasthaus layout.
    modelUrl: GASTHAUS_CHARACTER_URLS.grandmother,
    position: new THREE.Vector3(-0.806, -0.9, -2.72),
    yaw: 1.2209,
    voiceId: ELEVENLABS_VOICES.charlotte,
    color: 0x7d3f98,
  },
  {
    id: 'gast_joerg',
    label: 'Gast Jörg',
    role: 'Jörg, a relaxed guest at the tavern table',
    aliases: ['jörg', 'joerg', 'gast', 'guest', 'постоялец'],
    // Default placement saved from the in-game Gasthaus layout.
    modelUrl: GASTHAUS_CHARACTER_URLS.berliner,
    position: new THREE.Vector3(0.048, -0.7, -5.172),
    yaw: -0.2618,
    seated: true,
    voiceId: ELEVENLABS_VOICES.josh,
    color: 0x426aa4,
  },
  {
    // Cameo of a quest 3 neighbour (Bäcker Hans) resting in the tavern.
    id: 'gast_hans',
    label: 'Bäcker Hans',
    role: 'Hans, a friendly village baker relaxing at the tavern with a mug',
    aliases: ['hans', 'baecker', 'bäcker', 'baker', 'пекарь'],
    modelUrl: GASTHAUS_CHARACTER_URLS.chef,
    // Default placement saved from the in-game Gasthaus layout.
    position: new THREE.Vector3(8.29, -0.7, 1.4),
    yaw: 2.8798,
    seated: true,
    voiceId: ELEVENLABS_VOICES.antoni,
    color: 0xc57b2d,
  },
];
const GASTHAUS_DOOR_TARGETS = [
  { id: 'room_eins', label: 'Tür eins', word: 'eins', position: new THREE.Vector3(-3.2, 0, -3.6) },
  { id: 'room_zwei', label: 'Tür zwei', word: 'zwei', position: new THREE.Vector3(-1.8, 0, -3.6) },
  { id: 'room_drei', label: 'Tür drei', word: 'drei', position: new THREE.Vector3(-0.4, 0, -3.6) },
  { id: 'room_vier', label: 'Tür vier', word: 'vier', position: new THREE.Vector3(1.0, 0, -3.6) },
];
const QUEST_THREE_ID = 'drei_nachbarn';
const QUEST_THREE_NPCS = [
  {
    id: 'baecker_hans',
    label: 'Bäcker Hans',
    shortName: 'Hans',
    role: 'Hans, a friendly village baker. Answers A1 German questions clearly and briefly.',
    modelUrl: GASTHAUS_CHARACTER_URLS.chef,
    aliases: ['hans', 'baecker', 'bäcker', 'baker', 'пекарь'],
    voiceId: ELEVENLABS_VOICES.antoni,
    color: 0xc57b2d,
    position: new THREE.Vector3(67.0, 4.82, 58.0),
    yaw: -Math.PI / 2,
    facts: {
      name: 'Hans',
      job: 'Bäcker',
      lives: 'über der Bäckerei',
      age: 'vierzig',
    },
    answers: {
      name: 'Ich bin Hans. Der Bäcker!',
      job: 'Ich mache Brot. Ich bin Bäcker.',
      lives: 'Hier! Über der Bäckerei.',
      age: 'Ich? Vierzig!',
    },
  },
  {
    id: 'muellerin_greta',
    label: 'Müllerin Greta',
    shortName: 'Greta',
    role: 'Greta, the miller. She walks along the road and asks the player one return question.',
    aliases: ['greta', 'muellerin', 'müllerin', 'miller', 'мельничиха'],
    modelUrl: GASTHAUS_CHARACTER_URLS.oliveCoat,
    voiceId: ELEVENLABS_VOICES.bella,
    color: 0x5d8a55,
    position: new THREE.Vector3(83.0, 4.82, 70.0),
    yaw: Math.PI,
    patrolPoints: [new THREE.Vector3(83.0, 4.82, 70.0), new THREE.Vector3(91.0, 4.82, 61.0)],
    facts: {
      name: 'Greta',
      job: 'Müllerin',
      lives: 'bei der Mühle',
      age: 'dreißig',
    },
    answers: {
      name: 'Ich heiße Greta. Ich arbeite in der Mühle - da! Und du? Was machst du hier?',
      job: 'Ich arbeite in der Mühle. Ich mache Mehl.',
      lives: 'Ich wohne bei der Mühle.',
      age: 'Dreißig. Und immer müde!',
    },
  },
  {
    id: 'lehrerin_ida',
    label: 'Lehrerin Ida',
    shortName: 'Ida',
    role: 'Ida, the village teacher. Gives slightly longer but still A1-level answers.',
    aliases: ['ida', 'lehrerin', 'teacher', 'учительница'],
    modelUrl: GASTHAUS_CHARACTER_URLS.hijabiProfessional,
    voiceId: ELEVENLABS_VOICES.rachel,
    color: 0x6d6fb3,
    position: new THREE.Vector3(45.5, 4.82, 66.5),
    yaw: Math.PI / 2,
    facts: {
      name: 'Ida',
      job: 'Lehrerin',
      lives: 'bei der Schule',
      age: 'achtundzwanzig',
    },
    answers: {
      name: 'Mein Name ist Ida. Ich bin Lehrerin, aber die Schule ist klein - nur sieben Kinder.',
      job: 'Ich bin Lehrerin. Ich arbeite in der Schule.',
      lives: 'Ich wohne bei der Schule, links vom Turm.',
      age: 'Achtundzwanzig. Komm morgen zur Schule!',
    },
  },
];
const QUEST_THREE_SLOT_LABELS = {
  name: 'Name',
  job: 'Beruf',
  lives: 'Wohnt',
};
const QUEST_MARKET_ID = 'der_markt';
const MARKET_LIST_ITEMS = {
  cheese: 'der Käse - 1 Stück',
  eggs: 'die Eier - 6 Stück',
  milk: 'die Milch - 1 Liter',
};
const QUEST_BAKERY_ID = 'in_der_baeckerei';
const MARKET_MERCHANT_NPCS = [
  {
    id: 'kaesehaendler_otto',
    label: 'Käsehändler Otto',
    shortName: 'Otto',
    role: 'Otto, a precise cheese seller. He insists on correct accusative for der Käse before handing it over.',
    modelUrl: GASTHAUS_CHARACTER_URLS.berliner,
    aliases: ['otto', 'kaesehaendler', 'käsehändler', 'kaese', 'käse', 'cheese', 'markt', 'stand'],
    voiceId: ELEVENLABS_VOICES.josh,
    position: new THREE.Vector3(75.4, 4.82, 68.8),
    yaw: 0.2,
  },
  {
    id: 'eierfrau_lena',
    label: 'Eierfrau Lena',
    shortName: 'Lena',
    role: 'Lena, a friendly egg and milk seller. She counts eggs exactly as the player says.',
    modelUrl: GASTHAUS_CHARACTER_URLS.hijabiProfessional,
    aliases: ['lena', 'eierfrau', 'eier', 'ei', 'milch', 'milk', 'eggs', 'markt', 'stand'],
    voiceId: ELEVENLABS_VOICES.rachel,
    position: new THREE.Vector3(77.8, 4.82, 82.2),
    yaw: Math.PI,
  },
  {
    id: 'gemuesehaendlerin_rosa',
    label: 'Gemüsehändlerin Rosa',
    shortName: 'Rosa',
    role: 'Rosa, a vegetable seller. She asks the player to choose red or green tomatoes.',
    modelUrl: GASTHAUS_CHARACTER_URLS.oliveCoat,
    aliases: ['rosa', 'gemuese', 'gemüse', 'tomaten', 'tomate', 'obst', 'markt', 'stand'],
    voiceId: ELEVENLABS_VOICES.charlotte,
    position: new THREE.Vector3(84.0, 4.82, 73.7),
    yaw: -Math.PI / 2,
  },
];
const BAKERY_NPCS = [
  {
    id: 'baeckerei_hans',
    label: 'Bäcker Hans',
    shortName: 'Hans',
    role: 'Hans in his bakery. He teaches A1.1.1 modal brackets: modal in position two, infinitive at the end.',
    aliases: ['hans', 'baecker hans', 'bäcker hans', 'baecker', 'bäcker', 'пекарь'],
    modelUrl: GASTHAUS_CHARACTER_URLS.chef,
    voiceId: ELEVENLABS_VOICES.antoni,
    // Behind the counter, facing the player spawn.
    position: new THREE.Vector3(-0.95, 0.04, 1.971),
    yaw: -2.49,
  },
];
const MARKET_EGG_NUMBERS = new Map([
  ['eins', 1],
  ['ein', 1],
  ['zwei', 2],
  ['drei', 3],
  ['vier', 4],
  ['fuenf', 5],
  ['funf', 5],
  ['sechs', 6],
  ['sieben', 7],
  ['acht', 8],
  ['neun', 9],
  ['zehn', 10],
  ['6', 6],
]);
const GERMAN_NUMBERS = [
  'null',
  'eins',
  'zwei',
  'drei',
  'vier',
  'fünf',
  'sechs',
  'sieben',
  'acht',
  'neun',
  'zehn',
  'elf',
  'zwölf',
  'dreizehn',
  'vierzehn',
  'fünfzehn',
  'sechzehn',
  'siebzehn',
  'achtzehn',
  'neunzehn',
  'zwanzig',
];
const QUEST_GUARD_IDLE_URL = '/Mixamo/glb/Idle%20Default%20beliner.glb';
// Used only when the asset manifest reports no rigged characters. This is still
// a real GLB from /Mixamo/characters, never a generated stand-in.
const QUEST_GUARD_MODEL_DEFAULT_URL =
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
let npcPositionOverrides = loadNpcOverrides();
let npcToolSelectedId = null;
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
const locationState = {
  current: LOCATION_VILLAGE,
  day: 1,
  transitioning: false,
  gasthausLoaded: false,
  gasthausPrompted: false,
  bakeryLoaded: false,
  bakeryPrompted: false,
};
const gasthausQuest = {
  stage: 'idle',
  wallet: 20,
  counter: 0,
  mistakes: 0,
  hasKey: false,
  completed: false,
  menuRead: false,
  joergAnswered: false,
  dorfbuchUnlocked: false,
  openedRooms: new Set(),
};
const questThreeState = {
  unlocked: false,
  active: false,
  completed: false,
  readyForBerta: false,
  bertaRewarded: false,
  gretaAwaitingSelfAnswer: false,
  gretaGreeted: false,
  slots: Object.fromEntries(
    QUEST_THREE_NPCS.map((npc) => [
      npc.id,
      {
        name: false,
        job: false,
        lives: false,
      },
    ]),
  ),
};
const marketQuestState = {
  unlocked: false,
  active: false,
  started: false,
  completed: false,
  rewarded: false,
  mayorLetterReceived: false,
  clarifyCounts: {
    otto: 0,
    lena: 0,
    rosa: 0,
  },
  basket: {
    cheese: false,
    eggs: 0,
    milk: false,
    tomatoes: '',
  },
};
const bakeryQuestState = {
  unlocked: false,
  active: false,
  started: false,
  completed: false,
  apprentice: false,
  stage: 'locked',
  pendingAction: '',
  finalSequenceSpoken: false,
  clarifyCount: 0,
  steps: {
    washHands: false,
    flour: false,
    water: false,
    dough: false,
    permission: false,
    orderFlour: false,
    orderDough: false,
    bread: false,
  },
};
const spokenRussianLessonKeys = new Set();
const RUSSIAN_LESSON_EXPLANATIONS = {
  guardGreeting:
    'Сейчас тренируем приветствие и ответ на вопрос кто ты. Слушай немецкую фразу, потом назови себя: Ich bin плюс имя.',
  guardOrigin:
    'Теперь новый шаг: сказать, откуда ты. Нужная рамка короткая: Ich komme aus плюс место.',
  gasthausIntro:
    'В гостинице мы учимся вежливо просить комнату. Сначала назови себя, потом спроси: Haben Sie ein Zimmer?',
  gasthausRoom:
    'Новый материал: просьба о комнате. Скажи по-немецки: Haben Sie ein Zimmer?',
  gasthausPrice:
    'Теперь спрашиваем цену. Запомни вопрос: Wie viel kostet das Zimmer?',
  gasthausMoney:
    'Сейчас тренируем числа и оплату. Нужно отсчитать двенадцать монет и подтвердить вежливо.',
  gasthausKey:
    'Теперь слушаем номер комнаты. Zimmer drei значит комната три.',
  questThreeIntro:
    'В этом квесте ты заполняешь Dorfbuch. У каждого соседа спроси три W-вопроса: кто, что делает и где живёт.',
  questThreeGretaGreeting:
    'Greta сначала ждёт приветствие. Скажи Hallo или Entschuldigung, только потом задавай вопросы.',
  marketIntro:
    'На рынке тренируем покупки. Сначала возьми список, потом покупай продукты у продавцов.',
  marketAccusative:
    'Новый материал: Akkusativ после kaufen. Der Käse превращается в den Käse.',
  marketCount:
    'Теперь тренируем количество. Для яиц нужно сказать точное число: sechs Eier.',
  marketColor:
    'Теперь тренируем цвета. Выбери цвет помидоров: rote, grüne или gelbe Tomaten.',
  bakeryIntro:
    'В пекарне начинается новый материал: модальные глаголы. Модальный глагол стоит на втором месте, а смысловой глагол уходит в конец.',
  bakeryWash:
    'Первый шаг: Ich muss. Скажи действие рамкой: Ich muss die Hände waschen. Глагол waschen в конце.',
  bakeryFlour:
    'Теперь просьба с können: Ich kann das Mehl holen. Инфинитив holen тоже стоит в конце.',
  bakeryWater:
    'Теперь bringe Wasser. Скажи: Ich muss das Wasser bringen. Смысловой глагол bringen в конце.',
  bakeryPermission:
    'Перед тестом нужно спросить разрешение. Простая фраза: Darf ich?',
  bakeryDough:
    'Теперь снова рамка с muss: Ich muss den Teig kneten. Инфинитив kneten в конце.',
  bakeryFinal:
    'Финал без подсказок: сам собери три модальные фразы в правильном порядке: мука, тесто, хлеб.',
};
let gasthausRoot = null;
let gasthausModel = null;
let gasthausInteractables = new Map();
let bakeryRoot = null;
let bakeryModel = null;

const agent = {
  position: new THREE.Vector3(0, 0, 0),
  yaw: 0,
  eyeHeight: PLAYER_EYE_HEIGHT,
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
  get locationState() {
    return { ...locationState };
  },
  get gasthausQuest() {
    return {
      ...gasthausQuest,
      openedRooms: [...gasthausQuest.openedRooms],
    };
  },
  get questThreeState() {
    return {
      ...questThreeState,
      slots: JSON.parse(JSON.stringify(questThreeState.slots)),
    };
  },
  get marketQuestState() {
    return JSON.parse(JSON.stringify(marketQuestState));
  },
  get characterAnimations() {
    return [...characterAnimations.keys()];
  },
  exportCustomTargets,
  executeCommand,
  unlockGameAudio,
  moveToTarget,
  playCharacterAnimation,
  enterGasthaus,
  leaveGasthaus,
  unlockQuestThree,
  unlockMarketQuest,
};

function setStatus(message, state = 'loading') {
  statusElement.textContent = message;
  statusDot.classList.toggle('ready', state === 'ready');
  statusDot.classList.toggle('error', state === 'error');
  publishDebugState();
}

let sceneHintTimer = null;

// Big centred on-screen prompt (e.g. after finishing the guard quest). Pass
// durationMs = 0 to keep it up until the next call.
function showSceneHint(message, durationMs = 7000) {
  if (!sceneHint) {
    return;
  }

  window.clearTimeout(sceneHintTimer);
  sceneHint.textContent = message;
  sceneHint.hidden = false;
  // Force a reflow so the fade-in transition runs even on rapid re-shows.
  void sceneHint.offsetWidth;
  sceneHint.classList.add('visible');

  if (durationMs > 0) {
    sceneHintTimer = window.setTimeout(hideSceneHint, durationMs);
  }
}

function hideSceneHint() {
  if (!sceneHint) {
    return;
  }

  window.clearTimeout(sceneHintTimer);
  sceneHint.classList.remove('visible');
  sceneHintTimer = window.setTimeout(() => {
    sceneHint.hidden = true;
  }, 340);
}

// --- NPC position overrides + in-game placement tool ---------------------
// Positions tuned with the tool are stored per NPC id in localStorage and
// applied when the NPC is (re)built, so they survive reloads until they get
// baked into the source as defaults.

function loadNpcOverrides() {
  try {
    const value = JSON.parse(localStorage.getItem(NPC_OVERRIDE_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch (error) {
    return {};
  }
}

function saveNpcOverrides() {
  localStorage.setItem(NPC_OVERRIDE_STORAGE_KEY, JSON.stringify(npcPositionOverrides));
}

// Apply a stored override to a freshly-built NPC's root (before grounding).
function applyNpcOverrideToRoot(id, root) {
  const override = npcPositionOverrides[id];

  if (!override) {
    return;
  }

  if (override.position) {
    const x = Number(override.position.x);
    const y = Number(override.position.y);
    const z = Number(override.position.z);

    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      root.position.set(x, y, z);

      // Stale overrides may carry a Y saved by older grounding code and leave
      // the NPC hovering. Keep the tuned X/Z but re-snap the height to the
      // walkable ground (the same level the player walks on, y=5.02 in the
      // village). Interior NPCs sit far from the village navmesh horizontally,
      // so the snap lands elsewhere and is rejected — they keep the stored Y.
      const snapped = navigation?.snapToNavMesh?.(new THREE.Vector3(x, y, z), { allowFallback: false });

      if (snapped && Math.hypot(snapped.x - x, snapped.z - z) <= 2) {
        root.position.y = snapped.y;
      }
    }
  }

  const yaw = Number(override.yaw);

  if (Number.isFinite(yaw)) {
    root.rotation.y = yaw;
  }
}

function hasNpcPlacementOverride(id) {
  const override = npcPositionOverrides[id];
  return Boolean(override?.position || Number.isFinite(Number(override?.yaw)) || override?.locked);
}

function lockNpcPlacement(npc) {
  if (!npc) {
    return;
  }

  npc.manualPlacementLocked = true;
  npc.stationary = true;
  npc.path = [];
  npc.pathIndex = 0;
  npc.waitTimer = 999;
  npc.repathTimer = 0;
  npc.scriptedMovement = false;
  npc.turnTargetYaw = null;
  npc.finalYaw = null;
  npc.patrolPoints = [];
  npc.homeTargetIds = [];

  if (npc.state !== 'talking') {
    npc.state = 'idle';
    playNpcIdle(npc);
  }
}

function applyNpcOverrideToNpc(npc) {
  if (!npc || !hasNpcPlacementOverride(npc.id)) {
    return;
  }

  lockNpcPlacement(npc);
}

function recordNpcOverride(npc) {
  if (!npc?.root) {
    return;
  }

  npcPositionOverrides[npc.id] = {
    position: {
      x: Number(npc.root.position.x.toFixed(3)),
      y: Number(npc.root.position.y.toFixed(3)),
      z: Number(npc.root.position.z.toFixed(3)),
    },
    yaw: Number(npc.root.rotation.y.toFixed(4)),
    locked: true,
  };
  saveNpcOverrides();
}

function regroundNpcAfterMove(npc) {
  if (!npc) {
    return;
  }

  if (npc.seated) {
    groundSeatedNpc(npc);
  } else if (!npc.mixer) {
    npc.visual?.position.setY(0);
  }
  // Rigged standing NPCs re-ground themselves every frame via refitNpcToGround.
}

function npcToolCandidates() {
  return npcs.filter((npc) => isNpcActiveForLocation(npc) && !isQuestGuard(npc));
}

function getNpcToolSelection() {
  return npcToolCandidates().find((npc) => npc.id === npcToolSelectedId) || null;
}

function populateNpcToolSelect() {
  if (!npcToolSelect) {
    return;
  }

  const candidates = npcToolCandidates();
  npcToolSelect.replaceChildren();

  for (const npc of candidates) {
    const option = document.createElement('option');
    option.value = npc.id;
    option.textContent = `${npc.label}${npc.seated ? ' (сидит)' : ''}`;
    npcToolSelect.append(option);
  }

  if (!candidates.some((npc) => npc.id === npcToolSelectedId)) {
    npcToolSelectedId = candidates[0]?.id || null;
  }

  if (npcToolSelectedId) {
    npcToolSelect.value = npcToolSelectedId;
  }

  refreshNpcToolCoords();
}

function refreshNpcToolCoords() {
  if (!npcToolCoords) {
    return;
  }

  const npc = getNpcToolSelection();

  if (!npc) {
    npcToolCoords.textContent = 'Нет персонажей в этой локации';
    return;
  }

  const p = npc.root.position;
  const yawDeg = ((npc.root.rotation.y * 180) / Math.PI).toFixed(0);
  npcToolCoords.textContent =
    `${npc.id}\nx ${p.x.toFixed(2)}  y ${p.y.toFixed(2)}  z ${p.z.toFixed(2)}\nyaw ${yawDeg}°`;
}

function npcToolStep() {
  return Number(npcToolStepInput?.value || 0.2);
}

function moveSelectedNpc(kind) {
  const npc = getNpcToolSelection();

  if (!npc) {
    return;
  }

  const step = npcToolStep();

  switch (kind) {
    case 'x-': npc.root.position.x -= step; break;
    case 'x+': npc.root.position.x += step; break;
    case 'z-': npc.root.position.z -= step; break;
    case 'z+': npc.root.position.z += step; break;
    case 'y-': npc.root.position.y -= step; break;
    case 'y+': npc.root.position.y += step; break;
    case 'yaw-': npc.root.rotation.y -= Math.PI / 12; break;
    case 'yaw+': npc.root.rotation.y += Math.PI / 12; break;
    default: return;
  }

  lockNpcPlacement(npc);
  regroundNpcAfterMove(npc);
  syncNpcTarget(npc);
  recordNpcOverride(npc);
  refreshNpcToolCoords();
  renderTargets();
}

function placeSelectedNpcAt(point) {
  const npc = getNpcToolSelection();

  if (!npc || !point) {
    return false;
  }

  // Only move in the horizontal plane; the click might land on a table, so
  // keep the current height and let the Y± buttons fine-tune it.
  npc.root.position.x = point.x;
  npc.root.position.z = point.z;

  lockNpcPlacement(npc);
  regroundNpcAfterMove(npc);
  syncNpcTarget(npc);
  recordNpcOverride(npc);
  refreshNpcToolCoords();
  renderTargets();
  return true;
}

function isNpcToolOpen() {
  return Boolean(npcToolPanel && !npcToolPanel.hidden);
}

function isNpcToolPlacing() {
  return Boolean(npcToolClickPlace?.checked && isNpcToolOpen() && getNpcToolSelection());
}

function exportNpcPositions() {
  const rows = npcToolCandidates().map((npc) => ({
    id: npc.id,
    position: {
      x: Number(npc.root.position.x.toFixed(3)),
      y: Number(npc.root.position.y.toFixed(3)),
      z: Number(npc.root.position.z.toFixed(3)),
    },
    yaw: Number(npc.root.rotation.y.toFixed(4)),
    location: npc.location || LOCATION_VILLAGE,
  }));

  const json = JSON.stringify(rows, null, 2);

  if (npcToolOutput) {
    npcToolOutput.hidden = false;
    npcToolOutput.value = json;
    npcToolOutput.focus();
    npcToolOutput.select();
  }

  navigator.clipboard?.writeText(json).then(
    () => setStatus('Позиции скопированы в буфер обмена', 'ready'),
    () => setStatus('Позиции в поле ниже — скопируйте вручную', 'ready'),
  );
}

function resetSelectedNpcOverride() {
  const npc = getNpcToolSelection();

  if (!npc) {
    return;
  }

  delete npcPositionOverrides[npc.id];
  saveNpcOverrides();
  setStatus(`Сброшено: ${npc.label}. Перезагрузите страницу, чтобы вернуть дефолт.`, 'ready');
}

function openNpcTool() {
  populateNpcToolSelect();
  setFeaturePanel(npcToolPanel, true);
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

function serializePlainVector(vector) {
  return {
    x: Number(vector.x.toFixed(4)),
    y: Number(vector.y.toFixed(4)),
    z: Number(vector.z.toFixed(4)),
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
    location: {
      current: locationState.current,
      day: locationState.day,
      transitioning: locationState.transitioning,
    },
    quest: {
      enabled: QUEST_ENABLED,
      stage: questState.stage,
      alerted: questState.alerted,
      halted: questState.halted,
      completed: questState.completed,
      playerName: questState.playerName,
      playerOrigin: questState.playerOrigin,
    },
    gasthaus: {
      stage: gasthausQuest.stage,
      wallet: gasthausQuest.wallet,
      counter: gasthausQuest.counter,
      hasKey: gasthausQuest.hasKey,
      completed: gasthausQuest.completed,
      dorfbuchUnlocked: gasthausQuest.dorfbuchUnlocked,
    },
    questThree: {
      unlocked: questThreeState.unlocked,
      active: questThreeState.active,
      completed: questThreeState.completed,
      readyForBerta: questThreeState.readyForBerta,
      bertaRewarded: questThreeState.bertaRewarded,
      slots: questThreeState.slots,
    },
    bakeryQuest: {
      unlocked: bakeryQuestState.unlocked,
      active: bakeryQuestState.active,
      started: bakeryQuestState.started,
      completed: bakeryQuestState.completed,
      apprentice: bakeryQuestState.apprentice,
      stage: bakeryQuestState.stage,
      pendingAction: bakeryQuestState.pendingAction,
      steps: bakeryQuestState.steps,
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
      location: npc.location || LOCATION_VILLAGE,
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

function getRegistryCustomTargets() {
  if (locationState.current !== LOCATION_VILLAGE) {
    return customTargets;
  }

  const storyTargets = [GASTHAUS_ENTRY_TARGET];

  if (bakeryQuestState.unlocked) {
    storyTargets.push(BAKERY_ENTRY_TARGET);
  }

  return [...storyTargets, ...customTargets];
}

function isNpcActiveForLocation(npc) {
  if (npc?.questId === QUEST_THREE_ID && !questThreeState.unlocked) {
    return false;
  }

  if (npc?.questId === QUEST_MARKET_ID && !marketQuestState.unlocked) {
    return false;
  }

  if (npc?.questId === QUEST_BAKERY_ID && !bakeryQuestState.unlocked) {
    return false;
  }

  return !npc?.location || npc.location === locationState.current;
}

function isGasthausNpc(npc) {
  return npc?.location === LOCATION_GASTHAUS;
}

function isBakeryNpc(npc) {
  return npc?.location === LOCATION_BAKERY;
}

function isQuestThreeNpc(npc) {
  return npc?.questId === QUEST_THREE_ID;
}

function isMarketNpc(npc) {
  return npc?.questId === QUEST_MARKET_ID;
}

function isMarketHans(npc) {
  return npc?.id === 'baecker_hans' && marketQuestState.unlocked;
}

function isBakeryHans(npc) {
  return npc?.id === 'baeckerei_hans' && bakeryQuestState.unlocked;
}

function getBerta() {
  return getNpcById('frau_berta');
}

function getBakeryHans() {
  return getNpcById('baeckerei_hans');
}

function getGermanNumber(value) {
  return GERMAN_NUMBERS[value] || String(value);
}

function waitFor(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function updateLocationHud() {
  if (dayLabel) {
    dayLabel.textContent = `Tag ${locationState.day}`;
  }

  if (locationLabel) {
    locationLabel.textContent =
      locationState.current === LOCATION_GASTHAUS
        ? 'Gasthaus Grünbach'
        : locationState.current === LOCATION_BAKERY
          ? 'Bäckerei'
          : 'Dorf Grünbach';
  }

  if (exitLocationButton) {
    exitLocationButton.hidden = locationState.current === LOCATION_VILLAGE;
  }
}

async function runTransition(title, task) {
  if (locationState.transitioning) {
    return;
  }

  locationState.transitioning = true;

  if (transitionTitle) {
    transitionTitle.textContent = title;
  }

  transitionOverlay?.classList.add('active');
  await waitFor(380);

  try {
    await task?.();
  } finally {
    updateLocationHud();
    await waitFor(260);
    transitionOverlay?.classList.remove('active');
    await waitFor(220);
    locationState.transitioning = false;
  }
}

async function showDayTransition(day) {
  await runTransition(`Tag ${day}`, async () => {
    locationState.day = day;
  });
}

function setFeaturePanel(panel, open) {
  if (panel) {
    panel.hidden = !open;
  }
}

function getQuestThreeDefinition(id) {
  return QUEST_THREE_NPCS.find((npc) => npc.id === id) || null;
}

function getQuestThreeProgress() {
  const total = QUEST_THREE_NPCS.length * Object.keys(QUEST_THREE_SLOT_LABELS).length;
  let filled = 0;

  for (const npcDef of QUEST_THREE_NPCS) {
    const slots = questThreeState.slots[npcDef.id] || {};

    for (const slot of Object.keys(QUEST_THREE_SLOT_LABELS)) {
      if (slots[slot]) {
        filled += 1;
      }
    }
  }

  return { filled, total };
}

function isQuestThreeComplete() {
  const progress = getQuestThreeProgress();
  return progress.filled >= progress.total;
}

function getQuestThreeDorfbuchRows(npcDef) {
  const slots = questThreeState.slots[npcDef.id] || {};

  return Object.entries(QUEST_THREE_SLOT_LABELS).map(([slot, label]) => [
    label,
    slots[slot] ? npcDef.facts[slot] : '???',
  ]);
}

function getMarketBasketRows() {
  const eggs = marketQuestState.basket.eggs;

  return [
    ['Auftrag', getMarketObjectiveText()],
    ['Einkaufsliste', 'der K\u00e4se - 1 St\u00fcck | die Eier - 6 St\u00fcck | die Milch - 1 Liter'],
    ['der Käse', marketQuestState.basket.cheese ? 'im Korb' : 'fehlt'],
    ['die Eier', eggs ? `${getGermanNumber(eggs)} Eier` : 'fehlen'],
    ['die Milch', marketQuestState.basket.milk ? 'im Korb' : 'fehlt'],
    ['Rosa', marketQuestState.basket.tomatoes ? `${marketQuestState.basket.tomatoes} Tomaten` : 'Tomaten frei kaufbar'],
  ];
}

function getMayorLetterRows() {
  return [
    ['Gegenstand', 'Brief vom Bürgermeister'],
    ['Warum Markt?', 'Der Bürgermeister braucht Essen für das Dorf.'],
    ['Ziel', 'Finde Hans im Dorfzentrum.'],
  ];
}

function getMarketObjectiveText() {
  if (marketQuestState.completed) {
    return 'Einkauf erledigt. Geh zurück zu Hans.';
  }

  if (marketQuestState.started) {
    return 'Kaufe die Waren auf der Liste.';
  }

  return 'Finde Hans im Dorfzentrum.';
}

function getMarketVocabularyRows() {
  return [
    ['Artikel', 'der -> den, ein -> einen'],
    ['Kaufen', 'ich möchte / ich nehme / ich hätte gern'],
    ['Waren', 'Apfel, Brot, Käse, Wurst, Milch, Ei/Eier, Fisch'],
    ['Farben', 'rot, grün, gelb'],
    ['Mengen', 'ein Kilo, ein Stück, sechs Eier'],
    ['Geld', 'der Euro, die Münze, das macht ...'],
  ];
}

function getBakeryRows() {
  const status = bakeryQuestState.completed
    ? 'Du darfst hier arbeiten.'
    : bakeryQuestState.started
      ? 'Hilf Hans in der Bäckerei.'
      : 'Sprich mit Hans in der Bäckerei.';

  return [
    ['Status', status],
    ['Grammatik', 'Modal auf Position 2, Infinitiv am Ende.'],
    ['Rahmen', 'Ich muss ... waschen / holen / kneten / backen.'],
    ['Wörter', 'helfen, machen, kneten, backen, holen, bringen, waschen'],
    ['Orte', 'der Ofen, der Teig, das Mehl, das Wasser, die Hände'],
  ];
}

function getBakeryStepRows() {
  return [
    ['die Hände waschen', bakeryQuestState.steps.washHands ? 'fertig' : 'offen'],
    ['das Mehl holen', bakeryQuestState.steps.flour ? 'fertig' : 'offen'],
    ['das Wasser bringen', bakeryQuestState.steps.water ? 'fertig' : 'offen'],
    ['den Teig kneten', bakeryQuestState.steps.dough ? 'fertig' : 'offen'],
    ['Brot backen', bakeryQuestState.steps.bread ? 'fertig' : 'offen'],
  ];
}

function renderDorfbuch() {
  if (!dorfbuchContent) {
    return;
  }

  dorfbuchContent.replaceChildren();
  const questThreeProgress = getQuestThreeProgress();

  const cards = [
    {
      title: 'Quest 02: Das Gasthaus',
      rows: [
        ['Grammatik', 'haben: ich habe, Sie haben, du hast'],
        ['Preisfrage', 'Wie viel kostet das Zimmer?'],
        ['Zimmer', gasthausQuest.completed ? 'Zimmer drei ist dein Zimmer.' : 'Noch kein Zimmer.'],
        ['Schlüssel', gasthausQuest.hasKey ? 'der Schlüssel' : 'Noch nicht erhalten.'],
      ],
    },
    {
      title: 'Sprachbuch: Geld',
      rows: [
        ['das Geld', 'деньги'],
        ['die Münze', 'монета'],
        ['zu wenig', gasthausQuest.mistakes > 0 ? 'слишком мало' : 'ещё не открыто'],
        ['zu viel', gasthausQuest.counter > 12 ? 'слишком много' : 'откроется при ошибке'],
      ],
    },
    {
      title: 'Dorfbuch: Nachbarn',
      rows: [
        ['Status', questThreeState.unlocked ? `${questThreeProgress.filled}/${questThreeProgress.total}` : 'Noch nicht erhalten.'],
        ['Aufgabe', questThreeState.unlocked ? 'Frage Hans, Greta und Ida: Wer? Was? Wo?' : 'Berta gibt es dir nach der Nacht.'],
      ],
    },
    ...QUEST_THREE_NPCS.map((npcDef) => ({
      title: npcDef.label,
      rows: questThreeState.unlocked ? getQuestThreeDorfbuchRows(npcDef) : [['Name', '???'], ['Beruf', '???'], ['Wohnt', '???']],
    })),
  ];

  if (marketQuestState.mayorLetterReceived) {
    cards.push({
      title: 'Brief vom Bürgermeister',
      rows: getMayorLetterRows(),
    });
  }

  if (marketQuestState.unlocked) {
    cards.push(
      {
        title: 'Quest 04: Der Markt',
        rows: getMarketBasketRows(),
      },
      {
        title: 'Sprachbuch: Markt',
        rows: getMarketVocabularyRows(),
      },
    );
  }

  if (bakeryQuestState.unlocked) {
    cards.push(
      {
        title: 'Quest 05: In der Bäckerei',
        rows: getBakeryRows(),
      },
      {
        title: 'Bäckerei: Arbeit',
        rows: getBakeryStepRows(),
      },
    );
  }

  for (const card of cards) {
    const element = document.createElement('article');
    element.className = 'dorfbuch-card';

    const title = document.createElement('h3');
    title.textContent = card.title;

    const list = document.createElement('dl');

    for (const [term, value] of card.rows) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      list.append(dt, dd);
    }

    element.append(title, list);
    dorfbuchContent.append(element);
  }
}

function openDorfbuchPanel() {
  renderDorfbuch();
  setFeaturePanel(dorfbuchPanel, true);
}

function renderWallet() {
  if (!coinGame) {
    return;
  }

  if (walletCount) {
    walletCount.textContent = String(gasthausQuest.wallet);
  }

  if (counterCount) {
    counterCount.textContent = String(gasthausQuest.counter);
  }

  if (walletStatus) {
    walletStatus.textContent =
      gasthausQuest.stage === 'count_money'
        ? 'Положите ровно zwölf Münzen на стойку.'
        : 'Кошелёк готов. Berta попросит zwölf Münzen за комнату.';
  }

  coinGame.replaceChildren();

  const totalCoins = gasthausQuest.wallet + gasthausQuest.counter;

  for (let index = 1; index <= totalCoins; index += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `coin-button${index <= gasthausQuest.counter ? ' spent' : ''}`;
    button.textContent = index <= gasthausQuest.counter ? getGermanNumber(index) : 'M';
    button.disabled = index <= gasthausQuest.counter || gasthausQuest.stage !== 'count_money';
    button.addEventListener('click', () => placeGasthausCoin());
    coinGame.append(button);
  }
}

function openWalletPanel() {
  renderWallet();
  setFeaturePanel(walletPanel, true);
}

function resetGasthausCoins() {
  gasthausQuest.wallet += gasthausQuest.counter;
  gasthausQuest.counter = 0;
  renderWallet();
}

function gasthausSetStatus(message) {
  setQuestStatus(`Квест: Das Gasthaus - ${message}`);
}

async function gasthausSpeak(npc, de, ru = '', options = {}) {
  setSelectedNpc(npc, { focusInput: options.focusInput !== false });
  return speakQuestLine(npc, de, ru, {
    intent: options.intent || 'talk',
    append: options.append,
    lesson: options.lesson,
    ruIntro: options.ruIntro,
    skipRuIntro: options.skipRuIntro,
    forceRuIntro: options.forceRuIntro,
    ruVoiceId: options.ruVoiceId,
    ruRate: options.ruRate,
    ruPitch: options.ruPitch,
    ruVolume: options.ruVolume,
  });
}

function gasthausChipsForStage(stage = gasthausQuest.stage) {
  // Dorfbuch is filled and the reward is pending: whatever NPC the player
  // clicked, offer the turn-in phrase so the hand-off to quest 4 can't stall.
  if (questThreeState.readyForBerta && !questThreeState.bertaRewarded) {
    return [
      { label: 'Ich spreche mit Berta', submit: 'Ich spreche mit Berta' },
      { label: 'Dorfbuch', action: 'open-dorfbuch' },
    ];
  }

  if (stage === 'greeting') {
    return [
      { label: 'Guten Tag! Ich bin ___', template: 'Guten Tag! Ich bin ___' },
      { label: 'Ich bin ___', template: 'Ich bin ___' },
      { label: 'Wie bitte?', action: 'repeat' },
      { label: 'Hilfe', action: 'help' },
    ];
  }

  if (stage === 'ask_room') {
    return [
      { label: 'Haben Sie ein Zimmer?', submit: 'Haben Sie ein Zimmer?' },
      { label: 'Ich möchte ein Zimmer', submit: 'Ich möchte ein Zimmer' },
      { label: 'Hilfe', action: 'help' },
    ];
  }

  if (stage === 'negotiate_price') {
    return [
      { label: 'Wie viel kostet das Zimmer?', submit: 'Wie viel kostet das Zimmer?' },
      { label: 'Was kostet das?', submit: 'Was kostet das?' },
      { label: 'Hilfe', action: 'help' },
    ];
  }

  if (stage === 'count_money') {
    return [
      { label: 'Geldbeutel', action: 'open-wallet' },
      { label: 'Zwölf?', action: 'help' },
      { label: 'Bitte', submit: 'Bitte' },
    ];
  }

  if (stage === 'get_key') {
    return [
      { label: 'Tür eins', action: 'room', room: 'eins' },
      { label: 'Tür zwei', action: 'room', room: 'zwei' },
      { label: 'Tür drei', action: 'room', room: 'drei' },
      { label: 'Tür vier', action: 'room', room: 'vier' },
    ];
  }

  if (stage === 'success') {
    return [
      { label: 'Dorfbuch', action: 'open-dorfbuch' },
      { label: 'Wie viele Münzen?', submit: 'Wie viele Münzen hast du?' },
    ];
  }

  return [];
}

function renderGasthausChips() {
  renderQuestChips(gasthausChipsForStage());
}

function parseGasthausRoomRequest(input) {
  const text = normalizeText(input);
  return (
    /(?:haben sie|hast du).*(?:zimmer)/.test(text) ||
    /(?:ich )?(?:brauche|moechte|mochte).*(?:zimmer)/.test(text) ||
    /^zimmer\??$/.test(text)
  );
}

function parseGasthausPriceQuestion(input) {
  const text = normalizeText(input);
  return (
    /(?:wie viel|wieviel|was).*(?:kostet|kosten)/.test(text) ||
    /(?:kostet|kosten).*(?:zimmer|das)/.test(text) ||
    /(?:preis|teuer|billig)/.test(text)
  );
}

async function placeGasthausCoin() {
  const berta = getBerta();

  if (!berta || gasthausQuest.stage !== 'count_money' || gasthausQuest.wallet <= 0) {
    return;
  }

  gasthausQuest.wallet -= 1;
  gasthausQuest.counter += 1;
  renderWallet();
  await gasthausSpeak(berta, `${getGermanNumber(gasthausQuest.counter)}!`, '', {
    append: false,
    intent: 'counting',
    focusInput: false,
  });
}

async function submitGasthausPayment() {
  const berta = getBerta();

  if (!berta || gasthausQuest.stage !== 'count_money') {
    return;
  }

  if (gasthausQuest.counter === 12) {
    gasthausQuest.stage = 'get_key';
    gasthausQuest.hasKey = true;
    renderGasthausChips();
    renderWallet();
    await gasthausSpeak(
      berta,
      'Zwölf! Perfekt! Hier - der Schlüssel! Zimmer drei. Oben.',
      'Двенадцать! Отлично! Вот ключ. Комната три. Наверху.',
      { intent: 'happy', lesson: 'gasthausKey' },
    );
    return;
  }

  gasthausQuest.mistakes += 1;

  if (gasthausQuest.counter < 12) {
    await gasthausSpeak(
      berta,
      'Nein, nein. Das ist zu wenig. Zwölf!',
      'Нет-нет. Слишком мало. Двенадцать!',
      { intent: 'thinking' },
    );
  } else {
    const extra = gasthausQuest.counter - 12;
    gasthausQuest.wallet += extra;
    gasthausQuest.counter = 12;
    await gasthausSpeak(
      berta,
      'Halt! Zu viel! Zurück.',
      'Стоп! Слишком много! Возьми лишнее назад.',
      { intent: 'thinking' },
    );
  }

  if (gasthausQuest.mistakes >= 3) {
    openDorfbuchPanel();
  }

  renderWallet();
}

async function handleGasthausRoom(word) {
  const berta = getBerta();

  if (!berta) {
    return;
  }

  gasthausQuest.openedRooms.add(word);

  if (!gasthausQuest.hasKey) {
    await gasthausSpeak(berta, 'Erst der Schlüssel, bitte.', 'Сначала ключ, пожалуйста.');
    return;
  }

  if (word !== 'drei') {
    await gasthausSpeak(berta, `Nein, ${word} ist zu. Zimmer drei!`, `Нет, ${word} закрыта. Комната три!`, {
      intent: 'thinking',
    });
    return;
  }

  gasthausQuest.completed = true;
  gasthausQuest.stage = 'success';
  gasthausQuest.dorfbuchUnlocked = true;
  renderGasthausChips();
  renderDorfbuch();
  await gasthausSpeak(
    berta,
    'Sehr gut. Schlaf gut! Morgen bekommst du das Dorfbuch.',
    'Очень хорошо. Спокойной ночи! Завтра ты получишь Dorfbuch.',
    { intent: 'happy' },
  );
  await showDayTransition(Math.max(locationState.day + 1, 2));
  unlockQuestThree();
  await gasthausSpeak(
    berta,
    'Guten Morgen! Hier - dein Dorfbuch. Geh raus, sprich mit den Leuten!',
    'Доброе утро! Вот твоя деревенская книга. Выйди и поговори с людьми!',
    { intent: 'happy', lesson: 'questThreeIntro' },
  );
}

function showGasthausHelp() {
  const berta = getBerta();

  if (!berta) {
    return;
  }

  if (gasthausQuest.stage === 'count_money') {
    gasthausSpeak(berta, 'Zwölf. Eins, zwei, drei... zwölf!', 'Двенадцать. Раз, два, три... двенадцать!', {
      intent: 'helpful',
    });
    openWalletPanel();
    return;
  }

  if (gasthausQuest.stage === 'ask_room') {
    gasthausSpeak(berta, 'Sag: Haben Sie ein Zimmer?', 'Скажи: У вас есть комната?', {
      intent: 'helpful',
    });
    return;
  }

  if (gasthausQuest.stage === 'negotiate_price') {
    gasthausSpeak(berta, 'Frag: Wie viel kostet das Zimmer?', 'Спроси: Сколько стоит комната?', {
      intent: 'helpful',
    });
    return;
  }

  gasthausSpeak(berta, 'Langsam: Ich bin Kirill.', 'Медленно: Я Кирилл.', { intent: 'helpful' });
}

async function openGasthausQuestDialogue() {
  const berta = getBerta();

  if (!berta) {
    return;
  }

  if (await finishQuestThreeWithBerta(berta)) {
    return;
  }

  if (gasthausQuest.completed && questThreeState.unlocked && !questThreeState.completed) {
    gasthausQuest.stage = 'success';
    gasthausSetStatus('Dorfbuch: спросите соседей');
    renderGasthausChips();
    await gasthausSpeak(
      berta,
      'Geh raus, sprich mit Hans, Greta und Ida. Frag: Wer? Was? Wo?',
      'Выйди и поговори с Hans, Greta и Ida. Спроси: Wer? Was? Wo?',
      { intent: 'helpful', lesson: 'questThreeIntro' },
    );
    return;
  }

  if (gasthausQuest.completed) {
    gasthausQuest.stage = 'success';
    gasthausSetStatus('Dorfbuch открыт');
    renderGasthausChips();
    await gasthausSpeak(berta, 'Wie viele Münzen hast du?', 'Сколько у тебя монет?', { intent: 'greeting' });
    return;
  }

  if (gasthausQuest.stage === 'idle') {
    gasthausQuest.stage = 'greeting';
  }

  renderGasthausChips();

  if (gasthausQuest.stage === 'ask_room') {
    gasthausSetStatus('попросите комнату');
    await gasthausSpeak(
      berta,
      `So, ${questState.playerName || 'Gast'}. Was brauchst du?`,
      `Так, ${questState.playerName || 'гость'}. Что тебе нужно?`,
      { intent: 'thinking', lesson: 'gasthausRoom' },
    );
    return;
  }

  if (gasthausQuest.stage === 'negotiate_price') {
    gasthausSetStatus('спросите цену');
    await gasthausSpeak(berta, 'Klein, aber gut. Was möchtest du wissen?', 'Маленькая, но хорошая. Что хочешь узнать?', {
      intent: 'thinking',
      lesson: 'gasthausPrice',
    });
    return;
  }

  if (gasthausQuest.stage === 'count_money') {
    gasthausSetStatus('отсчитайте 12 монет');
    openWalletPanel();
    await gasthausSpeak(berta, 'Eine Nacht - zwölf Münzen.', 'Одна ночь - двенадцать монет.', {
      intent: 'counting',
      lesson: 'gasthausMoney',
    });
    return;
  }

  if (gasthausQuest.stage === 'get_key') {
    gasthausSetStatus('найдите Zimmer drei');
    await gasthausSpeak(berta, 'Zimmer drei. Oben.', 'Комната три. Наверху.', { intent: 'helpful', lesson: 'gasthausKey' });
    return;
  }

  gasthausSetStatus('Frau Berta ждёт имя');
  await gasthausSpeak(
    berta,
    'Oh, ein Gast! Guten Tag! Ich bin Berta. Und du bist...?',
    'О, гость! Добрый день! Я Берта. А ты...?',
    { intent: 'greeting', lesson: 'gasthausIntro' },
  );
}

async function sendGasthausDialogueToNpc(npc, message) {
  const line = String(message || '').trim();

  if (!line) {
    return;
  }

  await unlockGameAudio({ showStatus: true });
  setSelectedNpc(npc);
  appendDialogue(npc, 'player', line);
  dialogueInput.value = '';
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  // "Ich spreche mit Berta" always routes to the innkeeper, no matter which
  // tavern NPC is selected — clicking near the bar often picks a guest, and
  // the Dorfbuch turn-in (hand-off to quest 4) must not stall on that.
  if (/sprech\w*\s+mit\s+(frau\s+)?berta/i.test(line)) {
    const berta = bertaOrNpc(npc);

    if (await finishQuestThreeWithBerta(berta)) {
      return;
    }

    if (questThreeState.bertaRewarded) {
      await gasthausSpeak(
        berta,
        'Du hast den Brief! Geh zum Markt. Finde Hans im Dorfzentrum.',
        'Письмо уже у тебя! Иди на рынок и найди Hans в центре деревни.',
        { intent: 'helpful' },
      );
      return;
    }

    if (questThreeState.unlocked && !questThreeState.completed) {
      await gasthausSpeak(
        berta,
        'Erst das Dorfbuch! Sprich mit Hans, Greta und Ida.',
        'Сначала Dorfbuch! Поговори с Hans, Greta и Ida.',
        { intent: 'helpful' },
      );
      return;
    }
  }

  // Any tavern guest other than the innkeeper just makes small talk; only Berta
  // drives the room-booking quest below.
  if (npc.id !== 'frau_berta') {
    const happy = /^ja\b/i.test(line);

    if (npc.id === 'gast_joerg') {
      gasthausQuest.joergAnswered = true;
      renderDorfbuch();
    }

    const de =
      npc.id === 'gast_hans'
        ? happy
          ? 'Ja! Gutes Brot, gutes Bier. Prost!'
          : 'Kein Problem. Setz dich, trink was! Prost!'
        : happy
        ? 'Ja! Schönes Dorf. Prost!'
        : 'Nein? Trotzdem: Prost!';

    await gasthausSpeak(npc, de, '', { intent: 'happy' });
    return;
  }

  // Talking to Berta with a completed Dorfbuch finishes quest 3 regardless of
  // the exact wording, mirroring the click-to-talk flow.
  if (await finishQuestThreeWithBerta(npc)) {
    return;
  }

  if (/^(hilfe|help|помощь)$/i.test(line)) {
    showGasthausHelp();
    return;
  }

  if (/^wie bitte\??$/i.test(line)) {
    repeatQuestPrompt();
    return;
  }

  if (gasthausQuest.stage === 'greeting') {
    const parsed = parseQuestName(line);

    if (!parsed) {
      showGasthausHelp();
      return;
    }

    questState.playerName = questState.playerName || parsed.value;
    gasthausQuest.stage = 'ask_room';
    gasthausSetStatus('попросите комнату');
    renderGasthausChips();
    await gasthausSpeak(bertaOrNpc(npc), `So, ${parsed.value}. Was brauchst du?`, `Так, ${parsed.value}. Что тебе нужно?`, {
      intent: 'thinking',
      lesson: 'gasthausRoom',
    });
    return;
  }

  if (gasthausQuest.stage === 'ask_room') {
    if (!parseGasthausRoomRequest(line)) {
      showGasthausHelp();
      return;
    }

    gasthausQuest.stage = 'negotiate_price';
    gasthausSetStatus('спросите цену');
    renderGasthausChips();
    await gasthausSpeak(
      npc,
      'Ein Zimmer? Ja! Ich habe ein Zimmer. Klein, aber gut!',
      'Комната? Да! У меня есть комната. Маленькая, но хорошая!',
      { intent: 'happy', lesson: 'gasthausPrice' },
    );
    return;
  }

  if (gasthausQuest.stage === 'negotiate_price') {
    if (!parseGasthausPriceQuestion(line)) {
      showGasthausHelp();
      return;
    }

    gasthausQuest.stage = 'count_money';
    gasthausSetStatus('отсчитайте 12 монет');
    renderGasthausChips();
    openWalletPanel();
    await gasthausSpeak(npc, 'Eine Nacht - zwölf Münzen.', 'Одна ночь - двенадцать монет.', {
      intent: 'counting',
      lesson: 'gasthausMoney',
    });
    return;
  }

  if (gasthausQuest.stage === 'count_money') {
    if (/bitte|danke/i.test(line)) {
      await submitGasthausPayment();
      return;
    }

    openWalletPanel();
    await gasthausSpeak(npc, 'Leg die Münzen auf die Theke. Zwölf!', 'Положи монеты на стойку. Двенадцать!', {
      intent: 'helpful',
    });
    return;
  }

  if (gasthausQuest.stage === 'get_key') {
    const normalized = normalizeText(line);
    const room = GASTHAUS_DOOR_TARGETS.find((target) => normalized.includes(normalizeText(target.word)));

    if (room) {
      await handleGasthausRoom(room.word);
      return;
    }

    await gasthausSpeak(npc, 'Zimmer drei. Oben.', 'Комната три. Наверху.', { intent: 'helpful', lesson: 'gasthausKey' });
    return;
  }

  await gasthausSpeak(npc, 'Gut. Willkommen im Gasthaus!', 'Хорошо. Добро пожаловать в Gasthaus!', {
    intent: 'happy',
  });
}

function bertaOrNpc(npc) {
  return getBerta() || npc;
}

function setQuestThreeStatus(message) {
  setQuestStatus(`Квест: Drei Nachbarn - ${message}`);
}

function unlockQuestThree() {
  if (questThreeState.unlocked) {
    return;
  }

  questThreeState.unlocked = true;
  questThreeState.active = true;
  gasthausQuest.dorfbuchUnlocked = true;
  ensureQuestThreeNpcs().catch((error) => {
    console.error('Quest characters failed to load:', error);
  });
  renderDorfbuch();
  setQuestThreeStatus('заполните Dorfbuch');
}

function unlockMarketQuest() {
  if (marketQuestState.unlocked) {
    return;
  }

  marketQuestState.mayorLetterReceived = true;
  marketQuestState.unlocked = true;
  marketQuestState.active = true;
  marketQuestState.started = false;
  gasthausQuest.dorfbuchUnlocked = true;
  ensureQuestThreeNpcs()
    .then(() => ensureMarketNpcs())
    .catch((error) => {
      console.error('Market quest characters failed to load:', error);
    });
  renderDorfbuch();
  renderTargets();
  setMarketStatus('finde Hans im Dorfzentrum');
}

function setBakeryStatus(message) {
  setQuestStatus(`Quest: In der Bäckerei - ${message}`);
}

function unlockBakeryQuest() {
  if (bakeryQuestState.unlocked) {
    return;
  }

  bakeryQuestState.unlocked = true;
  bakeryQuestState.active = true;
  bakeryQuestState.stage = 'offer';
  ensureBakeryLoaded().catch((error) => {
    console.error('Bakery quest failed to load:', error);
  });
  rebuildRegistryFromCustomTargets();
  renderDorfbuch();
  renderTargets();
  setBakeryStatus('finde Hans in der Bäckerei');
}

function questThreeChipsForNpc(npc) {
  if (!npc || !isQuestThreeNpc(npc)) {
    return [];
  }

  if (npc.id === 'muellerin_greta' && !questThreeState.gretaGreeted) {
    return [
      { label: 'Hallo!', submit: 'Hallo!' },
      { label: 'Entschuldigung!', submit: 'Entschuldigung!' },
      { label: 'Dorfbuch', action: 'open-dorfbuch' },
    ];
  }

  if (npc.id === 'muellerin_greta' && questThreeState.gretaAwaitingSelfAnswer) {
    return [
      { label: 'Ich bin neu hier', submit: 'Ich bin neu hier' },
      { label: 'Ich spreche mit den Leuten', submit: 'Ich spreche mit den Leuten' },
      { label: 'Dorfbuch', action: 'open-dorfbuch' },
    ];
  }

  return [
    { label: 'Wer bist du?', submit: 'Wer bist du?' },
    { label: 'Was machst du?', submit: 'Was machst du?' },
    { label: 'Wo wohnst du?', submit: 'Wo wohnst du?' },
    { label: 'Dorfbuch', action: 'open-dorfbuch' },
  ];
}

function renderQuestThreeChips(npc = selectedNpc) {
  renderQuestChips(questThreeChipsForNpc(npc));
}

function setMarketStatus(message) {
  setQuestStatus(`Quest: Der Markt - ${message}`);
}

function getMarketListText() {
  return 'Einkaufsliste: der K\u00e4se - 1 St\u00fcck; die Eier - 6 St\u00fcck; die Milch - 1 Liter.';
}

function marketHasListItem(item) {
  if (item === 'cheese') {
    return marketQuestState.basket.cheese;
  }

  if (item === 'eggs') {
    return marketQuestState.basket.eggs === 6;
  }

  if (item === 'milk') {
    return marketQuestState.basket.milk;
  }

  return false;
}

function getMarketMissingItem() {
  if (!marketHasListItem('cheese')) {
    return {
      key: 'cheese',
      de: 'Der Käse fehlt. Geh zu Otto und sag: Ich möchte den Käse.',
    };
  }

  if (!marketHasListItem('eggs')) {
    const eggs = marketQuestState.basket.eggs;
    return {
      key: 'eggs',
      de: eggs
        ? `Hans zaehlt genau: sechs Eier, nicht ${getGermanNumber(eggs)}. Geh noch einmal zu Lena.`
        : 'Die Eier fehlen. Geh zu Lena und sag: Sechs Eier, bitte.',
    };
  }

  if (!marketHasListItem('milk')) {
    return {
      key: 'milk',
      de: 'Die Milch fehlt. Geh zu Lena und sag: Ich nehme die Milch.',
    };
  }

  return null;
}

function isMarketBasketComplete() {
  return !getMarketMissingItem();
}

function marketBasketSummary() {
  const cheese = marketQuestState.basket.cheese ? 'Käse: ja' : 'Käse: fehlt';
  const eggs = marketQuestState.basket.eggs ? `Eier: ${getGermanNumber(marketQuestState.basket.eggs)}` : 'Eier: fehlen';
  const milk = marketQuestState.basket.milk ? 'Milch: ja' : 'Milch: fehlt';
  const tomatoes = marketQuestState.basket.tomatoes ? `Tomaten: ${marketQuestState.basket.tomatoes}` : 'Tomaten: frei';
  return `${cheese}; ${eggs}; ${milk}; ${tomatoes}.`;
}

function marketChipsForNpc(npc) {
  if (isMarketHans(npc)) {
    if (marketQuestState.completed) {
      return [
        { label: 'Danke, Hans', submit: 'Danke' },
        { label: 'Dorfbuch', action: 'open-dorfbuch' },
      ];
    }

    return [
      { label: 'Einkaufsliste', action: 'market-list' },
      { label: 'Ich habe alles', submit: 'Ich habe alles' },
      { label: 'Dorfbuch', action: 'open-dorfbuch' },
    ];
  }

  if (!isMarketNpc(npc)) {
    return [];
  }

  if (npc.id === 'kaesehaendler_otto') {
    return [
      { label: 'Ich möchte den Käse', submit: 'Ich möchte den Käse' },
      { label: 'Ich nehme einen Käse', submit: 'Ich nehme einen Käse' },
      { label: 'Hilfe', action: 'market-help' },
    ];
  }

  if (npc.id === 'eierfrau_lena') {
    return [
      { label: 'Sechs Eier, bitte', submit: 'Sechs Eier, bitte' },
      { label: 'Ich nehme die Milch', submit: 'Ich nehme die Milch' },
      { label: 'Hilfe', action: 'market-help' },
    ];
  }

  if (npc.id === 'gemuesehaendlerin_rosa') {
    return [
      { label: 'Die roten Tomaten', submit: 'Die roten Tomaten, bitte' },
      { label: 'Die grünen Tomaten', submit: 'Die grünen Tomaten, bitte' },
      { label: 'Hilfe', action: 'market-help' },
    ];
  }

  return [];
}

function renderMarketChips(npc = selectedNpc) {
  renderQuestChips(marketChipsForNpc(npc));
}

async function marketSpeak(npc, de, ru = '', options = {}) {
  setSelectedNpc(npc, { focusInput: options.focusInput !== false });
  renderMarketChips(npc);
  return speakQuestLine(npc, de, ru, {
    intent: options.intent || 'talk',
    append: options.append,
    lesson: options.lesson,
    ruIntro: options.ruIntro,
    skipRuIntro: options.skipRuIntro,
    forceRuIntro: options.forceRuIntro,
    ruVoiceId: options.ruVoiceId,
    ruRate: options.ruRate,
    ruPitch: options.ruPitch,
    ruVolume: options.ruVolume,
  });
}

function showMarketHelp(npc = selectedNpc) {
  if (!npc) {
    return;
  }

  if (isMarketHans(npc)) {
    marketSpeak(npc, `${getMarketListText()} Zeig mir danach den Korb.`, marketBasketSummary(), {
      intent: 'helpful',
    });
    return;
  }

  if (npc.id === 'kaesehaendler_otto') {
    marketSpeak(npc, 'Bei Otto: der Käse wird im Akkusativ DEN Käse.', 'Say: Ich möchte den Käse.', {
      intent: 'helpful',
    });
    return;
  }

  if (npc.id === 'eierfrau_lena') {
    marketSpeak(npc, 'Bei Lena: Sag die genaue Zahl. Sechs Eier, bitte. Und: die Milch.', 'Hans braucht 6 eggs and milk.', {
      intent: 'helpful',
    });
    return;
  }

  if (npc.id === 'gemuesehaendlerin_rosa') {
    marketSpeak(npc, 'Bei Rosa: Wähle eine Farbe. Die roten Tomaten oder die grünen Tomaten.', 'Choose red or green tomatoes.', {
      intent: 'helpful',
    });
  }
}

function showMarketList(npc = selectedNpc) {
  if (!npc) {
    openDorfbuchPanel();
    return;
  }

  openDorfbuchPanel();
  marketSpeak(npc, getMarketListText(), marketBasketSummary(), {
    intent: 'helpful',
  });
}

function marketTextIncludes(text, tokens) {
  return tokens.some((token) => text.includes(token));
}

function marketWantsCheese(text) {
  return marketTextIncludes(text, ['kase', 'kaese', 'cheese']);
}

function marketWantsEggs(text) {
  return /\b(?:ei|eier|egg|eggs)\b/.test(text);
}

function marketWantsMilk(text) {
  return /\b(?:milch|milk)\b/.test(text);
}

function marketWantsTomatoes(text) {
  return /\b(?:tomate|tomaten|tomato|tomatoes)\b/.test(text);
}

function getMarketEggCount(input) {
  const text = normalizeText(input);
  const digit = text.match(/\b([1-9]|10)\b/);

  if (digit) {
    return Number(digit[1]);
  }

  for (const [word, value] of MARKET_EGG_NUMBERS) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      return value;
    }
  }

  return 0;
}

function getMarketTomatoColor(input) {
  const text = normalizeText(input);

  if (/\b(?:rot|rote|roten|red)\b/.test(text)) {
    return 'rote';
  }

  if (/\b(?:grun|gruen|grune|gruene|grunen|gruenen|green)\b/.test(text)) {
    return 'grüne';
  }

  if (/\b(?:gelb|gelbe|gelben|yellow)\b/.test(text)) {
    return 'gelbe';
  }

  return '';
}

async function completeMarketQuest(npc) {
  marketQuestState.completed = true;
  marketQuestState.active = false;

  if (!marketQuestState.rewarded) {
    marketQuestState.rewarded = true;
    gasthausQuest.wallet += 2;
    renderWallet();
  }

  renderDorfbuch();
  renderMarketChips(npc);
  setMarketStatus('abgeschlossen');
  await marketSpeak(
    npc,
    'Alles da: den Käse, sechs Eier und die Milch. Sehr gut! Hier sind zwei Münzen. Willst du helfen? Komm in die Bäckerei. Ich zeige dir alles!',
    'Quest 04 geschafft. Reward: +2 coins. Hans зовёт в пекарню.',
    { intent: 'happy' },
  );
  unlockBakeryQuest();
  showSceneHint('Quest 05: In der Bäckerei. Geh zu Hans in die Bäckerei.', 9000);
}

async function openMarketHansDialogue(npc) {
  if (!npc) {
    return;
  }

  await unlockGameAudio({ showStatus: true });
  setSelectedNpc(npc, { focusInput: true });
  renderMarketChips(npc);
  npc.path = [];
  npc.pathIndex = 0;
  npc.state = 'idle';
  npc.waitTimer = 1.4;
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  if (!marketQuestState.started) {
    marketQuestState.started = true;
    marketQuestState.active = true;
    renderDorfbuch();
    setMarketStatus('kaufe die Liste');
    await marketSpeak(
      npc,
      `Geh bitte zum Markt. ${getMarketListText()} Otto hat Käse, Lena hat Eier und Milch, Rosa hat Gemüse.`,
      'Buy the shopping list in the village market.',
      { append: false, intent: 'helpful', lesson: 'marketIntro' },
    );
    return;
  }

  if (marketQuestState.completed) {
    if (!bakeryQuestState.unlocked) {
      unlockBakeryQuest();
    }

    await marketSpeak(npc, 'Der Einkauf war gut. Danke! Komm in die Bäckerei. Ich zeige dir alles.', 'Market quest already finished. Bakery unlocked.', {
      append: false,
      intent: 'happy',
    });
    return;
  }

  if (isMarketBasketComplete()) {
    await completeMarketQuest(npc);
    return;
  }

  const missing = getMarketMissingItem();
  setMarketStatus('Korb prüfen');
  await marketSpeak(npc, `${missing.de} ${getMarketListText()}`, marketBasketSummary(), {
    append: false,
    intent: 'helpful',
  });
}

async function sendMarketHansDialogueToNpc(npc, message) {
  const line = String(message || '').trim();

  if (!line) {
    return;
  }

  await unlockGameAudio({ showStatus: true });
  setSelectedNpc(npc);
  appendDialogue(npc, 'player', line);
  dialogueInput.value = '';
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  const text = normalizeText(line);

  if (/(liste|einkauf|was brauche|brauchst du|was soll ich|korb|dorfbuch)/.test(text)) {
    showMarketList(npc);
    return;
  }

  if (isMarketBasketComplete()) {
    await completeMarketQuest(npc);
    return;
  }

  const missing = getMarketMissingItem();
  setMarketStatus('noch nicht fertig');
  await marketSpeak(npc, `${missing.de} ${getMarketListText()}`, marketBasketSummary(), {
    intent: 'helpful',
  });
}

function bakeryChipsForStage() {
  if (!bakeryQuestState.unlocked) {
    return [];
  }

  if (bakeryQuestState.completed) {
    return [
      { label: 'Danke, Hans', submit: 'Danke, Hans' },
      { label: 'Dorfbuch', action: 'open-dorfbuch' },
    ];
  }

  if (bakeryQuestState.stage === 'offer') {
    return [
      { label: 'Ich will helfen', submit: 'Ich will helfen' },
      { label: 'Ich kann helfen', submit: 'Ich kann helfen' },
      { label: 'Dorfbuch', action: 'open-dorfbuch' },
    ];
  }

  if (bakeryQuestState.stage === 'wash_phrase') {
    return [
      { label: 'Ich muss die Hände waschen', submit: 'Ich muss die Hände waschen' },
      { label: 'Hilfe', action: 'bakery-help' },
    ];
  }

  if (bakeryQuestState.stage === 'flour_phrase') {
    return [
      { label: 'Ich kann das Mehl holen', submit: 'Ich kann das Mehl holen' },
      { label: 'Ich muss das Mehl holen', submit: 'Ich muss das Mehl holen' },
      { label: 'Hilfe', action: 'bakery-help' },
    ];
  }

  if (bakeryQuestState.stage === 'water_phrase') {
    return [
      { label: 'Ich muss das Wasser bringen', submit: 'Ich muss das Wasser bringen' },
      { label: 'Hilfe', action: 'bakery-help' },
    ];
  }

  if (bakeryQuestState.stage === 'permission') {
    return [
      { label: 'Darf ich?', submit: 'Darf ich?' },
      { label: 'Darf ich den Teig kneten?', submit: 'Darf ich den Teig kneten?' },
      { label: 'Hilfe', action: 'bakery-help' },
    ];
  }

  if (bakeryQuestState.stage === 'dough_phrase') {
    return [
      { label: 'Ich muss den Teig kneten', submit: 'Ich muss den Teig kneten' },
      { label: 'Hilfe', action: 'bakery-help' },
    ];
  }

  return [
    { label: 'Hilfe', action: 'bakery-help' },
    { label: 'Dorfbuch', action: 'open-dorfbuch' },
  ];
}

function renderBakeryChips() {
  renderQuestChips(bakeryChipsForStage());
}

async function bakerySpeak(npc, de, ru = '', options = {}) {
  const targetNpc = npc || getBakeryHans();

  if (!targetNpc) {
    return 0;
  }

  setSelectedNpc(targetNpc, { focusInput: options.focusInput !== false });
  renderBakeryChips();
  return speakQuestLine(targetNpc, de, ru, {
    intent: options.intent || 'talk',
    append: options.append,
    lesson: options.lesson,
    ruIntro: options.ruIntro,
    skipRuIntro: options.skipRuIntro,
    forceRuIntro: options.forceRuIntro,
    ruVoiceId: options.ruVoiceId,
    ruRate: options.ruRate,
    ruPitch: options.ruPitch,
    ruVolume: options.ruVolume,
  });
}

function bakeryHasCorrectModal(text, modal, objectPattern, verb) {
  const normalized = normalizeText(text);
  const object = objectPattern.source;
  return new RegExp(`\\bich\\s+${modal}\\s+.*(?:${object}).*\\s+${verb}\\b$`).test(normalized);
}

function bakeryHasMisplacedInfinitive(text, modal, verb) {
  return new RegExp(`\\bich\\s+${modal}\\s+${verb}\\s+`).test(normalizeText(text));
}

function parseBakeryFinalSequence(input) {
  const text = normalizeText(input);
  const flour = text.indexOf('ich muss das mehl holen');
  const dough = Math.max(text.indexOf('ich muss den teig kneten'), text.indexOf('ich muss das teig kneten'));
  const bread = Math.max(text.indexOf('ich will brot backen'), text.indexOf('ich will das brot backen'));

  return {
    complete: flour >= 0 && dough > flour && bread > dough,
    flourOnly: flour >= 0,
    doughOnly: dough >= 0,
    breadOnly: bread >= 0,
    misplaced:
      /ich muss holen .*mehl/.test(text) ||
      /ich muss kneten .*teig/.test(text) ||
      /ich will backen .*brot/.test(text),
  };
}

async function bakeryClarifyWordOrder(npc, objectText, verb) {
  bakeryQuestState.clarifyCount += 1;
  await bakerySpeak(
    npc,
    `Hm? ${objectText} ${verb} - das Verb kommt ans Ende. Noch mal.`,
    'Порядок слов: инфинитив в конец.',
    { intent: 'thinking' },
  );
}

async function showBakeryHelp(npc = getBakeryHans()) {
  const stage = bakeryQuestState.stage;

  if (stage === 'wash_phrase') {
    await bakerySpeak(npc, 'Sag: Ich muss die Hände waschen.', 'Скажи: Ich muss die Hände waschen.', {
      intent: 'helpful',
      lesson: 'bakeryWash',
    });
    return;
  }

  if (stage === 'flour_phrase') {
    await bakerySpeak(npc, 'Sag: Ich kann das Mehl holen. Verb am Ende.', 'Скажи: Ich kann das Mehl holen.', {
      intent: 'helpful',
      lesson: 'bakeryFlour',
    });
    return;
  }

  if (stage === 'permission') {
    await bakerySpeak(npc, 'Frag zuerst: Darf ich? Dann darfst du den Teig kneten.', 'Сначала спроси разрешение.', {
      intent: 'helpful',
      lesson: 'bakeryPermission',
    });
    return;
  }

  if (stage === 'water_phrase') {
    await bakerySpeak(npc, 'Sag: Ich muss das Wasser bringen. Verb am Ende.', 'Скажи: Ich muss das Wasser bringen.', {
      intent: 'helpful',
      lesson: 'bakeryWater',
    });
    return;
  }

  if (stage === 'dough_phrase') {
    await bakerySpeak(npc, 'Sag: Ich muss den Teig kneten. Verb am Ende.', 'Скажи: Ich muss den Teig kneten.', {
      intent: 'helpful',
      lesson: 'bakeryDough',
    });
    return;
  }

  if (stage === 'free_sequence' || stage === 'order_dough_phrase' || stage === 'bake_phrase') {
    await bakerySpeak(
      npc,
      'Ohne Chips: Ich muss das Mehl holen. Ich muss den Teig kneten. Ich will Brot backen.',
      'Финальная последовательность без chips.',
      { intent: 'helpful', lesson: 'bakeryFinal' },
    );
    return;
  }

  await bakerySpeak(npc, 'Modal auf Platz zwei. Das zweite Verb kommt ans Ende.', 'Modal на втором месте, инфинитив в конце.', {
    intent: 'helpful',
  });
}

async function startBakeryQuest(npc) {
  bakeryQuestState.started = true;
  bakeryQuestState.active = true;
  bakeryQuestState.stage = 'wash_phrase';
  bakeryQuestState.pendingAction = '';
  renderDorfbuch();
  setBakeryStatus('Hände waschen');
  await bakerySpeak(
    npc,
    'Zuerst - die Hände waschen! Was musst du machen?',
    'Сначала вымыть руки. Ответь модальной рамкой.',
    { intent: 'helpful', lesson: 'bakeryWash' },
  );
}

async function openBakeryDialogue(npc = getBakeryHans()) {
  if (!npc) {
    return;
  }

  await unlockGameAudio({ showStatus: true });
  setSelectedNpc(npc, { focusInput: true });
  renderBakeryChips();
  npc.path = [];
  npc.pathIndex = 0;
  npc.state = 'idle';
  npc.waitTimer = 1.4;
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  if (!bakeryQuestState.started) {
    bakeryQuestState.stage = 'offer';
    await bakerySpeak(npc, 'Willst du helfen? Ich zeige dir alles!', 'Хочешь помочь? Я всё покажу.', {
      append: false,
      intent: 'greeting',
      lesson: 'bakeryIntro',
    });
    return;
  }

  if (bakeryQuestState.completed) {
    await bakerySpeak(npc, 'Du kannst backen! Du darfst hier arbeiten.', 'Квест пекарни завершён.', {
      append: false,
      intent: 'happy',
    });
    return;
  }

  await showBakeryHelp(npc);
}

function setBakeryPendingAction(stage, action, status) {
  bakeryQuestState.stage = stage;
  bakeryQuestState.pendingAction = action;
  setBakeryStatus(status);
  renderBakeryChips();
  renderDorfbuch();
}

async function sendBakeryDialogueToNpc(npc, message) {
  const line = String(message || '').trim();

  if (!npc || !line) {
    return;
  }

  await unlockGameAudio({ showStatus: true });
  setSelectedNpc(npc);
  appendDialogue(npc, 'player', line);
  dialogueInput.value = '';
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  const text = normalizeText(line);

  if (/(hilfe|help|was soll|was muss|noch mal|nochmal)/.test(text)) {
    await showBakeryHelp(npc);
    return;
  }

  if (bakeryQuestState.stage === 'offer') {
    if (/(ja|helfen|ich will|ich kann)/.test(text)) {
      await startBakeryQuest(npc);
      return;
    }

    await bakerySpeak(npc, 'Sag: Ich will helfen. Oder: Ich kann helfen.', 'Начни работу у Hans.', {
      intent: 'helpful',
    });
    return;
  }

  if (bakeryQuestState.stage === 'wash_phrase') {
    if (bakeryHasCorrectModal(line, 'muss', /(?:die )?haende|(?:die )?hande/, 'waschen')) {
      setBakeryPendingAction('wash_action', 'wash_hands', 'klicke auf die Hände');
      await bakerySpeak(npc, 'Ja! Verb am Ende - gut. Klick die Hände.', 'Верно. Теперь кликни умывальник.', {
        intent: 'happy',
      });
      return;
    }

    if (bakeryHasMisplacedInfinitive(line, 'muss', 'waschen')) {
      await bakeryClarifyWordOrder(npc, 'die Hände', 'waschen');
      return;
    }
  }

  if (bakeryQuestState.stage === 'flour_phrase') {
    if (
      bakeryHasCorrectModal(line, 'kann', /(?:das )?mehl/, 'holen') ||
      bakeryHasCorrectModal(line, 'muss', /(?:das )?mehl/, 'holen')
    ) {
      setBakeryPendingAction('flour_action', 'flour', 'hole das Mehl');
      await bakerySpeak(npc, 'Ja! Verb am Ende - gut. Hol das Mehl.', 'Верно. Кликни муку.', {
        intent: 'happy',
      });
      return;
    }

    if (bakeryHasMisplacedInfinitive(line, 'kann', 'holen') || bakeryHasMisplacedInfinitive(line, 'muss', 'holen')) {
      await bakeryClarifyWordOrder(npc, 'das Mehl', 'holen');
      return;
    }
  }

  if (bakeryQuestState.stage === 'water_phrase') {
    if (bakeryHasCorrectModal(line, 'muss', /(?:das )?wasser/, 'bringen')) {
      setBakeryPendingAction('water_action', 'water', 'bringe das Wasser');
      await bakerySpeak(npc, 'Ja! Verb am Ende - gut. Bring das Wasser.', 'Верно. Кликни воду.', {
        intent: 'happy',
      });
      return;
    }

    if (bakeryHasMisplacedInfinitive(line, 'muss', 'bringen')) {
      await bakeryClarifyWordOrder(npc, 'das Wasser', 'bringen');
      return;
    }
  }

  if (bakeryQuestState.stage === 'permission') {
    if (/^darf ich\b/.test(text)) {
      bakeryQuestState.steps.permission = true;
      bakeryQuestState.stage = 'dough_phrase';
      renderBakeryChips();
      renderDorfbuch();
    await bakerySpeak(npc, 'Ja, klar! Jetzt: Was musst du machen?', 'Разрешение получено. Теперь скажи действие.', {
      intent: 'happy',
      lesson: 'bakeryDough',
    });
      return;
    }

    if (/teig|kneten/.test(text)) {
      await bakerySpeak(npc, 'Halt! Fragen! Sag: Darf ich?', 'Сначала спроси: Darf ich?', {
        intent: 'thinking',
        lesson: 'bakeryPermission',
      });
      return;
    }
  }

  if (bakeryQuestState.stage === 'dough_phrase') {
    if (bakeryHasCorrectModal(line, 'muss', /(?:den|das)?\s*teig/, 'kneten')) {
      setBakeryPendingAction('dough_action', 'dough', 'knete den Teig');
      await bakerySpeak(npc, 'Ja! Verb am Ende - gut. Knete den Teig.', 'Верно. Кликни тесто.', {
        intent: 'happy',
      });
      return;
    }

    if (bakeryHasMisplacedInfinitive(line, 'muss', 'kneten')) {
      await bakeryClarifyWordOrder(npc, 'den Teig', 'kneten');
      return;
    }
  }

  if (bakeryQuestState.stage === 'free_sequence') {
    const final = parseBakeryFinalSequence(line);

    if (final.complete) {
      bakeryQuestState.finalSequenceSpoken = true;
      setBakeryPendingAction('order_flour_action', 'flour', 'zuerst Mehl');
      await bakerySpeak(npc, 'Sehr gut! Verb am Ende. Zuerst: Hol das Mehl.', 'Вся последовательность верная. Кликни муку.', {
        intent: 'happy',
      });
      return;
    }

    if (final.flourOnly) {
      bakeryQuestState.finalSequenceSpoken = false;
      setBakeryPendingAction('order_flour_action', 'flour', 'zuerst Mehl');
      await bakerySpeak(npc, 'Ja. Zuerst: Hol das Mehl.', 'Кликни муку.', { intent: 'happy' });
      return;
    }

    if (final.misplaced) {
      await bakeryClarifyWordOrder(npc, 'das Mehl / den Teig / Brot', 'holen / kneten / backen');
      return;
    }
  }

  if (bakeryQuestState.stage === 'order_dough_phrase') {
    const final = parseBakeryFinalSequence(line);

    if (final.doughOnly) {
      setBakeryPendingAction('order_dough_action', 'dough', 'dann Teig');
      await bakerySpeak(npc, 'Gut. Dann: Knete den Teig.', 'Теперь кликни тесто.', { intent: 'happy' });
      return;
    }

    if (final.misplaced) {
      await bakeryClarifyWordOrder(npc, 'den Teig', 'kneten');
      return;
    }
  }

  if (bakeryQuestState.stage === 'bake_phrase') {
    const final = parseBakeryFinalSequence(line);

    if (final.breadOnly || bakeryHasCorrectModal(line, 'will', /(?:das )?brot/, 'backen')) {
      setBakeryPendingAction('bake_action', 'oven', 'backe Brot');
      await bakerySpeak(npc, 'Ja. Jetzt: Brot backen. Klick den Ofen.', 'Кликни печь.', { intent: 'happy' });
      return;
    }

    if (final.misplaced || bakeryHasMisplacedInfinitive(line, 'will', 'backen')) {
      await bakeryClarifyWordOrder(npc, 'Brot', 'backen');
      return;
    }
  }

  await bakerySpeak(npc, 'Hm? Modal auf Platz zwei. Das zweite Verb kommt ans Ende.', 'Нужна модальная рамка.', {
    intent: 'helpful',
  });
}

async function openMarketMerchantDialogue(npc) {
  if (!npc) {
    return;
  }

  setSelectedNpc(npc, { focusInput: true });
  renderMarketChips(npc);
  npc.path = [];
  npc.pathIndex = 0;
  npc.state = 'idle';
  npc.waitTimer = 1.4;
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  if (npc.id === 'kaesehaendler_otto') {
    await marketSpeak(npc, 'Guten Tag. Was möchtest du? Der Käse ist frisch.', 'Use accusative: den Käse.', {
      append: false,
      intent: 'greeting',
      lesson: 'marketAccusative',
    });
    return;
  }

  if (npc.id === 'eierfrau_lena') {
    await marketSpeak(npc, 'Hallo! Eier und Milch. Wie viele Eier möchtest du?', 'Hans needs six eggs and milk.', {
      append: false,
      intent: 'greeting',
      lesson: 'marketCount',
    });
    return;
  }

  if (npc.id === 'gemuesehaendlerin_rosa') {
    await marketSpeak(npc, 'Frisches Gemüse! Rote, grüne oder gelbe Tomaten?', 'Choose a color.', {
      append: false,
      intent: 'greeting',
      lesson: 'marketColor',
    });
  }
}

async function handleOttoMarketLine(npc, line) {
  const text = normalizeText(line);

  if (!marketWantsCheese(text)) {
    await marketSpeak(npc, 'Ich verkaufe Käse. Sag: Ich möchte den Käse.', 'Otto sells cheese.', {
      intent: 'helpful',
    });
    return;
  }

  const hasAccusative = /\b(?:den|einen)\s+(?:kase|kaese)\b/.test(text);
  const hasNominative = /\b(?:der|ein)\s+(?:kase|kaese)\b/.test(text) || /^(?:kase|kaese)$/.test(text);

  if (hasAccusative) {
    marketQuestState.basket.cheese = true;
    renderDorfbuch();
    setMarketStatus('Käse im Korb');
    await marketSpeak(npc, 'Sehr gut: DEN Käse. Hier ist ein Stück Käse.', 'Correct accusative. Cheese is in the basket.', {
      intent: 'happy',
    });
    return;
  }

  if (hasNominative || marketWantsCheese(text)) {
    marketQuestState.clarifyCounts.otto += 1;

    if (marketQuestState.clarifyCounts.otto >= 2) {
      marketQuestState.basket.cheese = true;
      renderDorfbuch();
      setMarketStatus('Käse im Korb');
      await marketSpeak(npc, 'Na gut. Ich helfe: DEN Käse. Hier ist der Käse.', 'Second try: Otto recasts and gives the cheese.', {
        intent: 'helpful',
      });
      return;
    }

    await marketSpeak(npc, 'Hm? DEN Käse? Sag bitte: Ich möchte den Käse.', 'First B answer: clarification only.', {
      intent: 'thinking',
    });
  }
}

async function handleLenaMarketLine(npc, line) {
  const text = normalizeText(line);
  const wantsMilk = marketWantsMilk(text);
  const hasEggWord = marketWantsEggs(text);
  const eggCount = getMarketEggCount(line);
  const wantsEggs =
    hasEggWord ||
    (!wantsMilk && (Boolean(eggCount) || /\b(?:bitte|nehme|mochte|moechte|hatte|haette)\b/.test(text)));
  const responses = [];

  if (wantsEggs) {
    if (!eggCount) {
      marketQuestState.clarifyCounts.lena += 1;
      await marketSpeak(npc, 'Wie viele Eier? Hans zaehlt genau.', 'Say: Sechs Eier, bitte.', {
        intent: 'helpful',
      });
      return;
    }

    marketQuestState.basket.eggs = eggCount;
    responses.push(
      eggCount === 6
        ? 'Sechs Eier. Genau.'
        : `${getGermanNumber(eggCount)} Eier. Ich gebe dir genau diese Zahl.`,
    );
  }

  if (wantsMilk) {
    marketQuestState.basket.milk = true;
    responses.push('Die Milch ist im Korb.');
  }

  if (!responses.length) {
    await marketSpeak(npc, 'Ich habe Eier und Milch. Sag: Sechs Eier, bitte. Oder: Ich nehme die Milch.', 'Eggs and milk stand.', {
      intent: 'helpful',
    });
    return;
  }

  renderDorfbuch();
  setMarketStatus('Lena: Ware im Korb');
  await marketSpeak(npc, responses.join(' '), marketBasketSummary(), {
    intent: eggCount === 6 || wantsMilk ? 'happy' : 'thinking',
  });
}

async function handleRosaMarketLine(npc, line) {
  const text = normalizeText(line);
  const color = getMarketTomatoColor(line);

  if (!marketWantsTomatoes(text) && !color && !marketTextIncludes(text, ['gemuse', 'gemuese', 'obst'])) {
    await marketSpeak(npc, 'Ich verkaufe Gemüse und Obst. Welche Tomaten: rot, grün oder gelb?', 'Rosa asks for a color.', {
      intent: 'helpful',
    });
    return;
  }

  if (!color) {
    marketQuestState.clarifyCounts.rosa += 1;
    await marketSpeak(npc, 'Welche denn? Rote Tomaten, grüne Tomaten oder gelbe Tomaten?', 'Choose a tomato color.', {
      intent: 'thinking',
    });
    return;
  }

  marketQuestState.basket.tomatoes = color;
  renderDorfbuch();
  setMarketStatus(`Rosa: ${color} Tomaten`);
  await marketSpeak(npc, `Gut. Die ${color}n Tomaten sind im Korb. Frisch!`, 'Color choice saved.', {
    intent: 'happy',
  });
}

async function sendMarketDialogueToNpc(npc, message) {
  const line = String(message || '').trim();

  if (!line) {
    return;
  }

  await unlockGameAudio({ showStatus: true });
  setSelectedNpc(npc);
  appendDialogue(npc, 'player', line);
  dialogueInput.value = '';
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  if (npc.id === 'kaesehaendler_otto') {
    await handleOttoMarketLine(npc, line);
    return;
  }

  if (npc.id === 'eierfrau_lena') {
    await handleLenaMarketLine(npc, line);
    return;
  }

  if (npc.id === 'gemuesehaendlerin_rosa') {
    await handleRosaMarketLine(npc, line);
  }
}

async function questThreeSpeak(npc, de, ru = '', options = {}) {
  await unlockGameAudio({ showStatus: options.showAudioStatus === true });
  setSelectedNpc(npc, { focusInput: options.focusInput !== false });
  renderQuestThreeChips(npc);
  return speakQuestLine(npc, de, ru, {
    intent: options.intent || 'talk',
    append: options.append,
    lesson: options.lesson,
    ruIntro: options.ruIntro,
    skipRuIntro: options.skipRuIntro,
    forceRuIntro: options.forceRuIntro,
    ruVoiceId: options.ruVoiceId,
    ruRate: options.ruRate,
    ruPitch: options.ruPitch,
    ruVolume: options.ruVolume,
  });
}

function parseQuestThreeQuestion(input) {
  const text = normalizeText(input);

  if (/^(hallo|guten tag|guten morgen|entschuldigung|servus|hi|hey)\b/.test(text)) {
    return 'greeting';
  }

  if (/(wer bist du|wie heisst du|wie heisst du|wie heißt du|wie heissen sie|wer sind sie|wer du|name)/.test(text)) {
    return 'name';
  }

  if (/(was machst du|was ist dein beruf|was arbeitest du|was machen|arbeitest|beruf)/.test(text)) {
    return 'job';
  }

  if (/(wo wohnst du|wo wohnen sie|wo wohnst|wo lebst du|wo ist dein haus|wo ist die wohnung)/.test(text)) {
    return 'lives';
  }

  if (/(wie alt bist du|wie alt|alter)/.test(text)) {
    return 'age';
  }

  if (/(ich bin neu hier|ich bin neu|ich spreche|ich frage|ich mache|ich komme|neu hier)/.test(text)) {
    return 'self';
  }

  return null;
}

function fillQuestThreeSlot(npc, slot) {
  if (!npc || !questThreeState.slots[npc.id] || !(slot in questThreeState.slots[npc.id])) {
    return;
  }

  questThreeState.slots[npc.id][slot] = true;
  renderDorfbuch();

  if (isQuestThreeComplete()) {
    questThreeState.completed = true;
    questThreeState.active = false;
    questThreeState.readyForBerta = true;
    setQuestThreeStatus('вернитесь в Gasthaus к Berta');
    renderTargets();
  } else {
    const progress = getQuestThreeProgress();
    setQuestThreeStatus(`Dorfbuch ${progress.filled}/${progress.total}`);
  }
}

async function openQuestThreeDialogue(npc) {
  if (!npc) {
    return;
  }

  await unlockGameAudio({ showStatus: true });
  setSelectedNpc(npc, { focusInput: true });
  renderQuestThreeChips(npc);
  npc.path = [];
  npc.pathIndex = 0;
  npc.state = 'idle';
  npc.waitTimer = 1.4;
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  if (npc.id === 'muellerin_greta' && !questThreeState.gretaGreeted) {
    setQuestThreeStatus('привлеките внимание Greta');
    await questThreeSpeak(npc, 'Hm? Sag erst: Hallo.', 'Сначала поздоровайтесь: Hallo или Entschuldigung.', {
      append: false,
      intent: 'thinking',
      lesson: 'questThreeGretaGreeting',
    });
    return;
  }

  setQuestThreeStatus('задайте W-вопрос');
  await questThreeSpeak(npc, 'Frag mich: Wer? Was? Wo?', 'Спроси меня: кто? что делает? где живёт?', {
    append: false,
    intent: 'helpful',
    lesson: 'questThreeIntro',
  });
}

async function sendQuestThreeDialogueToNpc(npc, message) {
  const line = String(message || '').trim();

  if (!line) {
    return;
  }

  await unlockGameAudio({ showStatus: true });
  setSelectedNpc(npc);
  appendDialogue(npc, 'player', line);
  dialogueInput.value = '';
  faceNpcToAgent(npc, 1);
  faceAgentToNpc(npc);

  const question = parseQuestThreeQuestion(line);
  const definition = getQuestThreeDefinition(npc.id);

  if (!definition) {
    return;
  }

  if (npc.id === 'muellerin_greta' && !questThreeState.gretaGreeted) {
    if (question !== 'greeting') {
      await questThreeSpeak(npc, 'Hm? Erst: Hallo!', 'Хм? Сначала: Hallo!', { intent: 'thinking' });
      return;
    }

    questThreeState.gretaGreeted = true;
    renderQuestThreeChips(npc);
    await questThreeSpeak(npc, 'Hallo! Ja?', 'Привет! Да?', { intent: 'greeting' });
    return;
  }

  if (npc.id === 'muellerin_greta' && questThreeState.gretaAwaitingSelfAnswer) {
    if (question !== 'self') {
      await questThreeSpeak(npc, 'Erst du! Was machst du hier?', 'Сначала ты! Что ты здесь делаешь?', {
        intent: 'thinking',
      });
      return;
    }

    questThreeState.gretaAwaitingSelfAnswer = false;
    renderQuestThreeChips(npc);
    await questThreeSpeak(npc, 'Ah, neu hier. Gut! Frag weiter.', 'А, ты здесь новый. Хорошо! Спрашивай дальше.', {
      intent: 'happy',
    });
    return;
  }

  if (question === 'greeting') {
    await questThreeSpeak(npc, 'Hallo!', 'Привет!', { intent: 'greeting' });
    return;
  }

  if (question === 'age') {
    await questThreeSpeak(npc, definition.answers.age, 'Любопытно, но Dorfbuch это поле не заполняет.', {
      intent: 'thinking',
    });
    return;
  }

  if (!['name', 'job', 'lives'].includes(question)) {
    await questThreeSpeak(npc, 'Hm? Ich verstehe nicht. Frag: Wer? Was? Wo?', 'Хм? Не понимаю. Спроси: Wer? Was? Wo?', {
      intent: 'helpful',
    });
    return;
  }

  const alreadyKnown = questThreeState.slots[npc.id]?.[question];

  if (alreadyKnown) {
    await questThreeSpeak(
      npc,
      `Das habe ich doch gesagt! ${definition.answers[question]}`,
      'Это уже записано в Dorfbuch.',
      { intent: 'thinking' },
    );
    return;
  }

  fillQuestThreeSlot(npc, question);

  if (npc.id === 'muellerin_greta' && question === 'name') {
    questThreeState.gretaAwaitingSelfAnswer = true;
  }

  await questThreeSpeak(npc, definition.answers[question], '', { intent: question === 'name' ? 'greeting' : 'talk' });

  if (questThreeState.readyForBerta) {
    await questThreeSpeak(npc, 'Drei Nachbarn! Geh zurück zu Berta.', 'Три соседа! Вернись к Берте.', {
      append: false,
      intent: 'happy',
    });
  }
}

async function finishQuestThreeWithBerta(npc) {
  if (!npc || !questThreeState.readyForBerta || questThreeState.bertaRewarded) {
    return false;
  }

  questThreeState.bertaRewarded = true;
  questThreeState.readyForBerta = false;
  questThreeState.completed = true;
  marketQuestState.mayorLetterReceived = true;
  renderDorfbuch();
  renderGasthausChips();
  await gasthausSpeak(
    npc,
    `Drei Freunde! Sehr gut, ${questState.playerName || 'Gast'}! Hier: ein Brief vom Bürgermeister. Er braucht Essen für das Dorf. Geh zum Markt. Finde Hans im Dorfzentrum.`,
    'Три друга! Очень хорошо! Вот письмо от бургомистра. Ему нужна еда для деревни. Иди на рынок и найди Hans в центре деревни.',
    { intent: 'happy' },
  );
  setQuestStatus('Блок A1.1 завершён');
  unlockMarketQuest();
  showSceneHint('Quest 04: Der Markt. Finde Hans im Dorfzentrum.', 9000);
  return true;
}

function configureStaticModel(root) {
  root.traverse((object) => {
    if (!object.isMesh) {
      return;
    }

    object.castShadow = false;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
}

// The tavern GLB ships with a batch of "bar_enrich_*" props that float in the
// air around the counter. Hide them so the bar reads cleanly.
function hideGasthausClutter(model) {
  let hidden = 0;

  model.traverse((object) => {
    if (object.isMesh && /bar_enrich/i.test(object.name)) {
      object.visible = false;
      hidden += 1;
    }
  });

  if (hidden) {
    console.info(`Gasthaus: hid ${hidden} floating bar props`);
  }
}

function measureGasthausFloor(model) {
  // The ground-floor tiles define the playable footprint. Excluding "upper"
  // (the balcony) keeps roof overhangs and the upper storey from skewing the
  // fit. Falls back to the whole model when no floor meshes are named.
  const floorBox = new THREE.Box3();
  let hasFloor = false;

  model.traverse((object) => {
    if (object.isMesh && /floor/i.test(object.name) && !/upper/i.test(object.name)) {
      floorBox.expandByObject(object);
      hasFloor = true;
    }
  });

  if (hasFloor && !floorBox.isEmpty()) {
    return floorBox;
  }

  return new THREE.Box3().setFromObject(model);
}

function normalizeGasthausModel(model) {
  model.updateMatrixWorld(true);

  const fitBox = measureGasthausFloor(model);

  if (fitBox.isEmpty()) {
    return;
  }

  const size = fitBox.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.z, 0.001);
  model.scale.multiplyScalar(GASTHAUS_FLOOR_SPAN / maxSize);
  model.updateMatrixWorld(true);

  // Re-measure after scaling, centre the floor on the origin in X/Z and drop the
  // floor surface to y = 0 so the player and NPCs stand directly on it.
  const floor = measureGasthausFloor(model);
  const center = floor.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= floor.max.y;
}

function createGasthausTextLabel(text, options = {}) {
  const canvasLabel = document.createElement('canvas');
  canvasLabel.width = 512;
  canvasLabel.height = 160;
  const context = canvasLabel.getContext('2d');
  context.fillStyle = options.background || 'rgba(20, 28, 22, 0.88)';
  context.fillRect(0, 0, canvasLabel.width, canvasLabel.height);
  context.strokeStyle = options.border || '#d8b15e';
  context.lineWidth = 10;
  context.strokeRect(8, 8, canvasLabel.width - 16, canvasLabel.height - 16);
  context.fillStyle = options.color || '#fff8d8';
  context.font = `${options.weight || 800} ${options.size || 46}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvasLabel.width / 2, canvasLabel.height / 2);

  const texture = new THREE.CanvasTexture(canvasLabel);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(options.width || 2.4, options.height || 0.75), material);
  mesh.name = `Label_${text.replace(/\s+/g, '_')}`;
  return mesh;
}

function makeGasthausBox(name, position, size, color, action = '') {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(position);

  if (action) {
    mesh.userData.gasthausAction = action;
  }

  return mesh;
}

function createGasthausFloor() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 9),
    new THREE.MeshBasicMaterial({
      color: 0x6d4a2e,
      opacity: 0.02,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  floor.name = 'Gasthaus_Click_Floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  floor.userData.gasthausFloor = true;
  return floor;
}

// "Tavern noch eine" already models the bar, tables, staircase and wall sign,
// so the overlay only adds invisible/interaction helpers on top of it.
function buildGasthausOverlay(root) {
  root.add(createGasthausFloor());

  // Invisible click target over the real bar counter (front-left) so tapping
  // the bar opens the coin wallet.
  const barHotspot = makeGasthausBox(
    'Gasthaus_Bar_Hotspot',
    new THREE.Vector3(-2.9, 0.9, 3.3),
    new THREE.Vector3(2.8, 1.7, 1.6),
    0x6d3f21,
    'wallet',
  );
  barHotspot.material.transparent = true;
  barHotspot.material.opacity = 0;
  barHotspot.material.depthWrite = false;
  root.add(barHotspot);

  // Price board (game element) near the bar.
  const menuLabel = createGasthausTextLabel('Brot 2 | Suppe 3 | Bier 4', { width: 2.2, height: 0.42, size: 30 });
  menuLabel.position.set(-4.9, 1.7, 2.4);
  menuLabel.rotation.y = Math.PI / 2;
  menuLabel.userData.gasthausAction = 'menu';
  root.add(menuLabel);

  // No more primitive "Tür eins/zwei/..." boxes: the room is chosen from the
  // chip buttons / by typing during the get_key step, so they are not needed.
}

function buildGasthausNpc(definition, rigged) {
  if (!rigged?.scene) {
    throw new Error(`Missing character GLB for NPC ${definition.id}`);
  }

  const root = new THREE.Group();
  root.name = definition.id;
  root.position.copy(definition.position);
  root.rotation.y = definition.yaw || 0;
  applyNpcOverrideToRoot(definition.id, root);

  let visual;
  let mixer = null;
  let mouth = null;
  const embeddedAnimationNames = [];
  let idleAnimationName = null;

  visual = rigged.scene;
  visual.name = `${definition.id}_visual`;
  root.add(visual);
  configureNpcModel(visual);

  for (const clip of rigged.animations || []) {
    const name = registerCharacterClip(clip, `${definition.label} ${clip.name || 'Idle'}`, {
      loop: true,
    });

    if (name) {
      embeddedAnimationNames.push(name);
    }
  }

  idleAnimationName =
    embeddedAnimationNames.find((name) => /idle|standing|breathing|mixamo/i.test(name)) ||
    embeddedAnimationNames[0] ||
    findAnimationByClipKeywords(['standing idle', 'idle', 'breathing']) ||
    null;

  mixer = new THREE.AnimationMixer(root);
  mouth = new TextLipSync(root, { strength: 0.48, maxJaw: 0.34 });

  const npc = {
    id: definition.id,
    label: definition.label,
    role: definition.role,
    aliases: definition.aliases,
    voiceId: definition.voiceId || ELEVENLABS_VOICES.bella,
    location: LOCATION_GASTHAUS,
    root,
    visual,
    model: visual,
    mixer,
    mouth,
    embeddedAnimationNames,
    idleAnimationName,
    currentAction: null,
    currentAnimationName: null,
    path: [],
    pathIndex: 0,
    waitTimer: 999,
    repathTimer: 0,
    speed: 0,
    state: 'idle',
    dialogue: [],
    talkUntil: 0,
    afterTalk: null,
    marker: null,
    target: null,
    groundBiasY: 0,
    groundBiasDirty: false,
    useProceduralIdle: false,
    proceduralPhase: Math.random() * Math.PI * 2,
    proceduralBones: {},
    scriptedMovement: false,
    turnTargetYaw: null,
    finalYaw: null,
    stationary: true,
    seated: Boolean(definition.seated),
    // Keep tavern characters in a stable idle/seated loop and skip external
    // gesture clips that could snap a baked rig into a T-pose mid-conversation.
    lockIdle: true,
  };

  setupProceduralIdle(npc);
  fitNpcVisualToGround(npc);

  npc.target = createNpcTargetFromNpc(npc);
  markNpcObjectTree(npc);
  gasthausRoot.add(root);
  npcById.set(npc.id, npc);
  npcs.push(npc);
  applyNpcOverrideToNpc(npc);

  if (npc.seated) {
    applyGasthausSeatedIdle(npc);
    npc.mixer.update(0);
    groundSeatedNpc(npc);
  } else {
    playNpcIdle(npc, { fade: 0 });
    npc.mixer.update(0);
    calibrateNpcGroundBias(npc);
    npc.groundBiasDirty = false;
    refitNpcToGround(npc);
  }

  return npc;
}

// Drop a seated character so the lowest point of its sitting pose rests on the
// floor. Runs once, after the sitting clip is applied (seated NPCs skip the
// per-frame re-ground, which is why they previously floated at standing height
// and appeared to slide across the scene as the camera moved).
function groundSeatedNpc(npc) {
  if (!npc?.visual) {
    return;
  }

  npc.visual.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(npc.visual);

  if (box.isEmpty() || !Number.isFinite(box.min.y)) {
    return;
  }

  npc.visual.position.y -= box.min.y - npc.root.position.y;
}

function applyGasthausSeatedIdle(npc) {
  const name =
    findAnimationByClipKeywords(['sitting idle', 'sitting laughing', 'sitting']) ||
    npc.idleAnimationName;

  if (!name) {
    return;
  }

  // Loop the seated clip as this NPC's "idle" so playNpcIdle keeps them seated.
  npc.idleAnimationName = name;
  npc.useProceduralIdle = false;
  playNpcAnimation(npc, name, { loop: true, fade: 0 });
}

async function loadGasthausNpc(definition) {
  if (getNpcById(definition.id)) {
    return getNpcById(definition.id);
  }

  if (!definition.modelUrl) {
    console.error(`Gasthaus character ${definition.id} has no modelUrl; skipping NPC.`);
    return null;
  }

  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const rigged = await loadGltf(loader, definition.modelUrl);
    return buildGasthausNpc(definition, rigged);
  } catch (error) {
    console.error(`Gasthaus character ${definition.id} failed to load from characters; skipping NPC.`, error);
    return null;
  }
}

async function loadQuestThreeNpc(definition) {
  if (getNpcById(definition.id)) {
    return getNpcById(definition.id);
  }

  if (!definition.modelUrl) {
    console.error(`Quest character ${definition.id} has no modelUrl; skipping NPC.`);
    return null;
  }

  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const rigged = await loadGltf(loader, definition.modelUrl);
    return createQuestThreeNpc(definition, rigged);
  } catch (error) {
    console.error(`Quest character ${definition.id} failed to load from characters; skipping NPC.`, error);
    return null;
  }
}

function createQuestThreeNpc(definition, rigged) {
  if (getNpcById(definition.id) || !npcContainer) {
    return getNpcById(definition.id);
  }

  if (!rigged?.scene) {
    throw new Error(`Missing character GLB for NPC ${definition.id}`);
  }

  const root = new THREE.Group();
  root.name = definition.id;
  root.position.copy(snapToNpcGround(definition.position));
  root.rotation.y = definition.yaw || angleToAgent(root.position);
  applyNpcOverrideToRoot(definition.id, root);

  const visual = rigged.scene;
  visual.name = `${definition.id}_visual`;
  root.add(visual);
  configureNpcModel(visual);

  const embeddedAnimationNames = [];

  for (const clip of rigged.animations || []) {
    const name = registerCharacterClip(clip, `${definition.label} ${clip.name || 'Idle'}`, {
      loop: true,
    });

    if (name) {
      embeddedAnimationNames.push(name);
    }
  }

  const idleAnimationName =
    embeddedAnimationNames.find((name) => /idle|standing|breathing|mixamo/i.test(name)) ||
    embeddedAnimationNames[0] ||
    findAnimationByClipKeywords(['standing idle', 'idle', 'breathing']) ||
    null;

  const npc = {
    id: definition.id,
    label: definition.label,
    role: definition.role,
    aliases: definition.aliases,
    voiceId: definition.voiceId || (definition.id === 'lehrerin_ida' ? ELEVENLABS_VOICES.rachel : ELEVENLABS_VOICES.josh),
    location: LOCATION_VILLAGE,
    questId: QUEST_THREE_ID,
    facts: definition.facts,
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
    waitTimer: 999,
    repathTimer: 0,
    speed: 0,
    state: 'idle',
    dialogue: [],
    talkUntil: 0,
    afterTalk: null,
    marker: null,
    target: null,
    groundBiasY: 0,
    groundBiasDirty: false,
    useProceduralIdle: false,
    proceduralPhase: Math.random() * Math.PI * 2,
    proceduralBones: {},
    scriptedMovement: false,
    turnTargetYaw: null,
    finalYaw: null,
    stationary: true,
    patrolPoints: definition.patrolPoints || [],
    homeTargetIds: [],
    lockIdle: true,
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
  applyNpcOverrideToNpc(npc);
  playNpcIdle(npc, { fade: 0 });
  npc.mixer.update(0);
  calibrateNpcGroundBias(npc);
  npc.groundBiasDirty = false;
  refitNpcToGround(npc);
  syncNpcTarget(npc);
  return npc;
}

async function ensureQuestThreeNpcs() {
  if (!navigation || !questThreeState.unlocked) {
    return;
  }

  await Promise.all(QUEST_THREE_NPCS.map((definition) => loadQuestThreeNpc(definition)));

  syncAllNpcTargets();
  renderTargets();
  renderDorfbuch();
  publishDebugState();
}

function getMarketDefinition(id) {
  return MARKET_MERCHANT_NPCS.find((npc) => npc.id === id) || null;
}

async function loadMarketNpc(definition) {
  if (getNpcById(definition.id)) {
    return getNpcById(definition.id);
  }

  if (!definition.modelUrl) {
    console.error(`Market character ${definition.id} has no modelUrl; skipping NPC.`);
    return null;
  }

  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const rigged = await loadGltf(loader, definition.modelUrl);
    return createMarketNpc(definition, rigged);
  } catch (error) {
    console.error(`Market character ${definition.id} failed to load from characters; skipping NPC.`, error);
    return null;
  }
}

function createMarketNpc(definition, rigged) {
  if (getNpcById(definition.id) || !npcContainer) {
    return getNpcById(definition.id);
  }

  if (!rigged?.scene) {
    throw new Error(`Missing character GLB for market NPC ${definition.id}`);
  }

  const root = new THREE.Group();
  root.name = definition.id;
  root.position.copy(snapToNpcGround(definition.position));
  root.rotation.y = definition.yaw || angleToAgent(root.position);
  applyNpcOverrideToRoot(definition.id, root);

  const visual = rigged.scene;
  visual.name = `${definition.id}_visual`;
  root.add(visual);
  configureNpcModel(visual);

  const embeddedAnimationNames = [];

  for (const clip of rigged.animations || []) {
    const name = registerCharacterClip(clip, `${definition.label} ${clip.name || 'Idle'}`, {
      loop: true,
    });

    if (name) {
      embeddedAnimationNames.push(name);
    }
  }

  const idleAnimationName =
    embeddedAnimationNames.find((name) => /idle|standing|breathing|mixamo/i.test(name)) ||
    embeddedAnimationNames[0] ||
    findAnimationByClipKeywords(['standing idle', 'idle', 'breathing']) ||
    null;

  const npc = {
    id: definition.id,
    label: definition.label,
    role: definition.role,
    aliases: definition.aliases,
    voiceId: definition.voiceId || ELEVENLABS_VOICES.josh,
    location: LOCATION_VILLAGE,
    questId: QUEST_MARKET_ID,
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
    waitTimer: 999,
    repathTimer: 0,
    speed: 0,
    state: 'idle',
    dialogue: [],
    talkUntil: 0,
    afterTalk: null,
    marker: null,
    target: null,
    groundBiasY: 0,
    groundBiasDirty: false,
    useProceduralIdle: false,
    proceduralPhase: Math.random() * Math.PI * 2,
    proceduralBones: {},
    scriptedMovement: false,
    turnTargetYaw: null,
    finalYaw: null,
    stationary: true,
    patrolPoints: [],
    homeTargetIds: [],
    lockIdle: true,
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
  applyNpcOverrideToNpc(npc);
  playNpcIdle(npc, { fade: 0 });
  npc.mixer.update(0);
  calibrateNpcGroundBias(npc);
  npc.groundBiasDirty = false;
  refitNpcToGround(npc);
  syncNpcTarget(npc);
  return npc;
}

async function ensureMarketNpcs() {
  if (!navigation || !marketQuestState.unlocked) {
    return;
  }

  await Promise.all(MARKET_MERCHANT_NPCS.map((definition) => loadMarketNpc(definition)));

  syncAllNpcTargets();
  renderTargets();
  renderDorfbuch();
  publishDebugState();
}

function createGasthausFallbackInterior() {
  const group = new THREE.Group();
  group.name = 'Gasthaus_Fallback_Interior';

  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x4c3423, roughness: 0.82 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.12, 13), floorMaterial);
  floor.position.y = -0.06;
  group.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d0bd, roughness: 0.85 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(12, 2.8, 0.18), wallMaterial);
  backWall.position.set(0, 1.4, -6.3);
  group.add(backWall);

  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(12, 2.8, 0.18), wallMaterial);
  frontWall.position.set(0, 1.4, 6.4);
  group.add(frontWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 13), wallMaterial);
  leftWall.position.set(-6.05, 1.4, 0);
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 13), wallMaterial);
  rightWall.position.set(6.05, 1.4, 0);
  group.add(rightWall);

  return group;
}

async function ensureGasthausLoaded() {
  if (locationState.gasthausLoaded && gasthausRoot) {
    return;
  }

  gasthausRoot = gasthausRoot || new THREE.Group();
  gasthausRoot.name = 'Gasthaus_Grunbach_Location';
  gasthausRoot.visible = false;

  if (!gasthausRoot.parent) {
    scene.add(gasthausRoot);
  }

  if (!gasthausModel) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    try {
      const gltf = await loadGltf(loader, GASTHAUS_INTERIOR_URL);
      gasthausModel = gltf.scene;
      gasthausModel.name = 'Gasthaus_Interior_Model';
      hideGasthausClutter(gasthausModel);
      configureStaticModel(gasthausModel);
      normalizeGasthausModel(gasthausModel);
      gasthausRoot.add(gasthausModel);
    } catch (error) {
      console.warn('Gasthaus interior failed, using fallback:', error);
      gasthausModel = createGasthausFallbackInterior();
      gasthausRoot.add(gasthausModel);
    }
  }

  if (!gasthausRoot.getObjectByName('Gasthaus_Click_Floor')) {
    buildGasthausOverlay(gasthausRoot);
  }

  // Seated tavern guests loop a Mixamo sitting clip; make sure it is registered
  // before the characters are built.
  const clipLoader = new GLTFLoader();
  clipLoader.setMeshoptDecoder(MeshoptDecoder);
  await loadBodyAnimationClips(clipLoader, GASTHAUS_SITTING_CLIP_URLS);

  await Promise.all(GASTHAUS_NPCS.map((npcDef) => loadGasthausNpc(npcDef)));
  syncAllNpcTargets();
  renderTargets();

  locationState.gasthausLoaded = true;
}

function makeBakeryBox(name, position, size, color, action = '') {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.04,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(position);

  if (action) {
    mesh.userData.bakeryAction = action;
  }

  return mesh;
}

function createBakeryFallbackInterior() {
  const group = new THREE.Group();
  group.name = 'Bakery_Fallback_Interior';

  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x9b7a55, roughness: 0.86 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.12, 8), floorMaterial);
  floor.position.y = -0.06;
  group.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf1dfc0, roughness: 0.82 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(10, 2.9, 0.18), wallMaterial);
  backWall.position.set(0, 1.45, -4);
  group.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.9, 8), wallMaterial);
  leftWall.position.set(-5, 1.45, 0);
  group.add(leftWall);

  group.add(makeBakeryBox('Bakery_Fallback_Oven', new THREE.Vector3(3.1, 0.75, -2.2), new THREE.Vector3(1.7, 1.5, 1.2), 0x4b4038));
  group.add(makeBakeryBox('Bakery_Fallback_Table', new THREE.Vector3(0, 0.45, 0.1), new THREE.Vector3(2.8, 0.9, 1.3), 0x8b5f35));
  group.add(makeBakeryBox('Bakery_Fallback_Shelf', new THREE.Vector3(-3.3, 1.2, -2.7), new THREE.Vector3(1.2, 2.4, 0.5), 0x7b5231));
  return group;
}

function normalizeBakeryModel(model) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);

  if (box.isEmpty()) {
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.z, 0.001);
  model.scale.multiplyScalar(8.4 / maxSize);
  model.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= fitted.min.y;
}

function createBakeryFloor() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 8),
    new THREE.MeshBasicMaterial({
      color: 0xd9b071,
      opacity: 0.02,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  floor.name = 'Bakery_Click_Floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  floor.userData.bakeryFloor = true;
  return floor;
}

// Invisible click volume only — the floating text signs were dropped so the
// interior reads clean; the quest dialogue tells the player what to click.
function makeBakeryHotspot(name, position, size, color, action) {
  const hotspot = makeBakeryBox(name, position, size, color, action);
  hotspot.material.transparent = true;
  hotspot.material.opacity = 0.05;
  hotspot.material.depthWrite = false;
  return hotspot;
}

function buildBakeryOverlay(root) {
  root.add(createBakeryFloor());

  const hotspots = [
    makeBakeryHotspot(
      'Bakery_Sink_Hotspot',
      new THREE.Vector3(-3.35, 0.65, 2.15),
      new THREE.Vector3(1.15, 1.1, 0.9),
      0x7fb6c8,
      'wash_hands',
    ),
    makeBakeryHotspot(
      'Bakery_Flour_Hotspot',
      new THREE.Vector3(-3.25, 0.55, -2.25),
      new THREE.Vector3(1.25, 1.1, 1.0),
      0xf2e1b9,
      'flour',
    ),
    makeBakeryHotspot(
      'Bakery_Water_Hotspot',
      new THREE.Vector3(-2.4, 0.55, 2.15),
      new THREE.Vector3(0.9, 1.0, 0.9),
      0x8fbfd9,
      'water',
    ),
    makeBakeryHotspot(
      'Bakery_Dough_Hotspot',
      new THREE.Vector3(0.05, 0.75, 0.0),
      new THREE.Vector3(2.5, 1.1, 1.45),
      0xb98551,
      'dough',
    ),
    makeBakeryHotspot(
      'Bakery_Oven_Hotspot',
      new THREE.Vector3(3.25, 0.85, -1.8),
      new THREE.Vector3(1.55, 1.55, 1.35),
      0x77412f,
      'oven',
    ),
  ];

  for (const hotspot of hotspots) {
    root.add(hotspot);
  }
}

function createBakeryNpc(definition, rigged) {
  if (getNpcById(definition.id) || !bakeryRoot) {
    return getNpcById(definition.id);
  }

  if (!rigged?.scene) {
    throw new Error(`Missing character GLB for bakery NPC ${definition.id}`);
  }

  const root = new THREE.Group();
  root.name = definition.id;
  root.position.copy(definition.position);
  root.rotation.y = definition.yaw || 0;

  const visual = rigged.scene;
  visual.name = `${definition.id}_visual`;
  root.add(visual);
  configureNpcModel(visual);

  const embeddedAnimationNames = [];

  for (const clip of rigged.animations || []) {
    const name = registerCharacterClip(clip, `${definition.label} ${clip.name || 'Idle'}`, {
      loop: true,
    });

    if (name) {
      embeddedAnimationNames.push(name);
    }
  }

  const idleAnimationName =
    embeddedAnimationNames.find((name) => /idle|standing|breathing|mixamo/i.test(name)) ||
    embeddedAnimationNames[0] ||
    findAnimationByClipKeywords(['standing idle', 'idle', 'breathing']) ||
    null;

  const npc = {
    id: definition.id,
    label: definition.label,
    role: definition.role,
    aliases: definition.aliases,
    voiceId: definition.voiceId || ELEVENLABS_VOICES.antoni,
    location: LOCATION_BAKERY,
    questId: QUEST_BAKERY_ID,
    targetHeight: BAKERY_NPC_HEIGHT,
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
    waitTimer: 999,
    repathTimer: 0,
    speed: 0,
    state: 'idle',
    dialogue: [],
    talkUntil: 0,
    afterTalk: null,
    marker: null,
    target: null,
    groundBiasY: 0,
    groundBiasDirty: false,
    useProceduralIdle: false,
    proceduralPhase: Math.random() * Math.PI * 2,
    proceduralBones: {},
    scriptedMovement: false,
    turnTargetYaw: null,
    finalYaw: null,
    stationary: true,
    lockIdle: true,
  };

  setupProceduralIdle(npc);
  fitNpcVisualToGround(npc);
  npc.target = createNpcTargetFromNpc(npc);
  markNpcObjectTree(npc);
  bakeryRoot.add(root);
  npcById.set(npc.id, npc);
  npcs.push(npc);
  playNpcIdle(npc, { fade: 0 });
  npc.mixer.update(0);
  calibrateNpcGroundBias(npc);
  npc.groundBiasDirty = false;
  refitNpcToGround(npc);
  syncNpcTarget(npc);
  return npc;
}

async function loadBakeryNpc(definition) {
  if (getNpcById(definition.id)) {
    return getNpcById(definition.id);
  }

  if (!definition.modelUrl) {
    console.error(`Bakery character ${definition.id} has no modelUrl; skipping NPC.`);
    return null;
  }

  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const rigged = await loadGltf(loader, definition.modelUrl);
    return createBakeryNpc(definition, rigged);
  } catch (error) {
    console.error(`Bakery character ${definition.id} failed to load from characters; skipping NPC.`, error);
    return null;
  }
}

async function ensureBakeryLoaded() {
  if (locationState.bakeryLoaded && bakeryRoot) {
    return;
  }

  bakeryRoot = bakeryRoot || new THREE.Group();
  bakeryRoot.name = 'Bakery_Grunbach_Location';
  bakeryRoot.visible = false;

  if (!bakeryRoot.parent) {
    scene.add(bakeryRoot);
  }

  if (!bakeryModel) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    try {
      const gltf = await loadGltf(loader, BAKERY_INTERIOR_URL);
      bakeryModel = gltf.scene;
      bakeryModel.name = 'Bakery_Interior_Model';
      configureStaticModel(bakeryModel);
      normalizeBakeryModel(bakeryModel);
      bakeryRoot.add(bakeryModel);
    } catch (error) {
      console.warn('Bakery interior failed, using fallback:', error);
      bakeryModel = createBakeryFallbackInterior();
      bakeryRoot.add(bakeryModel);
    }
  }

  if (!bakeryRoot.getObjectByName('Bakery_Click_Floor')) {
    buildBakeryOverlay(bakeryRoot);
  }

  await Promise.all(BAKERY_NPCS.map((npcDef) => loadBakeryNpc(npcDef)));
  syncAllNpcTargets();
  renderTargets();
  renderDorfbuch();

  locationState.bakeryLoaded = true;
}

function setVillageVisibility(visible) {
  if (cityRoot) {
    cityRoot.visible = visible;
  }

  npcContainer.visible = visible;
  navAreaBlockMarkers.visible = visible;

  if (navigation?.debugMesh) {
    navigation.debugMesh.visible = visible && toggleNavmesh.checked;
  }

  if (navigation?.pathLine) {
    navigation.pathLine.visible = visible;
  }
}

function setGasthausVisibility(visible) {
  if (gasthausRoot) {
    gasthausRoot.visible = visible;
  }
}

function setBakeryVisibility(visible) {
  if (bakeryRoot) {
    bakeryRoot.visible = visible;
  }
}

function setLocation(location) {
  locationState.current = location;
  setVillageVisibility(location === LOCATION_VILLAGE);
  setGasthausVisibility(location === LOCATION_GASTHAUS);
  setBakeryVisibility(location === LOCATION_BAKERY);
  targetMarkers.visible = toggleTargets.checked;
  selectedNpc = null;
  nearbyNpc = null;
  agent.path = [];
  agent.pathIndex = 0;
  agent.pendingAction = null;
  agent.pendingNpcAction = null;
  agent.pendingArrivalPoint = null;
  renderTargets();
  renderDialogue();
  updateLocationHud();
  publishDebugState();
}

async function enterGasthaus() {
  if (locationState.current === LOCATION_GASTHAUS || locationState.transitioning) {
    return;
  }

  await runTransition('Gasthaus Grünbach', async () => {
    await ensureGasthausLoaded();
    setLocation(LOCATION_GASTHAUS);
    agent.position.copy(GASTHAUS_PLAYER_SPAWN);

    // Face the bar/innkeeper on entry so the player sees Frau Berta immediately.
    const berta = getBerta();
    lookYaw = berta
      ? Math.atan2(berta.root.position.x - agent.position.x, berta.root.position.z - agent.position.z)
      : Math.PI;
    agent.yaw = lookYaw;
    lookPitch = -0.05;
    gasthausSetStatus(
      questThreeState.readyForBerta && !questThreeState.bertaRewarded
        ? 'скажите: Ich spreche mit Berta'
        : 'познакомьтесь с Frau Berta',
    );
    renderGasthausChips();
  });

  if (!locationState.gasthausPrompted) {
    locationState.gasthausPrompted = true;
    await openGasthausQuestDialogue();
  }
}

async function leaveGasthaus() {
  if (locationState.current !== LOCATION_GASTHAUS || locationState.transitioning) {
    return;
  }

  await runTransition('Dorf Grünbach', async () => {
    setFeaturePanel(walletPanel, false);
    setFeaturePanel(dorfbuchPanel, false);
    setLocation(LOCATION_VILLAGE);
    agent.position.copy(snapToNpcGround(GASTHAUS_RETURN_POINT));
    lookYaw = Math.atan2(GASTHAUS_DOOR_POINT.x - agent.position.x, GASTHAUS_DOOR_POINT.z - agent.position.z);
    lookPitch = -0.08;
    agent.yaw = lookYaw;
    if (questThreeState.readyForBerta) {
      setQuestThreeStatus('вернитесь к Berta вечером');
    } else if (questThreeState.unlocked && !questThreeState.completed) {
      setQuestThreeStatus('заполните Dorfbuch');
    } else {
      setQuestStatus(gasthausQuest.completed ? 'Квест выполнен: Das Gasthaus' : 'Квест: Der Wachmann');
    }
  });
}

async function enterBakery() {
  if (locationState.current === LOCATION_BAKERY || locationState.transitioning || !bakeryQuestState.unlocked) {
    return;
  }

  await runTransition('Bäckerei', async () => {
    await ensureBakeryLoaded();
    setLocation(LOCATION_BAKERY);
    agent.position.copy(BAKERY_PLAYER_SPAWN);
    agent.eyeHeight = BAKERY_PLAYER_EYE_HEIGHT;

    const hans = getBakeryHans();
    lookYaw = hans
      ? Math.atan2(hans.root.position.x - agent.position.x, hans.root.position.z - agent.position.z)
      : Math.PI;
    agent.yaw = lookYaw;
    lookPitch = -0.06;
    setBakeryStatus('sprich mit Hans');
    renderBakeryChips(hans);
  });

  if (!locationState.bakeryPrompted) {
    locationState.bakeryPrompted = true;
    await openBakeryDialogue(getBakeryHans());
  }
}

async function leaveBakery() {
  if (locationState.current !== LOCATION_BAKERY || locationState.transitioning) {
    return;
  }

  await runTransition('Dorf Grünbach', async () => {
    setFeaturePanel(dorfbuchPanel, false);
    setLocation(LOCATION_VILLAGE);
    agent.position.copy(snapToNpcGround(BAKERY_RETURN_POINT));
    agent.eyeHeight = PLAYER_EYE_HEIGHT;
    lookYaw = Math.atan2(BAKERY_DOOR_POINT.x - agent.position.x, BAKERY_DOOR_POINT.z - agent.position.z);
    lookPitch = -0.08;
    agent.yaw = lookYaw;
    setBakeryStatus(bakeryQuestState.completed ? 'abgeschlossen' : 'hilf Hans in der Bäckerei');
  });
}

function leaveCurrentLocation() {
  if (locationState.current === LOCATION_GASTHAUS) {
    leaveGasthaus();
    return;
  }

  if (locationState.current === LOCATION_BAKERY) {
    leaveBakery();
  }
}

function clampGasthausPoint(point) {
  return new THREE.Vector3(
    THREE.MathUtils.clamp(point.x, GASTHAUS_BOUNDS.minX, GASTHAUS_BOUNDS.maxX),
    GASTHAUS_BOUNDS.y,
    THREE.MathUtils.clamp(point.z, GASTHAUS_BOUNDS.minZ, GASTHAUS_BOUNDS.maxZ),
  );
}

function clampBakeryPoint(point) {
  return new THREE.Vector3(
    THREE.MathUtils.clamp(point.x, BAKERY_BOUNDS.minX, BAKERY_BOUNDS.maxX),
    BAKERY_BOUNDS.y,
    THREE.MathUtils.clamp(point.z, BAKERY_BOUNDS.minZ, BAKERY_BOUNDS.maxZ),
  );
}

function clampCurrentInteriorPoint(point) {
  return locationState.current === LOCATION_BAKERY ? clampBakeryPoint(point) : clampGasthausPoint(point);
}

// Standing camera height for the current location: the bakery is a real-scale
// interior, everywhere else the player matches the 2.3-unit villagers.
function standingEyeHeight() {
  return locationState.current === LOCATION_BAKERY ? BAKERY_PLAYER_EYE_HEIGHT : PLAYER_EYE_HEIGHT;
}

function moveDirectlyToPoint(point, pendingAction = null, pendingNpcAction = null) {
  const destination = clampCurrentInteriorPoint(point);

  if (agent.position.distanceToSquared(destination) < 0.16) {
    finishArrival(pendingAction, destination, pendingNpcAction);
    return;
  }

  agent.path = [agent.position.clone(), destination];
  agent.pathIndex = 1;
  agent.pendingAction = pendingAction;
  agent.pendingNpcAction = pendingNpcAction;
  agent.pendingArrivalPoint = destination.clone();
  setStatus(locationState.current === LOCATION_BAKERY ? 'Иду по Bäckerei' : 'Иду по Gasthaus', 'ready');
}

function findGasthausAction(object) {
  let current = object;

  while (current) {
    if (current.userData?.gasthausAction) {
      return current.userData.gasthausAction;
    }

    current = current.parent;
  }

  return '';
}

function handleGasthausAction(action) {
  if (!action) {
    return false;
  }

  if (action === 'wallet') {
    openWalletPanel();
    return true;
  }

  if (action === 'menu') {
    gasthausQuest.menuRead = true;
    renderDorfbuch();
    setStatus('Menü: Brot 2, Suppe 3, Bier 4', 'ready');
    return true;
  }

  if (action.startsWith('room:')) {
    handleGasthausRoom(action.slice(5));
    return true;
  }

  return false;
}

function findBakeryAction(object) {
  let current = object;

  while (current) {
    if (current.userData?.bakeryAction) {
      return current.userData.bakeryAction;
    }

    current = current.parent;
  }

  return '';
}

function bakeryActionName(action) {
  return (
    {
      wash_hands: 'die Hände',
      flour: 'das Mehl',
      water: 'das Wasser',
      dough: 'den Teig',
      oven: 'den Ofen',
    }[action] || action
  );
}

async function completeBakeryQuest(npc = getBakeryHans()) {
  bakeryQuestState.completed = true;
  bakeryQuestState.active = false;
  bakeryQuestState.stage = 'complete';
  bakeryQuestState.pendingAction = '';
  bakeryQuestState.apprentice = true;
  bakeryQuestState.steps.bread = true;
  gasthausQuest.wallet += 3;
  renderWallet();
  renderDorfbuch();
  renderBakeryChips();
  setBakeryStatus('abgeschlossen');
  await bakerySpeak(
    npc,
    'Der Ofen ist heiss. Das Brot ist fertig. Du kannst backen! Super. Komm morgen wieder - du darfst hier arbeiten.',
    'Quest 05 geschafft. Reward: +3 coins. Статус подмастерья открыт.',
    { intent: 'happy' },
  );
  showSceneHint('Quest 05 fertig: Du darfst in der Bäckerei arbeiten.', 9000);
}

async function completeBakeryAction(action) {
  const npc = getBakeryHans();

  if (!bakeryQuestState.pendingAction) {
    if (action === 'note') {
      await showBakeryHelp(npc);
      return true;
    }

    if (action === 'dough' && !bakeryQuestState.steps.permission) {
      await bakerySpeak(npc, 'Halt! Fragen! Sag: Darf ich?', 'Сначала спроси разрешение.', {
        intent: 'thinking',
        lesson: 'bakeryPermission',
      });
      return true;
    }

    await bakerySpeak(npc, 'Sprich zuerst. Dann arbeiten.', 'Сначала скажи фразу Hans.', {
      intent: 'helpful',
    });
    return true;
  }

  if (action !== bakeryQuestState.pendingAction) {
    await bakerySpeak(npc, `Noch nicht. Erst: ${bakeryActionName(bakeryQuestState.pendingAction)}.`, 'Не тот объект.', {
      intent: 'thinking',
    });
    return true;
  }

  bakeryQuestState.pendingAction = '';

  if (bakeryQuestState.stage === 'wash_action') {
    bakeryQuestState.steps.washHands = true;
    bakeryQuestState.stage = 'flour_phrase';
    renderDorfbuch();
    renderBakeryChips();
    setBakeryStatus('Mehl holen');
    await bakerySpeak(npc, 'Gut. Die Hände sind sauber. Kannst du das Mehl holen?', 'Руки чистые. Теперь мука.', {
      intent: 'happy',
      lesson: 'bakeryFlour',
    });
    return true;
  }

  if (bakeryQuestState.stage === 'flour_action') {
    bakeryQuestState.steps.flour = true;
    bakeryQuestState.stage = 'water_phrase';
    renderDorfbuch();
    renderBakeryChips();
    setBakeryStatus('Wasser bringen');
    await bakerySpeak(npc, 'Sehr gut. Jetzt brauchen wir Wasser. Was musst du bringen?', 'Теперь нужна вода.', {
      intent: 'helpful',
      lesson: 'bakeryWater',
    });
    return true;
  }

  if (bakeryQuestState.stage === 'water_action') {
    bakeryQuestState.steps.water = true;
    bakeryQuestState.stage = 'permission';
    renderDorfbuch();
    renderBakeryChips();
    setBakeryStatus('frage: Darf ich?');
    await bakerySpeak(npc, 'Gut. Mehl und Wasser sind da. Willst du den Teig kneten? Frag zuerst: Darf ich?', 'Перед тестом спроси разрешение.', {
      intent: 'helpful',
      lesson: 'bakeryPermission',
    });
    return true;
  }

  if (bakeryQuestState.stage === 'dough_action') {
    bakeryQuestState.steps.dough = true;
    bakeryQuestState.stage = 'free_sequence';
    bakeryQuestState.finalSequenceSpoken = false;
    renderDorfbuch();
    renderBakeryChips();
    setBakeryStatus('freie Reihenfolge');
    await bakerySpeak(
      npc,
      'Gut geknetet. Jetzt ohne Chips. Sag drei Saetze: Ich muss das Mehl holen. Ich muss den Teig kneten. Ich will Brot backen.',
      'Финал без chips: скажи три предложения.',
      { intent: 'helpful', lesson: 'bakeryFinal' },
    );
    return true;
  }

  if (bakeryQuestState.stage === 'order_flour_action') {
    bakeryQuestState.steps.orderFlour = true;

    if (bakeryQuestState.finalSequenceSpoken) {
      setBakeryPendingAction('order_dough_action', 'dough', 'dann Teig');
      await bakerySpeak(npc, 'Dann: Knete den Teig.', 'Теперь кликни тесто.', { intent: 'helpful' });
      return true;
    }

    bakeryQuestState.stage = 'order_dough_phrase';
    renderDorfbuch();
    renderBakeryChips();
    setBakeryStatus('dann Teig');
    await bakerySpeak(npc, 'Dann? Sag den naechsten Satz.', 'Скажи следующий шаг.', { intent: 'helpful' });
    return true;
  }

  if (bakeryQuestState.stage === 'order_dough_action') {
    bakeryQuestState.steps.orderDough = true;

    if (bakeryQuestState.finalSequenceSpoken) {
      setBakeryPendingAction('bake_action', 'oven', 'Brot backen');
      await bakerySpeak(npc, 'Dann: Brot backen. Klick den Ofen.', 'Теперь кликни печь.', { intent: 'helpful' });
      return true;
    }

    bakeryQuestState.stage = 'bake_phrase';
    renderDorfbuch();
    renderBakeryChips();
    setBakeryStatus('Brot backen');
    await bakerySpeak(npc, 'Und jetzt? Sag den letzten Satz.', 'Скажи последний шаг.', { intent: 'helpful' });
    return true;
  }

  if (bakeryQuestState.stage === 'bake_action') {
    await completeBakeryQuest(npc);
    return true;
  }

  return true;
}

function handleBakeryAction(action) {
  if (!action) {
    return false;
  }

  completeBakeryAction(action).catch((error) => {
    console.error(error);
    setStatus(error.message || 'Bakery action failed', 'error');
  });
  return true;
}

function handleGasthausCanvasClick(event) {
  if (!gasthausRoot || isUiTarget(event.target)) {
    return;
  }

  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);

  // Placement tool: click the floor to drop the selected character there.
  if (isNpcToolPlacing()) {
    const floorHits = raycaster.intersectObject(gasthausRoot, true);

    if (floorHits.length && placeSelectedNpcAt(floorHits[0].point.clone())) {
      return;
    }
  }

  const npcHits = raycaster.intersectObjects(
    npcs.filter((npc) => isGasthausNpc(npc)).map((npc) => npc.root),
    true,
  );

  if (npcHits.length) {
    const npc = getNpcFromObject(npcHits[0].object);

    if (npc) {
      setSelectedNpc(npc);
      moveDirectlyToPoint(getNpcApproachPoint(npc), null, `talk:${npc.id}`);
      return;
    }
  }

  const hits = raycaster.intersectObject(gasthausRoot, true);

  if (!hits.length) {
    return;
  }

  const action = findGasthausAction(hits[0].object);

  if (action) {
    const point = hits[0].point.clone();
    moveDirectlyToPoint(point, action, null);
    return;
  }

  moveDirectlyToPoint(hits[0].point);
}

function handleBakeryCanvasClick(event) {
  if (!bakeryRoot || isUiTarget(event.target)) {
    return;
  }

  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);

  const npcHits = raycaster.intersectObjects(
    npcs.filter((npc) => isBakeryNpc(npc)).map((npc) => npc.root),
    true,
  );

  if (npcHits.length) {
    const npc = getNpcFromObject(npcHits[0].object);

    if (npc) {
      setSelectedNpc(npc);
      moveDirectlyToPoint(getNpcApproachPoint(npc), null, `talk:${npc.id}`);
      return;
    }
  }

  const hits = raycaster.intersectObject(bakeryRoot, true);

  if (!hits.length) {
    return;
  }

  const action = findBakeryAction(hits[0].object);

  if (action) {
    const point = hits[0].point.clone();
    moveDirectlyToPoint(point, action, null);
    return;
  }

  moveDirectlyToPoint(hits[0].point);
}

function updateLocationTriggers() {
  if (
    locationState.current !== LOCATION_VILLAGE ||
    locationState.transitioning ||
    isPlayerHeldByGuard() ||
    !questState.completed
  ) {
    return;
  }

  // Trigger only at the actual door. The target approach point is kept within
  // this radius, so clicking "Gasthaus" still walks right to the entrance.
  if (agent.position.distanceToSquared(GASTHAUS_DOOR_POINT) <= GASTHAUS_ENTRY_RADIUS * GASTHAUS_ENTRY_RADIUS) {
    enterGasthaus();
    return;
  }

  if (
    bakeryQuestState.unlocked &&
    agent.position.distanceToSquared(BAKERY_DOOR_POINT) <= BAKERY_ENTRY_RADIUS * BAKERY_ENTRY_RADIUS
  ) {
    enterBakery();
  }
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
    ...npcs.filter(isNpcActiveForLocation).flatMap((npc) => [npc.id, npc.label, ...(npc.aliases || [])]),
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
  const npc = selectedNpc || nearbyNpc || getNearestNpc() || npcs.find(isNpcActiveForLocation) || null;
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
    model.scale.multiplyScalar(NPC_TARGET_HEIGHT / height);
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
      // Deep, authoritative voice no other NPC uses, so the Wachmann is
      // clearly distinct from Bäcker Hans (antoni) and the villagers.
      voiceId: ELEVENLABS_VOICES.arnold,
      idleKeywords: ['idle default beliner', 'idle default', 'standing idle'],
      aliases: [QUEST_GUARD_LABEL, 'bruno', 'guard', 'wachmann', 'wache', 'стражник', 'охранник'],
      homeTargetIds: [],
      stationary: true,
      // Scope the guard to the village so his marker and updates never leak
      // into the Gasthaus interior (a separate location).
      location: LOCATION_VILLAGE,
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
    stationary: true,
    location: LOCATION_VILLAGE,
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

  if (npc.location === LOCATION_GASTHAUS) {
    return clampGasthausPoint(candidates[0] || center);
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
    // Overscale slightly for the stylized tavern so counters land around the
    // torso instead of swallowing the character at neck height. Interiors at
    // real-life scale (the bakery) set npc.targetHeight to stay human-sized.
    const scale = (npc.targetHeight || NPC_TARGET_HEIGHT) / height;
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
  // skeleton, so any external clip would leave him in a T-pose. Keep him - and
  // the idle-locked tavern characters - in their bound idle/seated loop no
  // matter which gesture is requested.
  if ((isQuestGuard(npc) || npc.lockIdle) && !options.allowQuestGuardExternal) {
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

// For real character GLBs with no bindable idle clip: pose the arms down out of
// the Mixamo T-pose and add a gentle breathing sway. No-op when a real idle
// animation exists.
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

  if (isGasthausNpc(npc)) {
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
  applyNpcOverrideToRoot(slot.id, root);
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
  if (hasNpcPlacementOverride(npc.id)) {
    applyNpcOverrideToNpc(npc);
    syncNpcTarget(npc);
  } else {
    placeNpcOnNavmesh(npc, index, total);
  }
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
      QUEST_GUARD_MODEL_DEFAULT_URL;
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

  if (questThreeState.unlocked) {
    await ensureQuestThreeNpcs();
  }

  if (marketQuestState.unlocked) {
    await ensureMarketNpcs();
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

  for (const point of npc.patrolPoints || []) {
    addCandidate(point);
  }

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
    // Seated guests keep their fixed orientation; turning a sitting body to
    // track the player looks like sliding. Also freeze facing while the
    // placement tool is open so the yaw you set actually holds.
    if (!npc.seated && !npc.manualPlacementLocked && !isNpcToolOpen()) {
      faceNpcToAgent(npc, Math.min(deltaTime * 8, 1));
    }

    return;
  }

  if (npc.manualPlacementLocked && !npc.scriptedMovement) {
    npc.path = [];
    npc.pathIndex = 0;
    npc.waitTimer = 999;
    npc.state = 'idle';
    playNpcIdle(npc);
    return;
  }

  if ((npc.stationary || !NPC_AUTONOMOUS_PATROL_ENABLED) && !npc.scriptedMovement) {
    npc.path = [];
    npc.pathIndex = 0;
    npc.waitTimer = 999;
    npc.state = 'idle';

    if (
      !npc.seated &&
      isQuestGuard(npc) &&
      !isNpcToolOpen() &&
      npc.root.position.distanceToSquared(agent.position) <= QUEST_TRIGGER_ALERT * QUEST_TRIGGER_ALERT
    ) {
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
    if (!isNpcActiveForLocation(npc)) {
      continue;
    }

    npc.mixer?.update(deltaTime);

    if (npc.groundBiasDirty && !npc.seated) {
      calibrateNpcGroundBias(npc);
      npc.groundBiasDirty = false;
    }

    updateProceduralIdle(npc, now);

    // Seated characters are grounded once at spawn; re-grounding every frame
    // would fight the sitting animation's hip motion and make them bob.
    if (!npc.seated) {
      refitNpcToGround(npc);
    }

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

  // Mirror the active quest into the top-left location HUD.
  if (hudQuestLabel) {
    hudQuestLabel.textContent = message;
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

      if (chip.action === 'market-list') {
        showMarketList();
        return;
      }

      if (chip.action === 'market-help') {
        showMarketHelp();
        return;
      }

      if (chip.action === 'bakery-help') {
        showBakeryHelp();
        return;
      }

      if (chip.action === 'help') {
        if (isMarketHans(selectedNpc) || isMarketNpc(selectedNpc)) {
          showMarketHelp(selectedNpc);
          return;
        }

        if (isGasthausNpc(selectedNpc)) {
          showGasthausHelp();
          return;
        }

        if (isQuestThreeNpc(selectedNpc)) {
          renderQuestThreeChips(selectedNpc);
          questThreeSpeak(selectedNpc, 'Frag: Wer bist du? Was machst du? Wo wohnst du?', 'Спроси: кто ты? что делаешь? где живёшь?', {
            intent: 'helpful',
          });
          return;
        }

        showQuestHelp();
        return;
      }

      if (chip.action === 'open-wallet') {
        openWalletPanel();
        return;
      }

      if (chip.action === 'open-dorfbuch') {
        openDorfbuchPanel();
        return;
      }

      if (chip.action === 'room') {
        handleGasthausRoom(chip.room);
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

function getRussianLessonText(options = {}) {
  if (options.skipRuIntro) {
    return '';
  }

  if (options.ruIntro) {
    return String(options.ruIntro).trim();
  }

  if (options.lesson) {
    return RUSSIAN_LESSON_EXPLANATIONS[options.lesson] || '';
  }

  return '';
}

function shouldSpeakRussianLesson(options = {}, text = '') {
  if (!text) {
    return false;
  }

  const key = options.lesson || `inline:${text}`;

  if (!options.forceRuIntro && spokenRussianLessonKeys.has(key)) {
    return false;
  }

  spokenRussianLessonKeys.add(key);
  return true;
}

async function speakRussianLesson(npc, options = {}) {
  const text = getRussianLessonText(options);

  if (!npc || !shouldSpeakRussianLesson(options, text)) {
    return 0;
  }

  appendDialogue(npc, 'npc', text);
  setQuestSpeechLine(text, 'Русское объяснение перед новым материалом');
  faceNpcToAgent(npc, 1);
  playNpcDialogueAnimation(npc, { animationIntent: options.intent || 'helpful' });

  const duration =
    (await npc.mouth?.speak(text, {
      voiceId: options.ruVoiceId || ELEVENLABS_VOICES.russianNarrator,
      lang: 'ru-RU',
      rate: options.ruRate ?? 0.78,
      pitch: options.ruPitch ?? 1,
      volume: options.ruVolume ?? 0.92,
    })) || Math.min(9, Math.max(1.4, text.length * 0.045));

  npc.state = 'talking';
  npc.talkUntil = performance.now() / 1000 + duration + 0.15;
  await waitFor(Math.min(10000, Math.max(1000, duration * 1000 + 180)));
  return duration;
}

async function speakQuestLine(npc, de, ru = '', options = {}) {
  if (!npc) {
    return 0;
  }

  const lessonDuration = await speakRussianLesson(npc, options);

  if (options.append !== false) {
    appendDialogue(npc, 'npc', de);
  }

  setQuestSpeechLine(de, ru);
  faceNpcToAgent(npc, 1);
  playNpcDialogueAnimation(npc, { animationIntent: options.intent || 'talk' });

  const audioReady = isGameAudioUnlocked();
  const duration =
    (await npc.mouth?.speak(de, {
      voiceId: npc.voiceId,
      lang: options.lang || 'de-DE',
      rate: options.rate,
      pitch: options.pitch,
      volume: options.volume ?? 0.9,
    })) ||
    Math.min(7, Math.max(1.2, de.length * 0.06));

  if (!audioReady && options.showAudioHint !== false) {
    setStatus('Кликните по игре или нажмите Enter: включим звук NPC без лишних TTS-запросов', 'ready');
  }

  npc.state = 'talking';
  npc.talkUntil = performance.now() / 1000 + duration + 0.2;
  return lessonDuration + duration;
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
    lesson: 'guardGreeting',
  });
}

function repeatQuestPrompt() {
  if (isMarketHans(selectedNpc) || isMarketNpc(selectedNpc)) {
    const npc = selectedNpc;

    if (questState.currentLine) {
      marketSpeak(npc, questState.currentLine.de, questState.currentLine.ru, {
        append: false,
        intent: 'thinking',
      });
    }

    return;
  }

  if (isQuestThreeNpc(selectedNpc)) {
    const npc = selectedNpc;

    if (questState.currentLine) {
      questThreeSpeak(npc, questState.currentLine.de, questState.currentLine.ru, {
        append: false,
        intent: 'thinking',
      });
    }

    return;
  }

  if (isGasthausNpc(selectedNpc)) {
    const npc = selectedNpc;

    if (questState.currentLine) {
      gasthausSpeak(npc, questState.currentLine.de, questState.currentLine.ru, {
        append: false,
        intent: 'thinking',
      });
    }

    return;
  }

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
  showSceneHint('Иди в центр деревни и отдохни в Gasthaus', 9000);
  npc.afterTalk = () => {
    startQuestGuardOpenMove(npc);
  };
  speakQuestLine(npc, 'Komm rein! Müde? Geh ins Gasthaus.', 'Заходи! Устал? Иди в гостиницу.', { intent: 'happy' });
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
    speakQuestLine(npc, de, ru, { intent: 'thankful', lesson: 'guardOrigin' });
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
  return locationState.current === LOCATION_VILLAGE && QUEST_ENABLED && questState.halted && !questState.completed;
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

  if (locationState.current !== LOCATION_VILLAGE || !QUEST_ENABLED || !npc || questState.completed) {
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
    if (!isNpcActiveForLocation(npc)) {
      continue;
    }

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
    if (!isNpcActiveForLocation(npc)) {
      continue;
    }

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

  if (
    ((isQuestGuard(target) && !questState.completed) ||
      isGasthausNpc(target) ||
      isBakeryHans(target) ||
      isMarketHans(target) ||
      isMarketNpc(target) ||
      isQuestThreeNpc(target)) &&
    questState.currentLine
  ) {
    renderQuestSpeechLine();
    interactNpcButton.disabled = false;
    dialogueInput.disabled = false;
    dialogueSubmit.disabled = false;
    return;
  }

  const keepsQuestChips =
    (isQuestGuard(target) && !questState.completed) ||
    isGasthausNpc(target) ||
    isBakeryHans(target) ||
    isMarketHans(target) ||
    isMarketNpc(target) ||
    isQuestThreeNpc(target);

  if (!keepsQuestChips) {
    renderQuestChips([]);
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
  // so keep him - and the idle-locked tavern characters - in their reliable
  // idle/seated loop and let the lips carry the talking.
  if (isQuestGuard(npc) || npc.lockIdle) {
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

  if (isGasthausNpc(npc) && locationState.current === LOCATION_GASTHAUS) {
    if (npc.id === 'frau_berta') {
      openGasthausQuestDialogue();
      return;
    }

    setSelectedNpc(npc, options);
    renderQuestChips([
      ...(questThreeState.readyForBerta && !questThreeState.bertaRewarded
        ? [{ label: 'Ich spreche mit Berta', submit: 'Ich spreche mit Berta' }]
        : []),
      { label: 'Ja', submit: 'Ja' },
      { label: 'Nein', submit: 'Nein' },
      { label: 'Prost!', submit: 'Prost!' },
    ]);
    gasthausSpeak(npc, 'Hallo! Schönes Dorf, ja?', 'Привет! Красивая деревня, да?', {
      intent: 'greeting',
    });
    return;
  }

  if (isBakeryHans(npc) && locationState.current === LOCATION_BAKERY) {
    openBakeryDialogue(npc);
    return;
  }

  if (isMarketHans(npc) && locationState.current === LOCATION_VILLAGE) {
    openMarketHansDialogue(npc);
    return;
  }

  if (isMarketNpc(npc) && locationState.current === LOCATION_VILLAGE && marketQuestState.unlocked) {
    openMarketMerchantDialogue(npc);
    return;
  }

  if (isQuestThreeNpc(npc) && locationState.current === LOCATION_VILLAGE && questThreeState.unlocked) {
    openQuestThreeDialogue(npc);
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

  if (isGasthausNpc(npc) && locationState.current === LOCATION_GASTHAUS) {
    sendGasthausDialogueToNpc(npc, line);
    return;
  }

  if (isBakeryHans(npc) && locationState.current === LOCATION_BAKERY) {
    sendBakeryDialogueToNpc(npc, line);
    return;
  }

  if (isMarketHans(npc) && locationState.current === LOCATION_VILLAGE) {
    sendMarketHansDialogueToNpc(npc, line);
    return;
  }

  if (isMarketNpc(npc) && locationState.current === LOCATION_VILLAGE && marketQuestState.unlocked) {
    sendMarketDialogueToNpc(npc, line);
    return;
  }

  if (isQuestThreeNpc(npc) && locationState.current === LOCATION_VILLAGE && questThreeState.unlocked) {
    sendQuestThreeDialogueToNpc(npc, line);
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
      (await npc.mouth?.speak(reply, {
        voiceId: npc.voiceId,
        lang: 'de-DE',
        volume: 0.9,
      })) ||
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
const MIC_MIN_AUDIBLE_LEVEL = 0.012;
const MIC_WARN_LEVEL = 0.025;

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
  selectedDeviceId: '',
  inputDevices: [],
  audioContext: null,
  audioSource: null,
  analyser: null,
  levelData: null,
  levelTimer: null,
  maxInputLevel: 0,
  warnedQuietInput: false,
  recordingStartedAt: 0,
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

function setMicLevel(level) {
  const clamped = Math.max(0, Math.min(1, Number(level) || 0));

  if (micMeter) {
    micMeter.hidden = dictation.state !== 'recording' && clamped <= 0;
  }

  if (micMeterBar) {
    micMeterBar.style.setProperty('--mic-level', `${Math.round(clamped * 100)}%`);
  }
}

function getSelectedMicLabel() {
  const selected = dictation.inputDevices.find((device) => device.deviceId === dictation.selectedDeviceId);
  return selected?.label || micDeviceSelect?.selectedOptions?.[0]?.textContent || '';
}

async function refreshMicDevices() {
  if (!micDeviceSelect || !navigator.mediaDevices?.enumerateDevices) {
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput');
    dictation.inputDevices = inputs;
    micDeviceSelect.replaceChildren();

    if (inputs.length <= 1) {
      micDeviceSelect.hidden = true;
      return;
    }

    for (let index = 0; index < inputs.length; index += 1) {
      const device = inputs[index];
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Микрофон ${index + 1}`;
      micDeviceSelect.append(option);
    }

    const hasSelected = inputs.some((device) => device.deviceId === dictation.selectedDeviceId);
    if (!hasSelected) {
      dictation.selectedDeviceId = inputs[0]?.deviceId || '';
    }

    micDeviceSelect.value = dictation.selectedDeviceId;
    micDeviceSelect.hidden = false;
  } catch (error) {
    console.warn('Could not enumerate microphones:', error);
  }
}

function getMicConstraints() {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (dictation.selectedDeviceId) {
    audio.deviceId = { exact: dictation.selectedDeviceId };
  }

  return { audio };
}

function stopMicMonitor() {
  if (dictation.levelTimer) {
    clearInterval(dictation.levelTimer);
    dictation.levelTimer = null;
  }

  dictation.audioSource?.disconnect?.();
  dictation.audioSource = null;
  dictation.analyser = null;
  dictation.levelData = null;

  if (dictation.audioContext?.state !== 'closed') {
    dictation.audioContext?.close?.().catch(() => {});
  }

  dictation.audioContext = null;
  setMicLevel(0);
}

async function startMicMonitor(stream) {
  stopMicMonitor();
  dictation.maxInputLevel = 0;
  dictation.warnedQuietInput = false;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  try {
    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    if (context.state === 'suspended') {
      await context.resume().catch(() => {});
    }

    dictation.audioContext = context;
    dictation.audioSource = source;
    dictation.analyser = analyser;
    dictation.levelData = new Uint8Array(analyser.fftSize);

    dictation.levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(dictation.levelData);

      let sum = 0;
      let peak = 0;

      for (let index = 0; index < dictation.levelData.length; index += 1) {
        const value = (dictation.levelData[index] - 128) / 128;
        sum += value * value;
        peak = Math.max(peak, Math.abs(value));
      }

      const rms = Math.sqrt(sum / dictation.levelData.length);
      const level = Math.max(rms * 4, peak * 0.7);
      dictation.maxInputLevel = Math.max(dictation.maxInputLevel, rms, peak * 0.35);
      setMicLevel(level);

      if (!dictation.warnedQuietInput && performance.now() - dictation.recordingStartedAt > 1300 && dictation.maxInputLevel < MIC_WARN_LEVEL) {
        dictation.warnedQuietInput = true;
        const label = getSelectedMicLabel();
        setMicTranscript(
          label
            ? `Микрофон почти молчит (${label}). Проверьте выбранный вход или говорите ближе.`
            : 'Микрофон почти молчит. Проверьте выбранный вход или говорите ближе.',
          'error',
        );
      }
    }, 120);
  } catch (error) {
    console.warn('Could not start microphone level meter:', error);
  }
}

function stopMicStream() {
  if (dictation.stream) {
    for (const track of dictation.stream.getTracks()) {
      track.stop();
    }

    dictation.stream = null;
  }

  stopMicMonitor();
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
    try {
      dictation.stream = await navigator.mediaDevices.getUserMedia(getMicConstraints());
    } catch (error) {
      if (!dictation.selectedDeviceId) {
        throw error;
      }

      dictation.selectedDeviceId = '';
      micDeviceSelect && (micDeviceSelect.value = '');
      dictation.stream = await navigator.mediaDevices.getUserMedia(getMicConstraints());
    }

    await refreshMicDevices();
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
  dictation.maxInputLevel = 0;
  dictation.recordingStartedAt = performance.now();
  await startMicMonitor(dictation.stream);

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      dictation.chunks.push(event.data);
    }
  };

  recorder.onstop = async () => {
    const maxInputLevel = dictation.maxInputLevel;
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

    if (maxInputLevel < MIC_MIN_AUDIBLE_LEVEL) {
      dictation.state = 'idle';
      updateMicButton();
      const label = getSelectedMicLabel();
      setMicTranscript(
        label
          ? `Микрофон не слышит речь (${label}). Выберите другой микрофон или проверьте разрешение в браузере.`
          : 'Микрофон не слышит речь. Проверьте выбранный микрофон в браузере/системе и повторите.',
        'error',
      );
      setStatus('Микрофон не слышит речь. Проверьте вход и повторите.', 'error');
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
  const viewport = window.visualViewport;
  const width = Math.max(320, Math.floor(viewport?.width || window.innerWidth));
  const height = Math.max(320, Math.floor(viewport?.height || window.innerHeight));

  document.documentElement.style.setProperty('--app-height', `${height}px`);

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

  if (!registry && locationState.current === LOCATION_VILLAGE) {
    return;
  }

  const visibleTargets = [];

  if (locationState.current === LOCATION_VILLAGE && registry) {
    for (const target of registry.targets) {
      if (target.routePoint || target.approachPoint || target.center) {
        targetMarkers.add(createMarker(target));
      }
    }

    visibleTargets.push(...registry.getVisibleTargets());
  }

  for (const npc of npcs.filter(isNpcActiveForLocation)) {
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

    agent.eyeHeight = PLAYER_EYE_HEIGHT;
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

  registry = new WorldRegistry(cityRoot, getRegistryCustomTargets(), deletedTargetIds, {
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
    agent.eyeHeight = PLAYER_EYE_HEIGHT;
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

  if (action === 'enter_gasthaus') {
    enterGasthaus();
    return;
  }

  if (action === 'enter_bakery') {
    enterBakery();
    return;
  }

  if (locationState.current === LOCATION_GASTHAUS && handleGasthausAction(action)) {
    return;
  }

  if (locationState.current === LOCATION_BAKERY && handleBakeryAction(action)) {
    return;
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
    agent.eyeHeight = PLAYER_SEATED_EYE_HEIGHT;
    setStatus('Сел на Stuhl', 'ready');
    return;
  }

  agent.eyeHeight = standingEyeHeight();
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
      registry = new WorldRegistry(cityRoot, getRegistryCustomTargets(), deletedTargetIds, {
        includeBuiltInTargets: !QUEST_ENABLED,
        includeSceneTargets: !QUEST_ENABLED,
      });
    }

    registry.setCustomTargets(getRegistryCustomTargets());
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
  if (!target) {
    return;
  }

  if (locationState.current === LOCATION_GASTHAUS || locationState.current === LOCATION_BAKERY) {
    if (target.source === 'npc') {
      const npc = getNpcForTargetId(target.id);

      if (npc) {
        setSelectedNpc(npc);
        moveDirectlyToPoint(target.routePoint || target.approachPoint || target.center, null, `talk:${npc.id}`);
        return;
      }
    }

    moveDirectlyToPoint(target.routePoint || target.approachPoint || target.center, target.action);
    return;
  }

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

  agent.eyeHeight += (standingEyeHeight() - agent.eyeHeight) * Math.min(deltaTime * 5, 1);
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
  updateLocationTriggers();
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function isUiTarget(target) {
  return Boolean(target.closest?.('.panel, .location-hud, .transition-overlay'));
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
  if (locationState.current === LOCATION_GASTHAUS) {
    handleGasthausCanvasClick(event);
    return;
  }

  if (locationState.current === LOCATION_BAKERY) {
    handleBakeryCanvasClick(event);
    return;
  }

  if (!cityRoot || !navigation || isUiTarget(event.target)) {
    return;
  }

  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);

  // Placement tool: click the ground to drop the selected character there.
  if (isNpcToolPlacing()) {
    const floorHits = raycaster.intersectObject(cityRoot, true);

    if (floorHits.length && placeSelectedNpcAt(floorHits[0].point.clone())) {
      return;
    }
  }

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

  if (micDeviceSelect) {
    micDeviceSelect.addEventListener('change', () => {
      dictation.selectedDeviceId = micDeviceSelect.value;
      const label = getSelectedMicLabel();
      setMicTranscript(label ? `Выбран микрофон: ${label}` : '');
    });

    refreshMicDevices();
  }

  navigator.mediaDevices?.addEventListener?.('devicechange', refreshMicDevices);

  exitLocationButton?.addEventListener('click', leaveCurrentLocation);
  dorfbuchOpenButton?.addEventListener('click', openDorfbuchPanel);
  dorfbuchCloseButton?.addEventListener('click', () => setFeaturePanel(dorfbuchPanel, false));
  walletOpenButton?.addEventListener('click', openWalletPanel);
  walletCloseButton?.addEventListener('click', () => setFeaturePanel(walletPanel, false));
  coinResetButton?.addEventListener('click', resetGasthausCoins);
  coinPayButton?.addEventListener('click', submitGasthausPayment);

  npcToolOpenButton?.addEventListener('click', openNpcTool);
  npcToolCloseButton?.addEventListener('click', () => setFeaturePanel(npcToolPanel, false));
  npcToolSelect?.addEventListener('change', () => {
    npcToolSelectedId = npcToolSelect.value;
    refreshNpcToolCoords();
  });
  npcToolStepInput?.addEventListener('input', () => {
    if (npcToolStepValue) {
      npcToolStepValue.value = Number(npcToolStepInput.value).toFixed(2);
    }
  });
  npcToolExportButton?.addEventListener('click', exportNpcPositions);
  npcToolResetButton?.addEventListener('click', resetSelectedNpcOverride);

  for (const button of npcToolPanel?.querySelectorAll('[data-npc-move]') || []) {
    button.addEventListener('click', () => moveSelectedNpc(button.dataset.npcMove));
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
      setFeaturePanel(walletPanel, false);
      setFeaturePanel(dorfbuchPanel, false);
      setFeaturePanel(npcToolPanel, false);

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
window.visualViewport?.addEventListener('resize', resize);
window.visualViewport?.addEventListener('scroll', resize);
resize();
setupInputEvents();
cutRadiusValue.value = Number(cutRadiusInput.value || 3).toFixed(1);
targetMarkers.visible = toggleTargets.checked;
renderNavAreaBlocks();
updateLocationHud();
renderWallet();
renderDorfbuch();
loadCity();
animate();
