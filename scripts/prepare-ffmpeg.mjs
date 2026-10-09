#!/usr/bin/env node
// Prepares the binaries bundled into the packaged macOS app:
//   build/vendor/ffmpeg/ffmpeg   — universal (x86_64 + arm64) fat binary
//   build/vendor/ffmpeg/ffprobe  — x86_64 (runs native on Intel, via Rosetta on Apple Silicon)
//
// ffmpeg-static only installs a single-arch ffmpeg for the host, so for a
// universal build we download both macOS slices from the same release and
// lipo them together. Idempotent: skips work if the outputs already exist.
//
// Usage: node scripts/prepare-ffmpeg.mjs [--force]

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, createWriteStream, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build', 'vendor', 'ffmpeg');
const force = process.argv.includes('--force');

const ffmpegOut = join(outDir, 'ffmpeg');
const ffprobeOut = join(outDir, 'ffprobe');

if (!force && existsSync(ffmpegOut) && existsSync(ffprobeOut)) {
  console.log('ffmpeg/ffprobe already prepared — use --force to rebuild');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const releaseTag = require('ffmpeg-static/package.json')['ffmpeg-static']['binary-release-tag'];
const base = `https://github.com/eugeneware/ffmpeg-static/releases/download/${releaseTag}`;

async function downloadGz(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await pipeline(res.body, createGunzip(), createWriteStream(dest));
  chmodSync(dest, 0o755);
}

const tmpArm = join(outDir, '.ffmpeg-arm64');
const tmpX64 = join(outDir, '.ffmpeg-x64');

console.log(`downloading ffmpeg ${releaseTag} (arm64 + x64)...`);
await downloadGz(`${base}/ffmpeg-darwin-arm64.gz`, tmpArm);
await downloadGz(`${base}/ffmpeg-darwin-x64.gz`, tmpX64);

console.log('lipo -> universal ffmpeg');
execFileSync('lipo', ['-create', tmpArm, tmpX64, '-output', ffmpegOut]);
chmodSync(ffmpegOut, 0o755);
rmSync(tmpArm); rmSync(tmpX64);

// ffprobe-static ships an x86_64 ffprobe (works on Intel natively, Apple Silicon via Rosetta)
const ffprobeStatic = join(root, 'node_modules', 'ffprobe-static', 'bin', 'darwin', 'x64', 'ffprobe');
console.log('copy ffprobe (x86_64)');
copyFileSync(ffprobeStatic, ffprobeOut);
chmodSync(ffprobeOut, 0o755);

console.log('done:');
console.log('  ', ffmpegOut, '->', execFileSync('lipo', ['-archs', ffmpegOut]).toString().trim());
console.log('  ', ffprobeOut, '->', execFileSync('lipo', ['-archs', ffprobeOut]).toString().trim());
