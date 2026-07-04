# facerig — jaw-open lip-sync rigs for AI-generated GLBs

## v0.5 — scale-proof units, front-facing lip volume, lip tint

Three fixes on top of the v0.4 volumetric mouth:

1. **Scale normalization.** Models arrive in arbitrary units (Mixamo FBX
   meshes are 1/100 scale). All mouth-surgery math now runs with the head
   normalized to 1 unit and results scale back on export — any of the 16
   characters behaves identically with zero manual tweaking. The stats line
   shows the scale-independent opening percentage; `jawOpen` preview is
   clamped to 0..1 (opening amount is `jaw strength`'s job); `lip_cut` and
   `lip_rim` are ON by default (their being off was the real cause of the
   "need jawOpen=2" symptom). The tongue is sized by the calibrated slit
   width, rests inside the pocket, and carries its own `jawOpen` morph so it
   rides the lower jaw (70% of the drop) in the tool, the preview page and
   the game runtime alike.
2. **Lips read head-on.** The v0.4 rim was extruded inward+backward, so from
   the front the player looked straight down the extrusion axis at a flat
   slit. The lip strip is now a **roll**: it arcs forward by `lip_bulge`,
   separates the upper/lower lips by `lip_split`, wraps over a
   `bevel_width`-radius outer arc (`bevel_segments` rings — the bevel is on
   the visible outer edge now) and tucks into the skin. The pocket welds at
   the slit line itself and at the roll ends (exact record reuse, crack test
   still asserts zero divergence at any jawOpen).
3. **Lip tint.** Roll vertices get `COLOR_0` vertex colors blending toward
   `lip_color` (soft stylized pink) with a sin-dome band reshaped by
   `lip_color_blend` — feathered into the skin, no hard mask edge, capped
   below full saturation so it never reads as lipstick. Existing vertices
   stay white (a no-op multiplier over the texture); works whether or not
   the source mesh already had vertex colors.

Known limitation (by design): stylized low-poly lip pads, not photoreal
anatomy — there are still no anatomical edge loops around the mouth.

## v0.4 — volumetric mouth (no more paper-thin angular slit)

The v0.3 slit inherited the low-poly angularity and had single-polygon edges.
v0.4 rebuilds the mouth with generated geometry, live in the tool:

1. **Knife cut** — stylized faces paint the mouth onto 2–4 giant triangles;
   there are no edges along the lip line at all. The knife slices every
   triangle straddling the mouth plane inside the slit window, cutting a
   straight dense seam through triangle interiors. Decisions are made per
   edge, so both owners of an edge always agree — no T-junctions.
2. **Seam subdivision** (`lip_subdiv`, default 3) — every seam edge is split
   into N segments. New verts sit exactly on the old edges (rest pose is
   unchanged), but the jaw gaussian gets sampled densely along the lip, so
   the opening becomes a smooth arc instead of a low-poly zigzag.
3. **Volumetric lips** (`lip_rim`) — a bevel strip (1–3 rings, face-textured)
   rounds the lip edge backward, and a dark **pocket** primitive continues
   inward: rim walls → rounded cap. The pocket's opening ring reuses the
   bevel weld-ring data verbatim — identical positions, identical morph
   deltas, skinning copied from the same source verts — a real weld with no
   gap at any `jawOpen` value (asserted in tests, not just eyeballed).

New config params (all in the exported config JSON, UI in *Mouth / jaw*):
`lip_subdiv`, `lip_rim`, `rim_depth`, `rim_segments`, `bevel_width`,
`bevel_segments`, `edge_smooth` (Laplacian smoothing of the extrusion path —
tames crooked Meshy edges).

The hard requirements hold by construction:

- every generated vertex carries **provenance** (a weighted list of source
  verts) — jawOpen/mouthPucker deltas, UVs, normals, pre-existing morphs and
  **JOINTS/WEIGHTS** all flow through it, so nothing new is ever left
  unskinned or morphless (the classic "rim stays behind the opening lip" bug
  is tested against directly);
- all work is confined to the head-region box;
- seam matching runs with a spatial tolerance — "coincident" duplicate verts
  on AI exports drift by ~1e-4 of head height and exact matching breaks;
- the mouth-surgery passes are pure functions shared by the browser preview,
  the Export button and the batch CLI (byte-identical outputs, asserted).

Implementation note: the spec suggested `three-mesh-bvh` and
`@gltf-transform/core`. Neither was needed: provenance makes nearest-vertex
searches trivial (every new vert descends from known verts), boundary loops
come from tolerance-based edge matching (BVH doesn't help there), and the
existing zero-dependency GLB patcher already preserves morphs, skinning and
byte alignment — it passes `gltf-validator` with 0 errors on all three test
characters and keeps the Render deploy dependency-free.

**Known limitation (by design):** this adds *thickness*, not anatomy. There
are still no anatomical edge loops around the mouth, so extreme openings read
stylized rather than photoreal — fine for the game's low-poly register.

## v0.3 — web service (calibration tool + game preview + TTS proxy)

Everything from the v0.2 roadmap is now implemented:

| Roadmap item | Status |
| --- | --- |
| 1. Real mouth opening (lip cut) | ✅ `lip_cut` config — the mouth line is split (welded meshes: vertex duplication; flat-shaded meshes: lower-lip masking) so `jawOpen` reveals the cavity + tongue instead of stretching skin |
| 2. Verify on a mixamo rig | ✅ `ali_mixamo.glb` (converted from the Mixamo FBX with FBX2glTF) goes through the whole flow in e2e tests; the morph lands on the skinned primitives and the cavity/tongue are parented under `mixamorig:Head` via its inverse-bind matrix |
| 3. Batch mode | ✅ `tools/batch-rig.mjs` — the browser Export and the CLI share one pure pipeline (`web/js/rig-pipeline.js`); outputs are byte-identical (asserted in e2e) |
| 4. Visemes via timestamps | ✅ both TTS paths use the ElevenLabs *with-timestamps* endpoint; the runtime closes the mouth on м/б/п and drives the new `mouthPucker` morph on o/u/ö/ü |
| 5. Auto front axis, rotation gizmos | ✅ face direction auto-detected (nose protrusion + vertex density, falls back to manual); cavity/tongue rotation sliders |

### Run locally

```bash
ELEVENLABS_API_KEY=sk_... node server.mjs     # key optional — TTS disabled without it
# calibration tool:  http://localhost:8080/
# game preview:      http://localhost:8080/preview.html
```

(The static tool also works with any file server, e.g. `python3 -m http.server` —
only `/api/tts` needs the node server.)

### Deploy on Render

`render.yaml` is a ready blueprint: **New → Blueprint** on
[dashboard.render.com](https://dashboard.render.com), point it at this repo,
then set `ELEVENLABS_API_KEY` (and optionally `ELEVENLABS_VOICE_ID`) in the
service's Environment tab. The key never reaches the browser — the client
calls `POST /api/tts` on your service.

### Game preview (`/preview.html`)

The "real conditions" page: a rigged character on a stage with lighting and a
procedural idle, plus a text bar. Type a line → **Speak** → ElevenLabs TTS
with timestamps → the character talks with viseme-refined lip-sync using
`web/js/lipsync-runtime.js`, the exact module the game will import. The last
GLB you exported from the calibration tool opens here automatically (handed
over via IndexedDB); you can also drop any rigged GLB or pass `?model=<url>`.

### Batch mode

```bash
node tools/batch-rig.mjs ali.config.json char1.glb char2.glb ...
# → char1.rigged.glb, char2.rigged.glb (same code path as the browser export)
```

---

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

### Roadmap — done in v0.3 (see the table at the top)

All five items shipped: lip cut, mixamo verification, batch mode,
timestamp visemes (`mouthPucker`), auto orientation + rotation controls.
Still open for later: Draco decompression in-tool (compressed GLBs are
rejected with a clear message), real ARKit-style viseme sets, emotion morphs.

Known divergence from the Python prototype: the tongue's forward offset is
+0.06 of head depth (Python used +0.15, which pokes through closed lips on
real heads with mustaches); `_jaw_delta` itself is still port-identical when
`lip_cut` is off.

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

`web/js/lipsync-runtime.js` (moved there in v0.3) drives the morph straight from ElevenLabs audio amplitude —
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
