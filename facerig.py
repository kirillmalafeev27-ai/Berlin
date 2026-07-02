"""
facerig.py  —  v0.1  (the first brick)

Takes a head GLB (e.g. an AI-generated, sealed head) and returns a GLB that is
ready for jaw-open lip-sync in Three.js:

  1. Adds a dark MOUTH CAVITY primitive inside the head (so an opening mouth
     reads as depth, not a hole punched through the skull).
  2. Adds a simple TONGUE primitive.
  3. Generates a procedural `jawOpen` MORPH TARGET: the lower-front of the face
     is pulled down with a smooth Gaussian falloff (proportional-edit, but
     automatic). Driving this morph 0..1 opens the mouth.
  4. Writes a CALIBRATION CONFIG (JSON) with every parameter used, so a future
     visual tool can tune placement per character without touching the mesh.

This v0.1 uses geometric heuristics (bounding box + front hemisphere), not ML.
It assumes +Y up and a known front axis (default +Z). Everything is overridable
through the config so a bad guess is a slider away, not a re-code.
"""

import json
import struct
import numpy as np
import trimesh
from pygltflib import GLTF2, BufferView, Accessor, Attributes
from pygltflib import FLOAT, VEC3, ARRAY_BUFFER


# ----------------------------------------------------------------------------- 
# default calibration parameters (all normalized to head bounding box)
# ----------------------------------------------------------------------------- 
DEFAULT_CFG = {
    "front_axis": "z",        # which axis the face points along
    "front_sign": 1,          # +1 => face looks toward +axis
    "mouth_height_frac": 0.30,  # mouth line, fraction of head height up from chin
    "mouth_region_frac": 0.22,  # gaussian sigma for jaw influence (frac of height)
    "jaw_strength_frac": 0.16,  # how far the jaw opens (frac of head height)
    "jaw_forward": 0.15,        # forward component of the open motion
    "cavity_scale": [0.32, 0.22, 0.30],  # ellipsoid radii (frac of head size)
    "cavity_depth_frac": 0.35,  # how far behind the lip surface to sink the cavity
    "cavity_color": [0.02, 0.01, 0.01, 1.0],
    "tongue_scale": [0.16, 0.05, 0.18],
    "tongue_color": [0.55, 0.20, 0.22, 1.0],
}

AXIS_IDX = {"x": 0, "y": 1, "z": 2}


# ----------------------------------------------------------------------------- 
# helpers
# ----------------------------------------------------------------------------- 
def _load_head(path):
    """Load a GLB, return the largest mesh as a trimesh (the head)."""
    scene_or_mesh = trimesh.load(path, process=False)
    if isinstance(scene_or_mesh, trimesh.Trimesh):
        return scene_or_mesh
    # pick the mesh with the most vertices
    meshes = [g for g in scene_or_mesh.geometry.values()
              if isinstance(g, trimesh.Trimesh)]
    if not meshes:
        raise ValueError("no mesh found in GLB")
    return max(meshes, key=lambda m: len(m.vertices))


def _mouth_anchor(bounds, cfg):
    """Return (mouth_center xyz, head_size xyz) from bbox + config."""
    lo, hi = bounds
    size = hi - lo
    center = (lo + hi) / 2.0
    fa = AXIS_IDX[cfg["front_axis"]]
    sign = cfg["front_sign"]

    mouth = center.copy()
    # vertical: fraction up from the chin
    mouth[1] = lo[1] + cfg["mouth_height_frac"] * size[1]
    # front-facing: out to the front surface
    mouth[fa] = center[fa] + sign * (size[fa] / 2.0)
    return mouth, size, fa, sign


def _build_cavity_and_tongue(mouth, size, fa, sign, cfg):
    """Dark ellipsoid cavity + tongue primitive, positioned at the mouth."""
    # cavity centre sits a bit *behind* the lip surface
    cav_center = mouth.copy()
    cav_center[fa] -= sign * cfg["cavity_depth_frac"] * size[fa]

    cav = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    cav.vertices *= np.array(cfg["cavity_scale"]) * size
    cav.vertices += cav_center
    cav.invert()  # flip normals so we see the inside as a dark pocket
    cav.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            name="cavity", baseColorFactor=cfg["cavity_color"],
            metallicFactor=0.0, roughnessFactor=1.0,
        ))
    cav.metadata["name"] = "MouthCavity"

    ton_center = cav_center.copy()
    ton_center[1] -= 0.25 * cfg["cavity_scale"][1] * size[1]
    ton_center[fa] += sign * 0.15 * size[fa]
    ton = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    ton.vertices *= np.array(cfg["tongue_scale"]) * size
    ton.vertices += ton_center
    ton.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            name="tongue", baseColorFactor=cfg["tongue_color"],
            metallicFactor=0.0, roughnessFactor=0.8,
        ))
    ton.metadata["name"] = "Tongue"
    return cav, ton


