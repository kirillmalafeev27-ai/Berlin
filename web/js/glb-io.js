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

  // Add a `jawOpen` morph target to every primitive of glTF mesh meshIndex.
  // deltasPerPrimitive: array of Float32Array (one per primitive, may be
  // all-zeros for primitives outside the face). Per glTF spec all primitives
  // of a mesh must carry the same number of targets.
  addJawOpenMorph(meshIndex, deltasPerPrimitive, name = 'jawOpen') {
    const mesh = this.json.meshes[meshIndex];
    if (!mesh) throw new Error(`mesh ${meshIndex} not found`);
    if (mesh.primitives.length !== deltasPerPrimitive.length) {
      throw new Error('one delta array per primitive required');
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
    return mesh.extras.targetNames.length - 1;
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
