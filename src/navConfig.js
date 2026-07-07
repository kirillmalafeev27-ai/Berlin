export const NAV_KINDS = Object.freeze({
  WALKABLE: 'walkable',
  BLOCKER: 'blocker',
  DECOR: 'decor',
});

export const NAVMESH_CONFIG = Object.freeze({
  includeBlockers: false,
  includeDecorSurfaces: false,
  blockerMode: 'walkable-surfaces',
  cs: 0.24,
  ch: 0.2,
  walkableRadius: 1,
  walkableHeight: 9,
  walkableClimb: 2,
  walkableSlopeAngle: 55,
  maxEdgeLen: 48,
  maxSimplificationError: 1.25,
  minRegionArea: 6,
  mergeRegionArea: 42,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 1,
  buildBvTree: true,
});

const DEFAULT_KIND_BY_NAME = new Map([
  ['Mesh_0', NAV_KINDS.WALKABLE],
  ['Mesh_0_1', NAV_KINDS.WALKABLE],
  ['Mesh_0_2', NAV_KINDS.WALKABLE],
  ['Mesh_0_3', NAV_KINDS.WALKABLE],
  ['Mosche', NAV_KINDS.BLOCKER],
  ['Döner', NAV_KINDS.BLOCKER],
  ['das Haus gegenüber dem Café', NAV_KINDS.BLOCKER],
  ['das_Haus_gegenüber_dem_Café', NAV_KINDS.BLOCKER],
  ['Mesh_0.025', NAV_KINDS.BLOCKER],
  ['Mesh_0.019', NAV_KINDS.BLOCKER],
  ['Mesh_0.061', NAV_KINDS.BLOCKER],
  ['Mesh_0.063', NAV_KINDS.BLOCKER],
  ['Mesh_0.064', NAV_KINDS.BLOCKER],
  ['Mesh_0.066', NAV_KINDS.BLOCKER],
  ['Mesh_0.073', NAV_KINDS.BLOCKER],
  ['Mesh_0.088', NAV_KINDS.BLOCKER],
  ['Mesh_0.095', NAV_KINDS.BLOCKER],
  ['Mesh_0.098', NAV_KINDS.BLOCKER],
  ['Mesh_0.023', NAV_KINDS.BLOCKER],
  ['Куб', NAV_KINDS.DECOR],
]);

const DEFAULT_KIND_BY_NORMALIZED_NAME = new Map(
  [...DEFAULT_KIND_BY_NAME.entries()].map(([name, kind]) => [normalizeText(name), kind]),
);

const DECOR_HINTS = [
  'stuhl',
  'chair',
  'bank',
  'bench',
  'lampe',
  'laterne',
  'baum',
  'tree',
  'auto',
  'car',
  'mull',
  'müll',
];

const FANTASY_WALKABLE_HINTS = [
  'outer market ring path',
  'plaza edge path',
  'central plaza',
  'river bridge deck',
  'river bridge plank',
  'issum detail yard paver',
  'hilltop gazebo platform',
];

const FANTASY_WALKABLE_MATERIAL_HINTS = [
  'warm sand path',
  'plaza light stone',
  'plaza dark joint',
];

export function getObjectNavName(object) {
  return (
    object.userData?.navName ||
    object.userData?.name ||
    object.name ||
    object.geometry?.name ||
    object.uuid
  );
}

function getObjectMaterialNames(object) {
  const materials = Array.isArray(object.material) ? object.material : [object.material];

  return materials
    .map((material) => material?.name)
    .filter(Boolean);
}

export function normalizeText(value) {
  return String(value || '')
    .toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function getDefaultNavKind(object) {
  const explicit = object.userData?.navmesh || object.userData?.navMesh;

  if (Object.values(NAV_KINDS).includes(explicit)) {
    return explicit;
  }

  const name = getObjectNavName(object);
  const normalizedName = normalizeText(name);
  const materialNames = getObjectMaterialNames(object).map(normalizeText);

  if (
    FANTASY_WALKABLE_HINTS.some((hint) => normalizedName.includes(normalizeText(hint))) ||
    FANTASY_WALKABLE_MATERIAL_HINTS.some((hint) =>
      materialNames.some((materialName) => materialName.includes(normalizeText(hint))),
    )
  ) {
    return NAV_KINDS.WALKABLE;
  }

  if (DEFAULT_KIND_BY_NAME.has(name)) {
    return DEFAULT_KIND_BY_NAME.get(name);
  }

  if (DEFAULT_KIND_BY_NORMALIZED_NAME.has(normalizedName)) {
    return DEFAULT_KIND_BY_NORMALIZED_NAME.get(normalizedName);
  }

  if (/^mesh 0 [123]$/.test(normalizedName)) {
    return NAV_KINDS.WALKABLE;
  }

  const looksGeneric = /^mesh(_|\s|$)/i.test(name) || !name;
  const looksDecor = DECOR_HINTS.some((hint) => normalizedName.includes(hint));

  if (looksDecor) {
    return NAV_KINDS.DECOR;
  }

  return looksGeneric ? NAV_KINDS.DECOR : NAV_KINDS.BLOCKER;
}

export function isNavInputKind(kind) {
  return kind === NAV_KINDS.WALKABLE || kind === NAV_KINDS.BLOCKER;
}