def _jaw_delta(positions, mouth, size, fa, sign, cfg):
    """
    Procedural jawOpen morph delta for the given vertex positions.
    Lower-front vertices are pulled down (and slightly forward) with a smooth
    Gaussian falloff around the mouth anchor. Returns float32 (N,3) deltas.
    """
    p = positions
    sigma = cfg["mouth_region_frac"] * size[1]

    # distance from the mouth anchor, in a scaled space (x,y count; depth loose)
    dx = (p[:, 0] - mouth[0])
    dy = (p[:, 1] - mouth[1])
    d2 = (dx * dx) + (dy * dy)
    w = np.exp(-d2 / (2.0 * sigma * sigma))            # gaussian influence 0..1

    # gate to the FRONT hemisphere only (don't open the back of the head)
    front_coord = sign * (p[:, fa] - mouth[fa] + sign * (size[fa] / 2.0))
    front_gate = np.clip(front_coord / (0.5 * size[fa]), 0.0, 1.0)

    # only BELOW the mouth line actually drops (upper lip barely moves)
    below = np.clip((mouth[1] - p[:, 1]) / (0.25 * size[1]), 0.0, 1.0)

    amount = w * front_gate * below                     # final per-vertex weight
    strength = cfg["jaw_strength_frac"] * size[1]

    delta = np.zeros_like(p)
    delta[:, 1] = -amount * strength                    # down
    delta[:, fa] = sign * amount * strength * cfg["jaw_forward"]  # slightly forward
    return delta.astype(np.float32)


# ----------------------------------------------------------------------------- 
# morph-target injection (pygltflib, low level but contained)
# ----------------------------------------------------------------------------- 
def _read_accessor_vec3(gltf, blob, acc_idx):
    acc = gltf.accessors[acc_idx]
    bv = gltf.bufferViews[acc.bufferView]
    off = (bv.byteOffset or 0) + (acc.byteOffset or 0)
    stride = bv.byteStride or 12
    out = np.empty((acc.count, 3), np.float32)
    for i in range(acc.count):
        b = off + i * stride
        out[i] = struct.unpack_from("<3f", blob, b)
    return out


def _inject_jaw_morph(in_glb, out_glb, head_vcount, delta_fn, cfg):
    """Find the head primitive, compute its jaw delta, add it as a morph target."""
    gltf = GLTF2().load(in_glb)
    blob = bytearray(gltf.binary_blob())

    # locate the head mesh: the primitive whose POSITION count == head vcount
    target_mesh, target_prim, pos_acc = None, None, None
    for m in gltf.meshes:
        for prim in m.primitives:
            pa = prim.attributes.POSITION
            if pa is not None and gltf.accessors[pa].count == head_vcount:
                target_mesh, target_prim, pos_acc = m, prim, pa
                break
        if target_mesh:
            break
    if target_mesh is None:
        raise RuntimeError("could not locate head primitive to attach morph")

    positions = _read_accessor_vec3(gltf, blob, pos_acc)
    pos_acc_obj = gltf.accessors[pos_acc]
    lo = np.array(pos_acc_obj.min); hi = np.array(pos_acc_obj.max)
    delta = delta_fn(positions, lo, hi)

    # append delta bytes to the binary blob (4-byte aligned)
    while len(blob) % 4 != 0:
        blob.append(0)
    byte_off = len(blob)
    raw = delta.tobytes()
    blob.extend(raw)

    bv_idx = len(gltf.bufferViews)
    gltf.bufferViews.append(BufferView(
        buffer=0, byteOffset=byte_off, byteLength=len(raw), target=ARRAY_BUFFER))

    acc_idx = len(gltf.accessors)
    gltf.accessors.append(Accessor(
        bufferView=bv_idx, componentType=FLOAT, count=len(delta), type=VEC3,
        min=delta.min(axis=0).tolist(), max=delta.max(axis=0).tolist()))

    target_prim.targets = [{"POSITION": acc_idx}]
    target_mesh.weights = [0.0]
    target_mesh.extras = {"targetNames": ["jawOpen"]}

    gltf.set_binary_blob(bytes(blob))
    gltf.buffers[0].byteLength = len(blob)
    gltf.save(out_glb)
    return {"head_vertices": int(head_vcount),
            "morph_targets": ["jawOpen"],
            "max_open_offset": float(np.abs(delta).max())}


# ----------------------------------------------------------------------------- 
# main entry
# ----------------------------------------------------------------------------- 
def process(in_path, out_path, cfg=None, config_out=None):
    cfg = {**DEFAULT_CFG, **(cfg or {})}
    head = _load_head(in_path)
    bounds = head.bounds
    mouth, size, fa, sign = _mouth_anchor(bounds, cfg)

    cav, ton = _build_cavity_and_tongue(mouth, size, fa, sign, cfg)

    scene = trimesh.Scene()
    scene.add_geometry(head, node_name="Head", geom_name="Head")
    scene.add_geometry(cav, node_name="MouthCavity", geom_name="MouthCavity")
    scene.add_geometry(ton, node_name="Tongue", geom_name="Tongue")
    tmp = out_path + ".base.glb"
    scene.export(tmp)

    def delta_fn(positions, lo, hi):
        m2, s2, fa2, sg2 = _mouth_anchor((lo, hi), cfg)
        return _jaw_delta(positions, m2, s2, fa2, sg2, cfg)

    stats = _inject_jaw_morph(tmp, out_path, len(head.vertices), delta_fn, cfg)

    report = {
        "input": in_path,
        "output": out_path,
        "head_bounds": {"min": bounds[0].tolist(), "max": bounds[1].tolist()},
        "mouth_anchor": mouth.tolist(),
        "config": cfg,
        "stats": stats,
    }
    if config_out:
        with open(config_out, "w") as f:
            json.dump(report, f, indent=2)
    return report


if __name__ == "__main__":
    import sys
    inp = sys.argv[1] if len(sys.argv) > 1 else "test_head.glb"
    out = sys.argv[2] if len(sys.argv) > 2 else "test_head.rigged.glb"
    rep = process(inp, out, config_out="test_head.config.json")
    print(json.dumps(rep["stats"], indent=2))
    print("mouth anchor:", [round(x, 3) for x in rep["mouth_anchor"]])
