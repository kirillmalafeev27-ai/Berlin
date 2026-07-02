# facerig v0.1 — the first brick

Turns a **sealed head GLB** (AI-generated, no mouth hole) into a GLB that
**talks** in Three.js, with zero manual sculpting.

## What it does

1. **Mouth cavity** — sinks a dark ellipsoid inside the head so an opening mouth
   reads as depth, not a hole through the skull.
2. **Tongue** — a simple primitive inside the cavity.
3. **`jawOpen` morph target** — procedurally pulls the lower-front of the face
   down + slightly forward with a smooth Gaussian falloff (proportional-edit,
   but automatic). Driving `jawOpen` 0→1 opens the mouth.
4. **Calibration config** — every parameter it used, as JSON, so a future visual
   tool can tune placement per character without re-running code.

## Run

```bash
pip install trimesh numpy pygltflib
python3 facerig.py your_head.glb your_head.rigged.glb
```

Bad guess on mouth position? Everything is a number in the config — override it:

```python
from facerig import process
process("head.glb", "head.rigged.glb", cfg={
    "mouth_height_frac": 0.34,   # mouth higher up
    "jaw_strength_frac": 0.20,   # opens wider
    "front_axis": "z", "front_sign": 1,
}, config_out="head.config.json")
```

## Runtime (Three.js)

`lipsync-runtime.js` drives the morph straight from ElevenLabs audio amplitude —
no timestamps, no phoneme mapping, works for German out of the box:

```js
const mouth = new CharacterMouth(gltf, { strength: 1.4 });
await mouth.speakFromElevenLabs(germanLine, voiceId, apiKey);
// in render loop: mouth.update();
```

## What this v0.1 is — and isn't

- **Is:** a working end-to-end pipeline that makes any sealed head talk with a
  believable jaw. Tested on a synthetic sealed head (642 verts): 99 lower-front
  vertices driven, mouth opens ~0.13 of head height. Stylized-friendly.
- **Isn't (yet):** real visemes (lips forming O/M/U) or emotion blendshapes.
  Placement uses bounding-box heuristics (front hemisphere), not ML — so odd
  head orientations may need a config tweak. This is the calibration surface the
  eventual product/tool exposes as sliders.

## Why it's the seed of the service

The three hard problems that make this valuable — generating the missing mouth
cavity, procedurally deforming a *dirty* mesh with no clean edge loops, and doing
it on arbitrary AI-generated topology — are exactly the things off-the-shelf
tools (MetaHuman, Didimo) skip because they assume clean meshes. Prove it on your
own 16 German-quest characters first; that's your demo and your before/after.

Next bricks: (a) auto-detect front axis so orientation is never wrong,
(b) a browser calibration UI over these same config numbers, (c) real viseme
morphs for articulation.
