import type { IpcMain, WebContents } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import type { ColorCorrection, ExportSpec } from '../../src/types.js';

const require = createRequire(import.meta.url);

function colorToEqFilter(c: ColorCorrection | undefined): string {
  if (!c || !c.enabled) return '';
  const parts: string[] = [];
  if (c.brightness !== 0) parts.push(`brightness=${c.brightness.toFixed(3)}`);
  if (c.contrast !== 0) parts.push(`contrast=${(1 + c.contrast).toFixed(3)}`);
  if (c.saturation !== 0) parts.push(`saturation=${(1 + c.saturation).toFixed(3)}`);
  if (c.gamma !== 0) parts.push(`gamma=${Math.pow(2, c.gamma).toFixed(3)}`);
  if (parts.length === 0) return '';
  return `eq=${parts.join(':')}`;
}

function resolveFfmpegPath(): string {
  const p = require('ffmpeg-static') as string;
  return p.replace('app.asar', 'app.asar.unpacked');
}

const ffmpegPath = resolveFfmpegPath();

let activeChild: ChildProcess | null = null;

function buildExportArgs(spec: ExportSpec): string[] {
  const { clips, tracks, assets, output, totalDuration } = spec;
  const { width, height, fps, crf, path } = output;

  const safeTotal = Math.max(0.1, totalDuration);

  const inputs: string[] = [];
  const inputIdxByAsset = new Map<string, number>();
  for (const clip of clips) {
    const asset = assets.find((a) => a.id === clip.assetId);
    if (!asset) continue;
    if (!inputIdxByAsset.has(asset.id)) {
      inputIdxByAsset.set(asset.id, inputs.length);
      inputs.push(asset.filePath);
    }
  }

  const filters: string[] = [];

  // Base black canvas
  filters.push(
    `color=c=black:size=${width}x${height}:duration=${safeTotal.toFixed(3)}:rate=${fps}[bg0]`,
  );
  let bgIdx = 0;

  // Bottom-up so top tracks overlay last
  const videoTracksBU = tracks.filter((t) => t.kind === 'video').slice().reverse();

  for (const track of videoTracksBU) {
    const trackClips = clips
      .filter((c) => c.trackId === track.id && c.mediaKind === 'video')
      .sort((a, b) => a.startSec - b.startSec);

    for (const clip of trackClips) {
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset) continue;
      const inputIdx = inputIdxByAsset.get(asset.id)!;
      const segLabel = `v_${clip.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      const clipDur = clip.outSec - clip.inSec;
      const clipEnd = clip.startSec + clipDur;

      const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
      const isFullCrop = crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1;
      const cropFilter = isFullCrop
        ? ''
        : `crop=iw*${crop.w.toFixed(4)}:ih*${crop.h.toFixed(4)}:iw*${crop.x.toFixed(4)}:ih*${crop.y.toFixed(4)},`;

      const clipEq = colorToEqFilter(clip.color);
      const trackEq = colorToEqFilter(track.color);
      const colorFilters =
        (clipEq ? `${clipEq},` : '') + (trackEq ? `${trackEq},` : '');

      filters.push(
        `[${inputIdx}:v]` +
          `trim=start=${clip.inSec.toFixed(3)}:end=${clip.outSec.toFixed(3)},` +
          `setpts=PTS-STARTPTS,` +
          cropFilter +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          colorFilters +
          `setpts=PTS+${clip.startSec.toFixed(3)}/TB` +
          `[${segLabel}]`,
      );

      const newBg = `bg${bgIdx + 1}`;
      filters.push(
        `[bg${bgIdx}][${segLabel}]overlay=` +
          `x=0:y=0:` +
          `enable='between(t,${clip.startSec.toFixed(3)},${clipEnd.toFixed(3)})':` +
          `eof_action=pass` +
          `[${newBg}]`,
      );
      bgIdx++;
    }
  }

  let finalVideo = `bg${bgIdx}`;
  const projectEq = colorToEqFilter(spec.projectColor);
  if (projectEq) {
    filters.push(`[${finalVideo}]${projectEq}[vout]`);
    finalVideo = 'vout';
  }

  const audioStreams: string[] = [];

  for (const track of tracks.filter((t) => t.kind === 'audio' && !t.muted)) {
    const trackClips = clips
      .filter((c) => c.trackId === track.id && c.mediaKind === 'audio')
      .sort((a, b) => a.startSec - b.startSec);
    for (const clip of trackClips) {
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset || !asset.hasAudio) continue;
      const inputIdx = inputIdxByAsset.get(asset.id)!;
      const delayMs = Math.max(0, Math.round(clip.startSec * 1000));
      const segLabel = `a_${clip.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      filters.push(
        `[${inputIdx}:a]` +
          `atrim=start=${clip.inSec.toFixed(3)}:end=${clip.outSec.toFixed(3)},` +
          `asetpts=PTS-STARTPTS,` +
          `volume=${track.volume.toFixed(3)},` +
          `adelay=${delayMs}:all=1` +
          `[${segLabel}]`,
      );
      audioStreams.push(`[${segLabel}]`);
    }
  }

  for (const track of tracks.filter((t) => t.kind === 'video' && !t.muted)) {
    const trackClips = clips
      .filter((c) => c.trackId === track.id && c.mediaKind === 'video' && !c.extractedAudio)
      .sort((a, b) => a.startSec - b.startSec);
    for (const clip of trackClips) {
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset || !asset.hasAudio) continue;
      const inputIdx = inputIdxByAsset.get(asset.id)!;
      const delayMs = Math.max(0, Math.round(clip.startSec * 1000));
      const segLabel = `va_${clip.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      filters.push(
        `[${inputIdx}:a]` +
          `atrim=start=${clip.inSec.toFixed(3)}:end=${clip.outSec.toFixed(3)},` +
          `asetpts=PTS-STARTPTS,` +
          `volume=${track.volume.toFixed(3)},` +
          `adelay=${delayMs}:all=1` +
          `[${segLabel}]`,
      );
      audioStreams.push(`[${segLabel}]`);
    }
  }

  let finalAudio: string | null = null;
  if (audioStreams.length === 1) {
    finalAudio = audioStreams[0];
  } else if (audioStreams.length > 1) {
    filters.push(
      `${audioStreams.join('')}amix=inputs=${audioStreams.length}:duration=longest:dropout_transition=0:normalize=0[aout]`,
    );
    finalAudio = '[aout]';
  }

  const args: string[] = ['-y', '-hide_banner'];
  for (const inp of inputs) {
    args.push('-i', inp);
  }
  args.push('-filter_complex', filters.join(';'));
  args.push('-map', `[${finalVideo}]`);
  if (finalAudio) args.push('-map', finalAudio);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf));
  args.push('-r', String(fps));
  args.push('-pix_fmt', 'yuv420p');
  if (finalAudio) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }
  args.push('-t', safeTotal.toFixed(3));
  args.push(path);

  return args;
}

function runExport(
  spec: ExportSpec,
  webContents: WebContents,
): Promise<{ ok: boolean; path: string }> {
  if (activeChild) {
    return Promise.reject(new Error('Экспорт уже выполняется'));
  }

  const args = buildExportArgs(spec);
  const total = Math.max(0.1, spec.totalDuration);

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args);
    activeChild = child;
    let stderrTail = '';

    child.stderr.on('data', (buf) => {
      const str = buf.toString();
      stderrTail = (stderrTail + str).slice(-3000);
      const match = /time=(\d+):(\d+):(\d+)\.(\d+)/.exec(str);
      if (match) {
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const s = parseInt(match[3], 10);
        const cs = parseInt(match[4], 10);
        const currentSec = h * 3600 + m * 60 + s + cs / 100;
        const progress = Math.max(0, Math.min(1, currentSec / total));
        try {
          webContents.send('ffmpeg:exportProgress', {
            progress,
            currentSec,
            totalSec: total,
          });
        } catch {
          /* renderer gone */
        }
      }
    });

    child.on('error', (err) => {
      activeChild = null;
      reject(err);
    });
    child.on('close', (code, signal) => {
      activeChild = null;
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new Error('Экспорт отменён'));
        return;
      }
      if (code === 0) {
        resolve({ ok: true, path: spec.output.path });
      } else {
        reject(new Error(`ffmpeg вышел с кодом ${code}\n${stderrTail.slice(-1500)}`));
      }
    });
  });
}

export function registerExportHandlers(ipcMain: IpcMain) {
  ipcMain.handle('ffmpeg:export', (e, spec: ExportSpec) => runExport(spec, e.sender));
  ipcMain.handle('ffmpeg:cancelExport', () => {
    if (activeChild && !activeChild.killed) {
      activeChild.kill('SIGTERM');
      return true;
    }
    return false;
  });
}
