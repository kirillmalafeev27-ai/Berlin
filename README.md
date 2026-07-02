# facerig — jaw-open lip-sync rigs for AI-generated GLBs

## v0.2 — browser calibration tool (`web/`)

The Python prototype below is now ported to the browser as a visual, per-model
calibration tool. No build step, no CDN — three.js is vendored:

```bash
python3 -m http.server 8000   # from the repo root (any static server works)
# open http://localhost:8000/web/
```

Workflow (once per character, ×16):

1. **Drop a GLB** onto the page — full-body models are fine.
2. The tool **auto-guesses the head box** (top slice of the body; a head-only
   model is detected by its footprint and used whole). Adjust the blue box with
   the gizmo (`Head region → gizmo: region move/scale`) or pick another mesh
   from the dropdown / double-click a mesh in the viewport.
3. The **mouth anchor** (yellow dot) is auto-snapped from the bbox front plane
   (nose-tip depth) onto the actual lip surface. Drag it in `mouth anchor`
   gizmo mode, or tune `Mouth / jaw` sliders. All the `facerig.py` config
   fields are live: front axis/sign, mouth height, region σ, jaw strength,
   jaw forward, plus cavity/tongue scale & offsets.
4. **Preview**: `jawOpen` slider 0→1, x-ray head toggle, or drive it from
   audio — a local file, the microphone, or a live ElevenLabs request
   (`Audio test → ElevenLabs`, key is used client-side for testing only).
5. **Export rigged GLB** — the `jawOpen` morph, dark mouth cavity and tongue
   are injected by *patching the original binary* (same approach as the
   pygltflib path in Python): skinning, textures, animations and extensions
   survive byte-identical. Passes `gltf-validator` with 0 errors.
   **Export config JSON** saves every parameter; re-importing it reproduces
   the exact same rig (verified round-trip).

Notes:

- The deformation math is a line-for-line port of `facerig.py:_jaw_delta` —
  on `test_head.glb` it drives the same 99 vertices with the same 0.13-of-head
  max opening as the Python version.
- New over Python (all default-off / additive, config schema stays compatible):
  head-region box with soft edge falloff (`region_falloff_frac`),
  `mouth_offset_frac` / `cavity_offset_frac` / `tongue_offset_frac` nudges,
  lip-surface anchor snapping.
- If the model is skinned (mixamo), the cavity/tongue nodes are parented to the
  head joint so they follow body animation; the morph is added to the skinned
  primitives themselves.
- Draco/meshopt-compressed GLBs are rejected with a clear message — decompress
  first (`gltf-transform draco --decompress in.glb out.glb`).

### Roadmap (what would improve the tool most, in order)

1. **A real mouth opening.** v1 stretches the sealed shell (chin drop) — the
   dark cavity is only visible if the surface actually separates. The next big
   brick is a spatial *lip cut*: split vertices along the mouth line inside the
   mouth width, so `jawOpen` reveals the cavity. This is the difference between
   "talking chin" and a mouth.
2. **Verify on a mixamo-rigged export.** `Али.glb` has no skeleton yet; the
   skinned path (morph on skinned primitives + cavity under `mixamorig:Head`)
   is implemented but should be e2e-checked on a rigged character.
3. **Batch mode** (milestone 6): `facerig-core.js` is three.js-free on purpose —
   a small node script can apply saved config JSONs to all 16 characters.
4. **Visemes via ElevenLabs timestamps** — the with-timestamps endpoint gives
   character timing; even 3 mouth shapes (open/closed/OO) would upgrade the read.
5. Auto-detect front axis/sign; Draco decompression in-tool; rotation gizmo for
   cavity/tongue.

---

# facerig v0.1 — the first brick (Python prototype)

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
