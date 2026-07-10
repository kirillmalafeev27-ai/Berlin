import * as THREE from 'three';
import { normalizeText } from './navConfig.js';
import { BUILT_IN_TARGETS } from './worldObjects.js';

function isGenericName(name) {
  return !name || /^mesh(_|\s|$)/i.test(name);
}

function createIdFromName(name) {
  const normalized = normalizeText(name).replace(/\s+/g, '_');
  return normalized || `target_${Math.random().toString(36).slice(2, 8)}`;
}

function getNamedObjects(scene) {
  const objects = [];

  scene.traverse((object) => {
    if (!object.isMesh && !object.isInstancedMesh) {
      return;
    }

    const name = object.name || object.geometry?.name || '';

    if (!isGenericName(name)) {
      objects.push(object);
    }
  });

  return objects;
}

function findObjectForDefinition(scene, definition) {
  const names = new Set(definition.meshNames || []);
  const normalizedNames = new Set((definition.meshNames || []).map(normalizeText));
  let found = null;

  scene.traverse((object) => {
    if (found || (!object.isMesh && !object.isInstancedMesh)) {
      return;
    }

    const name = object.name || object.geometry?.name || '';

    if (names.has(name) || normalizedNames.has(normalizeText(name))) {
      found = object;
    }
  });

  return found;
}

function getObjectBox(object) {
  const box = new THREE.Box3().setFromObject(object);

  if (!Number.isFinite(box.min.x) || box.isEmpty()) {
    return null;
  }

  return box;
}

function createTargetFromObject(definition, object) {
  const box = getObjectBox(object);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  if (box) {
    box.getCenter(center);
    box.getSize(size);
  } else {
    object.getWorldPosition(center);
  }

  return {
    id: definition.id,
    label: definition.label || object.name || definition.id,
    aliases: [...(definition.aliases || []), object.name || definition.label || ''],
    action: definition.action,
    type: definition.type || 'poi',
    source: definition.source || 'scene',
    hiddenFromList: definition.hiddenFromList || false,
    meshName: definition.meshName,
    meshNames: definition.meshNames,
    object,
    box,
    center,
    size,
    linkedTargetId: definition.linkedTargetId,
    approachPoint: null,
    routePoint: null,
    arrivalPoint: null,
    isPointTarget: false,
  };
}

function createTargetFromPoint(definition) {
  const center = new THREE.Vector3(
    Number(definition.position?.x || 0),
    Number(definition.position?.y || 0),
    Number(definition.position?.z || 0),
  );
  const approachPoint = definition.approachPosition
    ? new THREE.Vector3(
        Number(definition.approachPosition.x || 0),
        Number(definition.approachPosition.y || 0),
        Number(definition.approachPosition.z || 0),
      )
    : null;

  return {
    id: definition.id || createIdFromName(definition.label),
    label: definition.label,
    aliases: definition.aliases || [definition.label],
    action: definition.action,
    type: definition.type || 'poi',
    source: definition.source || 'point',
    hiddenFromList: definition.hiddenFromList || false,
    meshName: definition.meshName,
    meshNames: definition.meshNames,
    object: null,
    box: null,
    center,
    size: new THREE.Vector3(1, 1, 1),
    linkedTargetId: definition.linkedTargetId,
    approachPoint,
    routePoint: approachPoint ? approachPoint.clone() : center.clone(),
    arrivalPoint: center.clone(),
    isPointTarget: true,
  };
}

function createSyntheticInteractive(definition, linkedTarget) {
  if (!linkedTarget) {
    return null;
  }

  return {
    id: definition.id,
    label: definition.label,
    aliases: definition.aliases || [],
    action: definition.action,
    type: definition.type || 'interactive',
    source: definition.source || linkedTarget.source || 'synthetic',
    hiddenFromList: definition.hiddenFromList || false,
    object: linkedTarget.object,
    box: linkedTarget.box,
    center: linkedTarget.center.clone(),
    size: linkedTarget.size.clone(),
    linkedTargetId: linkedTarget.id,
    approachPoint: null,
    routePoint: null,
    arrivalPoint: linkedTarget.arrivalPoint?.clone() || linkedTarget.center.clone(),
    isPointTarget: linkedTarget.isPointTarget,
  };
}

function addUniqueAlias(target, alias) {
  const normalized = normalizeText(alias);

  if (!normalized) {
    return;
  }

  if (!target.normalizedAliases.includes(normalized)) {
    target.normalizedAliases.push(normalized);
  }
}

function finalizeTarget(target) {
  target.normalizedAliases = [];
  addUniqueAlias(target, target.id);
  addUniqueAlias(target, target.label);

  for (const alias of target.aliases || []) {
    addUniqueAlias(target, alias);
  }

  return target;
}

function targetMatchesName(target, name) {
  const normalizedName = normalizeText(name);

  if (!normalizedName) {
    return false;
  }

  return (
    target.id === createIdFromName(name) ||
    normalizeText(target.label) === normalizedName ||
    (target.aliases || []).some((alias) => normalizeText(alias) === normalizedName) ||
    (target.meshName && normalizeText(target.meshName) === normalizedName) ||
    (target.meshNames || []).some((meshName) => normalizeText(meshName) === normalizedName)
  );
}

