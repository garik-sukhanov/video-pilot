import type { IpcMain } from 'electron';
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { MediaProbe } from '../../src/types.js';

const require = createRequire(import.meta.url);

function resolveFfmpegPath(): string {
  // In a packaged app we ship per-arch ffmpeg binaries under Resources/ffmpeg
  // (see `extraResources` in package.json) and pick the one matching the slice
  // we're running as — this is what makes the universal build work on both
  // Apple Silicon (arm64) and Intel (x64).
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ffmpeg', `ffmpeg-${process.arch}`);
  }
  // Dev: fall back to the ffmpeg-static binary for the host arch.
  const p = require('ffmpeg-static') as string;
  return p.replace('app.asar', 'app.asar.unpacked');
}

function resolveFfprobePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ffmpeg', 'ffprobe');
  }
  const ffprobeStatic = require('ffprobe-static') as { path: string };
  return ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked');
}

const ffmpegPath = resolveFfmpegPath();
const ffprobePath = resolveFfprobePath();

function runJson<T = unknown>(bin: string, args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${bin} exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function runRaw(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stderr = '';
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${bin} exited with ${code}: ${stderr}`));
      else resolve();
    });
  });
}

interface FfprobeRaw {
  streams: Array<{
    codec_type: 'video' | 'audio' | 'subtitle';
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
    avg_frame_rate?: string;
    channels?: number;
    sample_rate?: string;
  }>;
  format: {
    duration?: string;
    size?: string;
    bit_rate?: string;
    format_name?: string;
  };
}

async function probe(filePath: string): Promise<MediaProbe> {
  const raw = await runJson<FfprobeRaw>(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const video = raw.streams.find((s) => s.codec_type === 'video');
  const audio = raw.streams.find((s) => s.codec_type === 'audio');
  const durationStr = raw.format.duration ?? video?.duration ?? audio?.duration ?? '0';

  let fps = 30;
  if (video?.avg_frame_rate) {
    const [num, den] = video.avg_frame_rate.split('/').map(Number);
    if (den && num) fps = num / den;
  }

  return {
    durationSec: parseFloat(durationStr) || 0,
    width: video?.width,
    height: video?.height,
    fps,
    hasVideo: !!video,
    hasAudio: !!audio,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    sizeBytes: raw.format.size ? parseInt(raw.format.size, 10) : undefined,
  };
}

function pathHash(filePath: string): string {
  return Buffer.from(filePath).toString('base64url').slice(-50);
}

async function thumbnail(filePath: string, atSec: number): Promise<string> {
  const cacheDir = join(app.getPath('userData'), 'thumbnails');
  if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });

  const out = join(cacheDir, `${pathHash(filePath)}_${Math.round(atSec * 100)}.jpg`);

  if (!existsSync(out)) {
    await runRaw(ffmpegPath, [
      '-y',
      '-ss', atSec.toString(),
      '-i', filePath,
      '-frames:v', '1',
      '-vf', 'scale=240:-2',
      '-q:v', '4',
      out,
    ]);
  }

  const buf = await readFile(out);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

const WAVEFORM_TARGET_POINTS = 2400;

async function waveform(filePath: string): Promise<number[]> {
  const cacheDir = join(app.getPath('userData'), 'waveforms');
  if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });

  const jsonPath = join(cacheDir, `${pathHash(filePath)}.json`);
  if (existsSync(jsonPath)) {
    try {
      const txt = await readFile(jsonPath, 'utf8');
      return JSON.parse(txt) as number[];
    } catch {
      /* re-extract */
    }
  }

  const rawPath = join(cacheDir, `${pathHash(filePath)}.raw`);
  await runRaw(ffmpegPath, [
    '-y',
    '-i', filePath,
    '-vn',
    '-ac', '1',
    '-ar', '4000',
    '-f', 's16le',
    rawPath,
  ]);

  const buf = await readFile(rawPath);
  const sampleCount = Math.floor(buf.byteLength / 2);
  if (sampleCount === 0) return [];

  const view = new Int16Array(buf.buffer, buf.byteOffset, sampleCount);
  const peakCount = Math.min(WAVEFORM_TARGET_POINTS, sampleCount);
  const samplesPerPeak = sampleCount / peakCount;
  const peaks: number[] = new Array(peakCount);

  for (let i = 0; i < peakCount; i++) {
    const start = Math.floor(i * samplesPerPeak);
    const end = Math.floor((i + 1) * samplesPerPeak);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(view[j]);
      if (v > max) max = v;
    }
    peaks[i] = max / 32768;
  }

  await writeFile(jsonPath, JSON.stringify(peaks));
  return peaks;
}

export function registerFfmpegHandlers(ipcMain: IpcMain) {
  ipcMain.handle('ffmpeg:probe', (_e, filePath: string) => probe(filePath));
  ipcMain.handle('ffmpeg:thumbnail', (_e, filePath: string, atSec: number) =>
    thumbnail(filePath, atSec),
  );
  ipcMain.handle('ffmpeg:waveform', (_e, filePath: string) => waveform(filePath));
}
