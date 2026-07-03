// glb-io.js — GLB read/patch/write without external deps.
// Browser equivalent of the pygltflib path in facerig.py: we never rebuild the
// asset, we only APPEND to the original binary blob and patch the JSON, so
// skinning, textures, animations and extensions all survive untouched.

const GLB_MAGIC = 0x46546C67;
const CHUNK_JSON = 0x4E4F534A;
const CHUNK_BIN = 0x004E4942;

const COMP_FLOAT = 5126;
const COMP_USHORT = 5123;
const COMP_UINT = 5125;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY = 34963;

const COMP_ARRAYS = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// Generic accessor reader → tightly-packed typed array (handles byteStride).
// Sparse accessors are not supported (never produced by the target exporters).
export function readAccessor(json, bin, accIdx) {
  const acc = json.accessors[accIdx];
  if (acc.sparse) throw new Error('sparse accessors not supported');
  const Arr = COMP_ARRAYS[acc.componentType];
  const itemSize = TYPE_SIZE[acc.type];
  const out = new Arr(acc.count * itemSize);
  if (acc.bufferView == null) return out; // zero-filled per spec
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const compBytes = Arr.BYTES_PER_ELEMENT;
  const stride = bv.byteStride || itemSize * compBytes;
  if (stride === itemSize * compBytes) {
    // fast path: contiguous — but respect bin alignment via DataView when offset is unaligned
    if ((bin.byteOffset + base) % compBytes === 0) {
      out.set(new Arr(bin.buffer, bin.byteOffset + base, acc.count * itemSize));
      return out;
    }
  }
  const dv = new DataView(bin.buffer, bin.byteOffset);
  const get = {
    5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o),
    5122: (o) => dv.getInt16(o, true), 5123: (o) => dv.getUint16(o, true),
    5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
  }[acc.componentType];
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < itemSize; c++) {
      out[i * itemSize + c] = get(base + i * stride + c * compBytes);
    }
  }
  return out;
}

// --- minimal mat4 (column-major, glTF layout) ---------------------------------
export const M4 = {
  identity: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  multiply(a, b) { // a * b
    const o = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
      }
    }
    return o;
  },
  fromTRS(t = [0,0,0], q = [0,0,0,1], s = [1,1,1]) {
    const [x, y, z, w] = q;
    const x2 = x+x, y2 = y+y, z2 = z+z;
    const xx = x*x2, xy = x*y2, xz = x*z2, yy = y*y2, yz = y*z2, zz = z*z2;
    const wx = w*x2, wy = w*y2, wz = w*z2;
    return [
      (1-(yy+zz))*s[0], (xy+wz)*s[0], (xz-wy)*s[0], 0,
      (xy-wz)*s[1], (1-(xx+zz))*s[1], (yz+wx)*s[1], 0,
      (xz+wy)*s[2], (yz-wx)*s[2], (1-(xx+yy))*s[2], 0,
      t[0], t[1], t[2], 1,
    ];
  },
  invert(m) {
    // general 4x4 inverse (adapted from gl-matrix)
    const [a00,a01,a02,a03, a10,a11,a12,a13, a20,a21,a22,a23, a30,a31,a32,a33] = m;
    const b00 = a00*a11 - a01*a10, b01 = a00*a12 - a02*a10, b02 = a00*a13 - a03*a10;
    const b03 = a01*a12 - a02*a11, b04 = a01*a13 - a03*a11, b05 = a02*a13 - a03*a12;
    const b06 = a20*a31 - a21*a30, b07 = a20*a32 - a22*a30, b08 = a20*a33 - a23*a30;
    const b09 = a21*a32 - a22*a31, b10 = a21*a33 - a23*a31, b11 = a22*a33 - a23*a32;
    let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
    if (!det) throw new Error('singular matrix');
    det = 1 / det;
    return [
      (a11*b11 - a12*b10 + a13*b09)*det, (a02*b10 - a01*b11 - a03*b09)*det,
      (a31*b05 - a32*b04 + a33*b03)*det, (a22*b04 - a21*b05 - a23*b03)*det,
      (a12*b08 - a10*b11 - a13*b07)*det, (a00*b11 - a02*b08 + a03*b07)*det,
      (a32*b02 - a30*b05 - a33*b01)*det, (a20*b05 - a22*b02 + a23*b01)*det,
      (a10*b10 - a11*b08 + a13*b06)*det, (a01*b08 - a00*b10 - a03*b06)*det,
      (a30*b04 - a31*b02 + a33*b00)*det, (a21*b02 - a20*b04 - a23*b00)*det,
      (a11*b07 - a10*b09 - a12*b06)*det, (a00*b09 - a01*b07 + a02*b06)*det,
      (a31*b01 - a30*b03 - a32*b00)*det, (a20*b03 - a21*b01 + a22*b00)*det,
    ];
  },
};

