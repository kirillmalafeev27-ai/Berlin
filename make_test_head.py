"""
make_test_head.py
Generates a synthetic 'sealed' humanoid-ish head GLB with NO mouth opening,
to mimic the AI-generated heads the real tool must handle.
Convention: +Y up, +Z front (face looks toward +Z).
"""
import numpy as np
import trimesh


def make_head(path="test_head.glb"):
    # Start from an icosphere, then squash/stretch into a rough head shape.
    head = trimesh.creation.icosphere(subdivisions=3, radius=1.0)
    v = head.vertices.copy()

    # Stretch vertically (taller than wide), flatten depth a touch.
    v[:, 0] *= 0.78   # x  (width)
    v[:, 1] *= 1.05   # y  (height)
    v[:, 2] *= 0.85   # z  (depth)

    # Pull the chin down a bit on the lower-front to feel like a jaw.
    lower_front = (v[:, 1] < -0.2) & (v[:, 2] > 0.2)
    v[lower_front, 1] -= 0.15

    head.vertices = v

    # Simple skin-ish material.
    head.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            name="skin",
            baseColorFactor=[0.85, 0.68, 0.58, 1.0],
            metallicFactor=0.0,
            roughnessFactor=0.9,
        )
    )
    head.metadata["name"] = "Head"

    scene = trimesh.Scene()
    scene.add_geometry(head, node_name="Head", geom_name="Head")
    scene.export(path)
    print(f"wrote {path}: {len(head.vertices)} verts, {len(head.faces)} faces")
    return path


if __name__ == "__main__":
    make_head()
