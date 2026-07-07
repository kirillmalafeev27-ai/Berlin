import * as THREE from 'three';
import {
  NavMeshQuery,
  getNavMeshPositionsAndIndices,
  init,
  statusToReadableString,
} from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { NAV_KINDS, isNavInputKind } from './navConfig.js';

const tempVector = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const fallbackTriangle = new THREE.Triangle();
const fallbackClosestPoint = new THREE.Vector3();

function toPlainVector(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function fromPlainVector(vector) {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

function isInsideBlockedArea(point, blockedAreas = []) {
  for (const area of blockedAreas) {
    const radius = Number(area.radius || 0);

    if (!radius) {
      continue;
    }

    const dx = point.x - Number(area.x || 0);
    const dz = point.z - Number(area.z || 0);

    if (dx * dx + dz * dz <= radius * radius) {
      return true;
    }
  }

  return false;
}

function isTriangleBlocked(a, b, c, blockedAreas = []) {
  if (!blockedAreas.length) {
    return false;
  }

  const center = tempVector.addVectors(a, b).add(c).multiplyScalar(1 / 3);
  return isInsideBlockedArea(center, blockedAreas);
}

function getTriangleCount(object) {
  const geometry = object.geometry;

  if (!geometry?.attributes?.position) {
    return 0;
  }

  const indexCount = geometry.index?.count || geometry.attributes.position.count;
  return Math.floor(indexCount / 3) * (object.isInstancedMesh ? object.count : 1);
}

function appendFilteredWalkableTriangles(object, positions, indices, options = {}) {
  const geometry = object.geometry;
  const positionAttribute = geometry?.attributes?.position;

  if (!positionAttribute) {
    return { vertices: 0, triangles: 0 };
  }

  const sourceIndex = geometry.index?.array;
  const sourceVertexCount = positionAttribute.count;
  const sourceIndexCount = sourceIndex?.length || sourceVertexCount;
  const instanceCount = object.isInstancedMesh ? object.count : 1;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let addedVertices = 0;
  let addedTriangles = 0;
  const minNormalY = options.minNormalY;
  const hasNormalFilter = Number.isFinite(minNormalY);
  const blockedAreas = options.blockedAreas || [];

  object.updateWorldMatrix(true, false);

  for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
    const matrix = tempMatrix.copy(object.matrixWorld);

    if (object.isInstancedMesh) {
      object.getMatrixAt(instanceIndex, tempMatrix);
      matrix.premultiply(object.matrixWorld);
    }

    for (let i = 0; i < sourceIndexCount; i += 3) {
      const ia = sourceIndex ? sourceIndex[i] : i;
      const ib = sourceIndex ? sourceIndex[i + 1] : i + 1;
      const ic = sourceIndex ? sourceIndex[i + 2] : i + 2;

      if (ia >= sourceVertexCount || ib >= sourceVertexCount || ic >= sourceVertexCount) {
        continue;
      }

      a.fromBufferAttribute(positionAttribute, ia).applyMatrix4(matrix);
      b.fromBufferAttribute(positionAttribute, ib).applyMatrix4(matrix);
      c.fromBufferAttribute(positionAttribute, ic).applyMatrix4(matrix);

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.crossVectors(ab, ac);

      const normalLength = normal.length();

      if (normalLength < 0.00001) {
        continue;
      }

      normal.multiplyScalar(1 / normalLength);

      if (hasNormalFilter && Math.abs(normal.y) < minNormalY) {
        continue;
      }

      if (isTriangleBlocked(a, b, c, blockedAreas)) {
        continue;
      }

      const baseVertex = positions.length / 3;
      positions.push(a.x, a.y, a.z);

      if (!hasNormalFilter || normal.y >= 0) {
        positions.push(b.x, b.y, b.z, c.x, c.y, c.z);
      } else {
        positions.push(c.x, c.y, c.z, b.x, b.y, b.z);
      }

      indices.push(baseVertex, baseVertex + 1, baseVertex + 2);
      addedVertices += 3;
      addedTriangles += 1;
    }
  }

  return { vertices: addedVertices, triangles: addedTriangles };
}

function appendObjectGeometry(object, positions, indices, options = {}) {
  if (options.filterToWalkableTriangles || options.blockedAreas?.length) {
    return appendFilteredWalkableTriangles(object, positions, indices, {
      blockedAreas: options.blockedAreas || [],
      minNormalY: options.filterToWalkableTriangles ? options.minNormalY ?? 0.68 : undefined,
    });
  }

  const geometry = object.geometry;
  const positionAttribute = geometry?.attributes?.position;

  if (!positionAttribute) {
    return { vertices: 0, triangles: 0 };
  }

  const sourceIndex = geometry.index?.array;
  const sourceVertexCount = positionAttribute.count;
  const sourceIndexCount = sourceIndex?.length || sourceVertexCount;
  const instanceCount = object.isInstancedMesh ? object.count : 1;
  let addedVertices = 0;
  let addedTriangles = 0;

  object.updateWorldMatrix(true, false);

  for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
    const baseVertex = positions.length / 3;
    const matrix = tempMatrix.copy(object.matrixWorld);

    if (object.isInstancedMesh) {
      object.getMatrixAt(instanceIndex, tempMatrix);
      matrix.premultiply(object.matrixWorld);
    }

    for (let i = 0; i < sourceVertexCount; i += 1) {
      tempVector.fromBufferAttribute(positionAttribute, i).applyMatrix4(matrix);
      positions.push(tempVector.x, tempVector.y, tempVector.z);
    }

    if (sourceIndex) {
      for (let i = 0; i < sourceIndex.length; i += 1) {
        indices.push(baseVertex + sourceIndex[i]);
      }
    } else {
      for (let i = 0; i < sourceVertexCount; i += 1) {
        indices.push(baseVertex + i);
      }
    }

    addedVertices += sourceVertexCount;
    addedTriangles += Math.floor(sourceIndexCount / 3);
  }

  return { vertices: addedVertices, triangles: addedTriangles };
}