export function nodeLocalMatrix(node) {
  if (node.matrix) return [...node.matrix];
  return M4.fromTRS(node.translation, node.rotation, node.scale);
}

// world matrix of a node by index (walks up from the scene roots)
export function nodeWorldMatrix(json, nodeIdx) {
  const parents = new Map();
  (json.nodes || []).forEach((n, i) => (n.children || []).forEach((c) => parents.set(c, i)));
  let m = nodeLocalMatrix(json.nodes[nodeIdx]);
  let cur = parents.get(nodeIdx);
  while (cur != null) {
    m = M4.multiply(nodeLocalMatrix(json.nodes[cur]), m);
    cur = parents.get(cur);
  }
  return m;
}

export function parseGLB(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file');
  const length = dv.getUint32(8, true);
  let off = 12, json = null, bin = null;
  while (off < length) {
    const clen = dv.getUint32(off, true);
    const ctype = dv.getUint32(off + 4, true);
    const body = new Uint8Array(arrayBuffer, off + 8, clen);
    if (ctype === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body));
    else if (ctype === CHUNK_BIN) bin = body;
    off += 8 + clen;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin: bin || new Uint8Array(0) };
}

// Mutable GLB being patched: original json (deep-cloned) + original bin with
// new data appended 4-byte-aligned.
export class GLBPatcher {
  constructor(arrayBuffer) {
    const { json, bin } = parseGLB(arrayBuffer);
    this.json = JSON.parse(JSON.stringify(json));
    this.chunks = [bin];
    this.binLength = bin.byteLength;
    if (!this.json.buffers || !this.json.buffers.length) this.json.buffers = [{ byteLength: 0 }];
    if (this.json.buffers.length > 1 || this.json.buffers[0].uri) {
      throw new Error('GLB with external/multiple buffers is not supported');
    }
    this.json.bufferViews = this.json.bufferViews || [];
    this.json.accessors = this.json.accessors || [];
    this.json.meshes = this.json.meshes || [];
    this.json.nodes = this.json.nodes || [];
    this.json.materials = this.json.materials || [];
  }