function createApproachCandidates(target) {
  const center = target.center;
  const box = target.box;

  if (target.approachPoint && !box) {
    return [target.approachPoint.clone(), center.clone()];
  }

  if (!box) {
    return [center.clone()];
  }

  const size = target.size;
  const radius = Math.min(Math.max(size.x, size.z) * 0.58 + 1.6, 16);
  const groundY = box.min.y + 0.35;
  const candidates = [center.clone().setY(groundY)];

  for (let i = 0; i < 16; i += 1) {
    const angle = (Math.PI * 2 * i) / 16;
    candidates.push(
      new THREE.Vector3(
        center.x + Math.cos(angle) * radius,
        groundY,
        center.z + Math.sin(angle) * radius,
      ),
    );
  }

  return candidates;
}

export class WorldRegistry {
  constructor(scene, customTargets = [], deletedTargetIds = new Set(), options = {}) {
    this.scene = scene;
    this.customTargets = customTargets;
    this.deletedTargetIds = new Set(deletedTargetIds);
    this.includeBuiltInTargets = options.includeBuiltInTargets !== false;
    this.includeSceneTargets = options.includeSceneTargets !== false;
    this.targets = [];
    this.targetById = new Map();
    this.rebuild();
  }

  setCustomTargets(customTargets) {
    this.customTargets = customTargets;
    this.rebuild();
  }

  setDeletedTargetIds(deletedTargetIds) {
    this.deletedTargetIds = new Set(deletedTargetIds);
    this.rebuild();
  }

  rebuild() {
    const created = [];

    if (this.includeBuiltInTargets) {
      for (const definition of BUILT_IN_TARGETS.filter(
        (item) => !item.linkedTargetId && !this.deletedTargetIds.has(item.id),
      )) {
        if (definition.position) {
          created.push(createTargetFromPoint({ ...definition, source: 'built-in' }));
        } else {
          const object = findObjectForDefinition(this.scene, definition);

          if (object) {
            created.push(createTargetFromObject({ ...definition, source: 'built-in' }, object));
          }
        }
      }
    }

    if (this.includeSceneTargets) {
      for (const object of getNamedObjects(this.scene)) {
        const existing = created.some((target) => target.object === object);
        const name = object.name || object.geometry?.name || '';
        const id = createIdFromName(name);
        const namedDefault = created.some((target) => targetMatchesName(target, name));

        if (!existing && !namedDefault && !this.deletedTargetIds.has(id)) {
          created.push(
            createTargetFromObject(
              {
                id,
                label: name,
                aliases: [name],
                type: 'poi',
                source: 'scene',
              },
              object,
            ),
          );
        }
      }
    }

    for (const definition of this.customTargets) {
      if (this.deletedTargetIds.has(definition.id)) {
        continue;
      }

      const duplicate = created.some(
        (target) =>
          target.id === definition.id ||
          normalizeText(target.label) === normalizeText(definition.label),
      );

      if (!duplicate && definition?.label && definition?.position) {
        created.push(createTargetFromPoint({ ...definition, source: 'custom' }));
      }
    }

    const byId = new Map(created.map((target) => [target.id, target]));

    if (this.includeBuiltInTargets) {
      for (const definition of BUILT_IN_TARGETS.filter(
        (item) => item.linkedTargetId && !this.deletedTargetIds.has(item.id),
      )) {
        const linkedTarget = byId.get(definition.linkedTargetId);
        const synthetic = createSyntheticInteractive({ ...definition, source: 'built-in' }, linkedTarget);

        if (synthetic) {
          created.push(synthetic);
        }
      }
    }

    this.targets = created.map(finalizeTarget);
    this.targetById = new Map(this.targets.map((target) => [target.id, target]));
  }

  bindNavigation(navigation) {
    for (const target of this.targets) {
      if (target.isPointTarget && target.approachPoint) {
        const routePoint = navigation.snapToNavMesh(target.approachPoint) || target.approachPoint.clone();
        target.routePoint = routePoint;
        target.approachPoint = routePoint.clone();
        continue;
      }

      const candidates = createApproachCandidates(target);
      const routePoint = navigation.findBestReachablePoint(candidates, target.center);
      target.routePoint = routePoint;

      if (!target.isPointTarget) {
        target.approachPoint = routePoint;
      } else if (!target.approachPoint) {
        target.approachPoint = routePoint;
      }
    }
  }

  getVisibleTargets() {
    return this.targets.filter((target) => !target.hiddenFromList);
  }

  getById(id) {
    return this.targetById.get(id) || null;
  }

  findInText(input) {
    const normalized = normalizeText(input);
    let bestTarget = null;
    let bestScore = 0;

    for (const target of this.targets) {
      for (const alias of target.normalizedAliases) {
        if (!alias) {
          continue;
        }

        const score = normalized.includes(alias) ? alias.length : 0;

        if (score > bestScore) {
          bestScore = score;
          bestTarget = target;
        }
      }
    }

    return bestTarget;
  }

  parseCommand(input) {
    const normalized = normalizeText(input);
    const wantsSit = ['sit', 'sitzen', 'setze', 'setzen', 'hinsetzen', 'stuhl', 'stuehle', 'stühle'].some((word) =>
      normalized.includes(word),
    );
    let target = this.findInText(input);

    if (wantsSit && !target) {
      target = this.getById('stuhl_cafe') || target;
    }

    if (!target) {
      return null;
    }

    return {
      target,
      actions: [
        { type: 'goto', targetId: target.id },
        ...(wantsSit || target.action ? [{ type: target.action || 'interact', targetId: target.id }] : []),
      ],
    };
  }
}