function createDebugMesh(navMesh) {
  const result = getNavMeshPositionsAndIndices(navMesh);
  const positions = Array.isArray(result) ? result[0] : result.positions;
  const indices = Array.isArray(result) ? result[1] : result.indices;
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x52f0c0,
    depthWrite: false,
    opacity: 0.26,
    side: THREE.DoubleSide,
    transparent: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Debug_NavMesh';
  mesh.renderOrder = 20;
  return mesh;
}

function createTriangleCache(geometry) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const triangles = [];

  if (!position || !index) {
    return triangles;
  }

  for (let i = 0; i < index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(i));
    const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 1));
    const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 2));
    const center = new THREE.Vector3().addVectors(a, b).add(c).multiplyScalar(1 / 3);

    triangles.push({ a, b, c, center });
  }

  return triangles;
}

function createPathLine() {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({
    color: 0xffd166,
    depthTest: false,
    linewidth: 2,
  });
  const line = new THREE.Line(geometry, material);
  line.name = 'Debug_Path';
  line.renderOrder = 30;
  return line;
}

function describeValue(value) {
  if (value === null) {
    return { type: 'null' };
  }

  if (value === undefined) {
    return { type: 'undefined' };
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      first: value[0] || null,
    };
  }

  if (typeof value === 'object') {
    return {
      type: value.constructor?.name || 'object',
      keys: Object.keys(value),
      success: value.success,
      status: value.status,
      length: value.length,
    };
  }

  return { type: typeof value, value };
}

export class NavigationSystem {
  constructor({ scene, getKind, config, onStatus, blockedAreas = [] }) {
    this.scene = scene;
    this.getKind = getKind;
    this.config = config;
    this.onStatus = onStatus || (() => {});
    this.blockedAreas = blockedAreas;
    this.navMesh = null;
    this.query = null;
    this.debugMesh = null;
    this.pathLine = createPathLine();
    this.stats = null;
    this.lastPathDebug = null;
    this.navMeshTriangles = [];
  }

  collectInputMeshes() {
    const meshes = [];
    const includeBlockers = this.config.includeBlockers !== false;
    const includeDecorSurfaces = this.config.includeDecorSurfaces === true;

    this.scene.traverse((object) => {
      if (!object.isMesh && !object.isInstancedMesh) {
        return;
      }

      const kind = this.getKind(object);

      if (
        kind === NAV_KINDS.WALKABLE ||
        (includeBlockers && isNavInputKind(kind)) ||
        (includeDecorSurfaces && kind === NAV_KINDS.DECOR)
      ) {
        meshes.push({
          object,
          kind,
          triangles: getTriangleCount(object),
        });
      }
    });

    return meshes;
  }

