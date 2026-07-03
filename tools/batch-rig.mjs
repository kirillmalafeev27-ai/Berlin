#!/usr/bin/env node
// batch-rig.mjs — apply a saved facerig config to GLB characters headlessly.
// Uses the exact same rig-pipeline the browser Export button uses.
//
//   node tools/batch-rig.mjs <config.json> <model.glb> [more.glb ...]
//
// Output: <model>.rigged.glb next to each input. The config's head box was
// calibrated on one character; models with roughly the same proportions rig
// fine with the shared config — recalibrate outliers in the web tool.

import fs from 'node:fs';
import path from 'node:path';
import { rigGLB } from '../web/js/rig-pipeline.js';

const [configPath, ...models] = process.argv.slice(2);
if (!configPath || !models.length) {
  console.error('usage: node tools/batch-rig.mjs <config.json> <model.glb> [more.glb ...]');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
let failed = 0;

for (const model of models) {
  const out = model.replace(/\.glb$/i, '') + '.rigged.glb';
  try {
    const buf = fs.readFileSync(model);
    const { bytes, stats } = rigGLB(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), config);
    fs.writeFileSync(out, bytes);
    console.log(`✓ ${path.basename(model)} → ${path.basename(out)}  ` +
      `(driven ${stats.driven}, cut +${stats.cut_added}, max offset ${stats.maxOffset.toFixed(4)})`);
  } catch (e) {
    failed++;
    console.error(`✗ ${path.basename(model)}: ${e.message}`);
  }
}
process.exit(failed ? 2 : 0);