  _append(bytes) {
    const pad = (4 - (this.binLength % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.binLength += pad; }
    const offset = this.binLength;
    this.chunks.push(bytes);
    this.binLength += bytes.byteLength;
    return offset;
  }

  addBufferView(typedArray, target) {
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const byteOffset = this._append(bytes);
    const bv = { buffer: 0, byteOffset, byteLength: bytes.byteLength };
    if (target) bv.target = target;
    this.json.bufferViews.push(bv);
    return this.json.bufferViews.length - 1;
  }

  addAccessorVec3(f32) {
    const count = f32.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      for (let a = 0; a < 3; a++) {
        const v = f32[i * 3 + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    const bufferView = this.addBufferView(f32, TARGET_ARRAY_BUFFER);
    this.json.accessors.push({
      bufferView, componentType: COMP_FLOAT, count, type: 'VEC3', min, max,
    });
    return this.json.accessors.length - 1;
  }

  addAccessorIndices(indices, vertCount) {
    const wide = vertCount > 65535;
    const arr = wide ? Uint32Array.from(indices) : Uint16Array.from(indices);
    const bufferView = this.addBufferView(arr, TARGET_ELEMENT_ARRAY);
    this.json.accessors.push({
      bufferView, componentType: wide ? COMP_UINT : COMP_USHORT,
      count: arr.length, type: 'SCALAR',
    });
    return this.json.accessors.length - 1;
  }

  // --- facerig-specific operations -----------------------------------------

  // Add named morph targets to every primitive of glTF mesh meshIndex.
  // morphs: [{ name, deltasPerPrimitive: Float32Array[] }] — one delta array
  // per primitive (all-zeros allowed). Per glTF spec all primitives of a mesh
  // must carry the same number of targets, in the same order.
  addMorphTargets(meshIndex, morphs) {
    const mesh = this.json.meshes[meshIndex];
    if (!mesh) throw new Error(`mesh ${meshIndex} not found`);
    for (const { name, deltasPerPrimitive } of morphs) {
      if (mesh.primitives.length !== deltasPerPrimitive.length) {
        throw new Error(`morph ${name}: one delta array per primitive required`);
      }
      mesh.primitives.forEach((prim, i) => {
        if (prim.extensions && prim.extensions.KHR_draco_mesh_compression) {
          throw new Error('Draco-compressed primitive: decompress the GLB first (e.g. gltf-transform draco --decompress)');
        }
        const acc = this.addAccessorVec3(deltasPerPrimitive[i]);
        prim.targets = prim.targets || [];
        prim.targets.push({ POSITION: acc });
      });
      mesh.weights = mesh.weights || [];
      mesh.weights.push(0);
      mesh.extras = mesh.extras || {};
      mesh.extras.targetNames = mesh.extras.targetNames || [];
      mesh.extras.targetNames.push(name);
    }
  }

  // Replace a primitive's vertex data after a lip cut: every attribute (and
  // every existing morph-target attribute) gets duplicated tail vertices, and
  // the index buffer is rewritten. Old accessors stay in the file (unused but
  // valid); new ones are appended.
  replaceCutGeometry(meshIndex, primIndex, dupSources, newIndices) {
    const prim = this.json.meshes[meshIndex].primitives[primIndex];
    const dupAttr = (accIdx) => {
      const acc = this.json.accessors[accIdx];
      const data = readAccessor(this.json, this.chunks[0], accIdx);
      const itemSize = TYPE_SIZE[acc.type];
      const n = acc.count;
      const out = new data.constructor((n + dupSources.length) * itemSize);
      out.set(data);
      for (let k = 0; k < dupSources.length; k++) {
        for (let c = 0; c < itemSize; c++) {
          out[(n + k) * itemSize + c] = data[dupSources[k] * itemSize + c];
        }
      }
      const bufferView = this.addBufferView(out, TARGET_ARRAY_BUFFER);
      const newAcc = {
        bufferView, componentType: acc.componentType,
        count: n + dupSources.length, type: acc.type,
      };
      if (acc.normalized) newAcc.normalized = true;
      if (acc.min && acc.max) {
        // recompute min/max (required for POSITION)
        const min = new Array(itemSize).fill(Infinity);
        const max = new Array(itemSize).fill(-Infinity);
        for (let i = 0; i < newAcc.count; i++) {
          for (let c = 0; c < itemSize; c++) {
            const v = out[i * itemSize + c];
            if (v < min[c]) min[c] = v;
            if (v > max[c]) max[c] = v;
          }
        }
        newAcc.min = min; newAcc.max = max;
      }
      this.json.accessors.push(newAcc);
      return this.json.accessors.length - 1;
    };

    for (const key of Object.keys(prim.attributes)) {
      prim.attributes[key] = dupAttr(prim.attributes[key]);
    }
    for (const target of prim.targets || []) {
      for (const key of Object.keys(target)) target[key] = dupAttr(target[key]);
    }
    const vertCount = this.json.accessors[prim.attributes.POSITION].count;
    prim.indices = this.addAccessorIndices(newIndices, vertCount);
  }

  // Replace a primitive after a procedural mouth augmentation. POSITION and
  // indices come from the augmentation; all other per-vertex data is inherited
  // from nearest source head vertices so skinning and existing morphs survive.
  replaceAugmentedGeometry(meshIndex, primIndex, aug) {
    const prim = this.json.meshes[meshIndex].primitives[primIndex];
    const extendAttr = (accIdx, semantic = '') => {
      const acc = this.json.accessors[accIdx];
      const data = readAccessor(this.json, this.chunks[0], accIdx);
      const itemSize = TYPE_SIZE[acc.type];
      let out;
      if (semantic === 'POSITION') {
        out = aug.positions;
      } else {
        out = new data.constructor(aug.vertexCount * itemSize);
        out.set(data);
        for (let k = 0; k < aug.sourceForAdded.length; k++) {
          const dst = aug.baseCount + k;
          const src = aug.sourceForAdded[k];
          for (let c = 0; c < itemSize; c++) {
            out[dst * itemSize + c] = data[src * itemSize + c];
          }
        }
        if (semantic === 'NORMAL' && itemSize === 3 && aug.generatedNormals) {
          out.set(aug.generatedNormals, aug.generatedStart * 3);
        }
      }

      const bufferView = this.addBufferView(out, semantic === 'INDICES' ? TARGET_ELEMENT_ARRAY : TARGET_ARRAY_BUFFER);
      const newAcc = {
        bufferView, componentType: acc.componentType,
        count: aug.vertexCount, type: acc.type,
      };
      if (acc.normalized) newAcc.normalized = true;
      if (acc.min && acc.max) {
        const min = new Array(itemSize).fill(Infinity);
        const max = new Array(itemSize).fill(-Infinity);
        for (let i = 0; i < newAcc.count; i++) {
          for (let c = 0; c < itemSize; c++) {
            const v = out[i * itemSize + c];
            if (v < min[c]) min[c] = v;
            if (v > max[c]) max[c] = v;
          }
        }
        newAcc.min = min; newAcc.max = max;
      }
      this.json.accessors.push(newAcc);
      return this.json.accessors.length - 1;
    };

    for (const key of Object.keys(prim.attributes)) {
      prim.attributes[key] = extendAttr(prim.attributes[key], key);
    }
    for (const target of prim.targets || []) {
      for (const key of Object.keys(target)) target[key] = extendAttr(target[key], `MORPH_${key}`);
    }
    prim.indices = this.addAccessorIndices(aug.indices, aug.vertexCount);

    if (aug.rimAdded && prim.material != null && this.json.materials[prim.material]) {
      this.json.materials[prim.material].doubleSided = true;
    }
  }

  addMaterial(name, rgba, { metallic = 0, roughness = 1, doubleSided = false } = {}) {
    this.json.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: rgba,
        metallicFactor: metallic,
        roughnessFactor: roughness,
      },
      doubleSided,
    });
    return this.json.materials.length - 1;
  }