  async build() {
    this.dispose();
    this.onStatus('Инициализация Recast WASM...');
    await init();

    const inputMeshes = this.collectInputMeshes();

    if (!inputMeshes.length) {
      throw new Error('Нет walkable/blocker мешей для navmesh.');
    }

    const positions = [];
    const indices = [];
    let inputTriangles = 0;
    let inputVertices = 0;

    const minNormalY = Math.cos(((this.config.walkableSlopeAngle ?? 45) * Math.PI) / 180);

    for (const item of inputMeshes) {
      const added = appendObjectGeometry(item.object, positions, indices, {
        blockedAreas: this.blockedAreas,
        filterToWalkableTriangles:
          item.kind !== NAV_KINDS.WALKABLE && this.config.blockerMode === 'walkable-surfaces',
        minNormalY,
      });
      inputTriangles += added.triangles;
      inputVertices += added.vertices;
    }

    this.onStatus(`Строю navmesh: ${inputMeshes.length} мешей, ${inputTriangles.toLocaleString('ru-RU')} tris`);

    await new Promise((resolve) => setTimeout(resolve, 30));

    const { includeBlockers, includeDecorSurfaces, blockerMode, ...recastConfig } = this.config;
    const result = generateSoloNavMesh(
      new Float32Array(positions),
      new Uint32Array(indices),
      recastConfig,
    );

    if (!result.success || !result.navMesh) {
      const reason = result.error || statusToReadableString(result.status || 0);
      throw new Error(`Recast не построил navmesh: ${reason}`);
    }

    this.navMesh = result.navMesh;
    this.query = new NavMeshQuery(this.navMesh);
    this.debugMesh = createDebugMesh(this.navMesh);
    this.navMeshTriangles = createTriangleCache(this.debugMesh.geometry);
    this.stats = {
      meshes: inputMeshes.length,
      triangles: inputTriangles,
      vertices: inputVertices,
      navTriangles: this.debugMesh.geometry.index.count / 3,
      blockedAreas: this.blockedAreas.length,
    };

    return this;
  }

  dispose() {
    if (this.debugMesh) {
      this.debugMesh.geometry.dispose();
      this.debugMesh.material.dispose();
      this.debugMesh = null;
    }

    if (this.pathLine.geometry) {
      this.pathLine.geometry.dispose();
      this.pathLine.geometry = new THREE.BufferGeometry();
    }

    this.navMesh = null;
    this.query = null;
    this.stats = null;
    this.navMeshTriangles = [];
  }

  findClosestDebugPoint(position, maxDistance = 18) {
    let bestPoint = null;
    let bestDistanceSq = maxDistance * maxDistance;

    for (const triangle of this.navMeshTriangles) {
      const centerDistanceSq = triangle.center.distanceToSquared(position);

      if (centerDistanceSq > bestDistanceSq + 64) {
        continue;
      }

      fallbackTriangle.set(triangle.a, triangle.b, triangle.c);
      fallbackTriangle.closestPointToPoint(position, fallbackClosestPoint);

      const distanceSq = fallbackClosestPoint.distanceToSquared(position);

      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestPoint = fallbackClosestPoint.clone();
      }
    }

    return bestPoint;
  }

  snapToNavMesh(position, options = {}) {
    if (!this.query) {
      return null;
    }

    const result = this.query.findClosestPoint(toPlainVector(position));

    if (result?.success && result.point) {
      return fromPlainVector(result.point);
    }

    if (options.allowFallback === false) {
      return null;
    }

    const fallbackPoint = this.findClosestDebugPoint(position, options.maxFallbackDistance ?? 18);

    if (!fallbackPoint) {
      return null;
    }

    const fallbackResult = this.query.findClosestPoint(toPlainVector(fallbackPoint));

    if (fallbackResult?.success && fallbackResult.point) {
      return fromPlainVector(fallbackResult.point);
    }

    return fallbackPoint;
  }

  findBestReachablePoint(candidates, fallback) {
    const snapped = [];

    for (const candidate of candidates) {
      const point = this.snapToNavMesh(candidate);

      if (point) {
        snapped.push(point);
      }
    }

    if (!snapped.length) {
      return this.snapToNavMesh(fallback) || fallback.clone();
    }

    snapped.sort((a, b) => a.distanceToSquared(fallback) - b.distanceToSquared(fallback));
    return snapped[0];
  }

  findPath(start, end) {
    if (!this.query) {
      return [];
    }

    const snappedStart = this.snapToNavMesh(start);
    const snappedEnd = this.snapToNavMesh(end);

    if (!snappedStart || !snappedEnd) {
      this.lastPathDebug = {
        reason: 'snap-failed',
        start: toPlainVector(start),
        end: toPlainVector(end),
        snappedStart: snappedStart ? toPlainVector(snappedStart) : null,
        snappedEnd: snappedEnd ? toPlainVector(snappedEnd) : null,
      };
      return [];
    }

    if (snappedStart.distanceToSquared(snappedEnd) < 0.09) {
      this.lastPathDebug = {
        reason: 'already-at-destination',
        start: toPlainVector(snappedStart),
        end: toPlainVector(snappedEnd),
      };
      return [snappedStart, snappedEnd];
    }

    const result = this.query.computePath(toPlainVector(snappedStart), toPlainVector(snappedEnd));
    this.lastPathDebug = {
      start: toPlainVector(snappedStart),
      end: toPlainVector(snappedEnd),
      result: describeValue(result),
      path: describeValue(result?.path),
    };

    if (!result?.success || !result.path?.length) {
      return [];
    }

    return result.path.map(fromPlainVector);
  }

  setPathDebug(points) {
    const pathPoints = points.map((point) => point.clone().add(new THREE.Vector3(0, 0.08, 0)));
    this.pathLine.geometry.dispose();
    this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pathPoints);
  }
}
