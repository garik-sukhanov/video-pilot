#!/usr/bin/env node
// Regenerates build/icon.icns (and build/icon.png) from gen-icon-png.mjs.
// Renders a 1024px master PNG, derives all iconset sizes with `sips`, and
// packs them into an .icns with `iconutil` (both ship with macOS).
//
// Usage: node scripts/prepare-icon.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const buildDir = join(root, 'build');
mkdirSync(buildDir, { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'vp-icon-'));
const master = join(work, 'icon-1024.png');

console.log('rendering 1024px master...');
execFileSync('node', [join(here, 'gen-icon-png.mjs'), master], { stdio: 'inherit' });

const iconset = join(work, 'icon.iconset');
mkdirSync(iconset);
const sizes = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
];
for (const [name, px] of sizes) {
  execFileSync('sips', ['-z', String(px), String(px), master, '--out', join(iconset, name)], { stdio: 'ignore' });
}
copyFileSync(master, join(iconset, 'icon_512x512@2x.png'));

console.log('packing icon.icns...');
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')]);
copyFileSync(master, join(buildDir, 'icon.png'));
rmSync(work, { recursive: true, force: true });
console.log('wrote build/icon.icns and build/icon.png');