  // geometry: { positions: Float32Array, normals: Float32Array, indices: number[] }
  addMeshNode(name, geometry, materialIndex, { parentNode = null, matrix = null } = {}) {
    const posAcc = this.addAccessorVec3(geometry.positions);
    const nrmAcc = this.addAccessorVec3(geometry.normals);
    const idxAcc = this.addAccessorIndices(geometry.indices, geometry.positions.length / 3);
    this.json.meshes.push({
      name,
      primitives: [{
        attributes: { POSITION: posAcc, NORMAL: nrmAcc },
        indices: idxAcc,
        material: materialIndex,
      }],
    });
    const meshIdx = this.json.meshes.length - 1;
    const node = { name, mesh: meshIdx };
    if (matrix && !isIdentity(matrix)) node.matrix = [...matrix];
    this.json.nodes.push(node);
    const nodeIdx = this.json.nodes.length - 1;

    if (parentNode != null) {
      const parent = this.json.nodes[parentNode];
      parent.children = parent.children || [];
      parent.children.push(nodeIdx);
    } else {
      const sceneIdx = this.json.scene ?? 0;
      const scene = this.json.scenes[sceneIdx];
      scene.nodes = scene.nodes || [];
      scene.nodes.push(nodeIdx);
    }
    return nodeIdx;
  }

  build() {
    this.json.buffers[0].byteLength = this.binLength;
    const enc = new TextEncoder();
    let jsonBytes = enc.encode(JSON.stringify(this.json));
    const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
    if (jsonPad) {
      const padded = new Uint8Array(jsonBytes.byteLength + jsonPad);
      padded.set(jsonBytes);
      padded.fill(0x20, jsonBytes.byteLength); // pad JSON with spaces
      jsonBytes = padded;
    }
    const binPad = (4 - (this.binLength % 4)) % 4;
    const binLen = this.binLength + binPad;

    const total = 12 + 8 + jsonBytes.byteLength + 8 + binLen;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, GLB_MAGIC, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonBytes.byteLength, true);
    dv.setUint32(16, CHUNK_JSON, true);
    out.set(jsonBytes, 20);
    let off = 20 + jsonBytes.byteLength;
    dv.setUint32(off, binLen, true);
    dv.setUint32(off + 4, CHUNK_BIN, true);
    off += 8;
    for (const c of this.chunks) { out.set(c, off); off += c.byteLength; }
    return out;
  }
}

function isIdentity(m) {
  const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  return m.every((v, i) => Math.abs(v - I[i]) < 1e-9);
}

// Find a good parent node for the mouth props: the head joint of the skin (so
// the cavity follows the head in body animations), else null (scene root).
export function findHeadJointNode(json, meshIndex) {
  const skins = json.skins || [];
  // prefer a skin actually used by a node that references our mesh
  let joints = [];
  for (const node of json.nodes || []) {
    if (node.mesh === meshIndex && node.skin != null && skins[node.skin]) {
      joints = skins[node.skin].joints;
      break;
    }
  }
  if (!joints.length && skins.length) joints = skins[0].joints;
  for (const j of joints) {
    const n = json.nodes[j];
    if (n && n.name && /head/i.test(n.name)) return j;
  }
  return null;
}
