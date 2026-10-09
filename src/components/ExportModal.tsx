import { useEffect, useState } from 'react';
import { useStore, formatTime, isFullCrop } from '../store';
import type { ExportSpec } from '../types';

const RESOLUTION_PRESETS = [
  { label: '1080p (1920×1080)', w: 1920, h: 1080 },
  { label: '720p (1280×720)', w: 1280, h: 720 },
  { label: '4K (3840×2160)', w: 3840, h: 2160 },
  { label: '9:16 1080×1920 (Reels/Shorts)', w: 1080, h: 1920 },
  { label: '1:1 1080×1080', w: 1080, h: 1080 },
  { label: '4:5 1080×1350', w: 1080, h: 1350 },
];

const FPS_OPTIONS = [24, 25, 30, 50, 60];

const QUALITY_MAP: Record<'high' | 'medium' | 'low', { crf: number; label: string; kbpsBase: number }> = {
  high: { crf: 18, label: 'Высокое (CRF 18)', kbpsBase: 8000 },
  medium: { crf: 22, label: 'Среднее (CRF 22)', kbpsBase: 4500 },
  low: { crf: 28, label: 'Низкое (CRF 28, меньше файл)', kbpsBase: 2000 },
};

function formatBytes(b: number): string {
  if (!isFinite(b) || b <= 0) return '—';
  if (b < 1024) return `${b.toFixed(0)} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

function estimateBytes(
  w: number,
  h: number,
  fps: number,
  quality: 'high' | 'medium' | 'low',
  durationSec: number,
  hasAudio: boolean,
): number {
  const pxRate = (w * h * fps) / (1920 * 1080 * 30);
  const videoKbps = QUALITY_MAP[quality].kbpsBase * pxRate;
  const audioKbps = hasAudio ? 192 : 0;
  return ((videoKbps + audioKbps) * 1000 / 8) * durationSec;
}

export function ExportModal() {
  const open = useStore((s) => s.exportModalOpen);
  const setOpen = useStore((s) => s.setExportModalOpen);
  const settings = useStore((s) => s.exportSettings);
  const setSettings = useStore((s) => s.setExportSettings);
  const clips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);
  const assets = useStore((s) => s.assets);
  const projectColor = useStore((s) => s.projectColor);
  const lastExport = useStore((s) => s.lastExport);
  const totalDuration = useStore((s) => s.getTotalDuration());

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressSec, setProgressSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [completedPath, setCompletedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setProgress(0);
      setProgressSec(0);
      setError(null);
      setCompletedPath(null);
    }
  }, [open]);

  useEffect(() => {
    const unsub = window.vp.onExportProgress((p) => {
      setProgress(p.progress);
      setProgressSec(p.currentSec);
    });
    return unsub;
  }, []);

  if (!open) return null;

  const canExport = clips.length > 0 && totalDuration > 0 && !running;
  const hasAudio = clips.some((c) => {
    if (c.mediaKind === 'audio') return true;
    const a = assets.find((x) => x.id === c.assetId);
    return a?.probe.hasAudio && !c.extractedAudio;
  });
  const estBytes = estimateBytes(
    settings.width,
    settings.height,
    settings.fps,
    settings.quality,
    totalDuration,
    hasAudio,
  );

  async function handleExport() {
    setError(null);
    const path = await window.vp.saveFileDialog('export.mp4');
    if (!path) return;

    const spec: ExportSpec = {
      clips,
      tracks: tracks.map((t) => ({
        id: t.id,
        kind: t.kind,
        volume: t.volume,
        muted: t.muted,
        color: t.color,
      })),
      assets: assets.map((a) => ({
        id: a.id,
        filePath: a.filePath,
        hasVideo: a.probe.hasVideo,
        hasAudio: a.probe.hasAudio,
      })),
      output: {
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        crf: QUALITY_MAP[settings.quality].crf,
        path,
      },
      projectColor,
      totalDuration,
    };

    setRunning(true);
    setProgress(0);
    try {
      const result = await window.vp.runExport(spec);
      setCompletedPath(result.path);
      useStore.getState().setLastExport({
        path: result.path,
        at: new Date().toISOString(),
        ok: true,
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        quality: settings.quality,
        durationSec: totalDuration,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function handleCancel() {
    if (running) {
      await window.vp.cancelExport();
    } else {
      setOpen(false);
    }
  }

  const currentPreset = RESOLUTION_PRESETS.find(
    (p) => p.w === settings.width && p.h === settings.height,
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={() => !running && setOpen(false)}
    >
      <div
        className="bg-panel-2 border border-border rounded-lg p-5 w-[460px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium">Экспорт</h2>
          <button
            onClick={() => !running && setOpen(false)}
            disabled={running}
            className="text-gray-500 hover:text-white disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-gray-400 mb-1">Разрешение</label>
            <select
              value={currentPreset?.label ?? 'custom'}
              onChange={(e) => {
                const p = RESOLUTION_PRESETS.find((x) => x.label === e.target.value);
                if (p) setSettings({ width: p.w, height: p.h });
              }}
              disabled={running}
              className="w-full bg-panel-3 border border-border rounded px-2 py-1.5 disabled:opacity-50"
            >
              {RESOLUTION_PRESETS.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
              {!currentPreset && <option value="custom">{settings.width}×{settings.height}</option>}
            </select>
            <div className="flex gap-2 mt-1">
              <input
                type="number"
                value={settings.width}
                onChange={(e) => setSettings({ width: Math.max(2, parseInt(e.target.value, 10) || 0) })}
                disabled={running}
                className="flex-1 bg-panel-3 border border-border rounded px-2 py-1 disabled:opacity-50"
              />
              <span className="self-center text-gray-500">×</span>
              <input
                type="number"
                value={settings.height}
                onChange={(e) => setSettings({ height: Math.max(2, parseInt(e.target.value, 10) || 0) })}
                disabled={running}
                className="flex-1 bg-panel-3 border border-border rounded px-2 py-1 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 mb-1">Частота кадров</label>
              <select
                value={settings.fps}
                onChange={(e) => setSettings({ fps: parseInt(e.target.value, 10) })}
                disabled={running}
                className="w-full bg-panel-3 border border-border rounded px-2 py-1.5 disabled:opacity-50"
              >
                {FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-gray-400 mb-1">Качество</label>
              <select
                value={settings.quality}
                onChange={(e) => setSettings({ quality: e.target.value as 'high' | 'medium' | 'low' })}
                disabled={running}
                className="w-full bg-panel-3 border border-border rounded px-2 py-1.5 disabled:opacity-50"
              >
                {(['high', 'medium', 'low'] as const).map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_MAP[q].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-[11px] text-gray-500 pt-2 border-t border-border space-y-0.5">
            <div className="flex justify-between">
              <span>Длительность</span>
              <span className="font-mono text-gray-300">{formatTime(totalDuration)}</span>
            </div>
            <div className="flex justify-between">
              <span>Кодек</span>
              <span className="text-gray-300">H.264 + AAC</span>
            </div>
            <div className="flex justify-between">
              <span>Кадрирование</span>
              <span className="text-gray-300">
                {(() => {
                  const videoClips = clips.filter((c) => c.mediaKind === 'video');
                  const cropped = videoClips.filter((c) => !isFullCrop(c.crop));
                  if (cropped.length === 0) return 'без обрезки';
                  return `обрезано клипов: ${cropped.length} из ${videoClips.length}`;
                })()}
              </span>
            </div>
            <div className="flex justify-between font-medium pt-1 mt-1 border-t border-border">
              <span className="text-gray-400">Примерный размер</span>
              <span className="text-accent-2">~{formatBytes(estBytes)}</span>
            </div>
          </div>
        </div>

        {running && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="text-[11px] text-gray-400 mb-1.5 flex justify-between">
              <span>
                Рендер: {formatTime(progressSec)} / {formatTime(totalDuration)}
              </span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-2 bg-panel-3 rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        )}

        {lastExport && !running && !completedPath && (
          <div className="mt-4 pt-3 border-t border-border text-[11px] text-gray-500">
            <div className="flex items-center justify-between mb-1">
              <span>Прошлый экспорт · {new Date(lastExport.at).toLocaleString('ru-RU')}</span>
              <span className="text-gray-400">
                {lastExport.width}×{lastExport.height} · {lastExport.fps}fps
              </span>
            </div>
            <button
              onClick={() => window.vp.revealInFinder(lastExport.path)}
              className="text-accent-2 hover:text-accent underline font-mono break-all text-left"
              title="Показать в Finder"
            >
              {lastExport.path}
            </button>
          </div>
        )}

        {completedPath && !running && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="text-[11px] text-green-400 mb-1">✓ Готово</div>
            <button
              onClick={() => window.vp.revealInFinder(completedPath)}
              className="text-[11px] text-accent-2 hover:text-accent underline font-mono break-all text-left"
              title="Показать в Finder"
            >
              {completedPath}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 pt-3 border-t border-border text-[11px] text-red-400 max-h-32 overflow-y-auto font-mono whitespace-pre-wrap">
            {error}
          </div>
        )}

        <div className="flex gap-2 mt-5 justify-end">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 rounded text-xs bg-panel-3 hover:bg-panel-3/60 border border-border"
          >
            {running ? 'Отменить' : 'Закрыть'}
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="px-3 py-1.5 rounded text-xs bg-accent hover:bg-accent/80 disabled:opacity-40 disabled:hover:bg-accent text-white"
          >
            {running ? 'Экспортирую…' : 'Экспортировать'}
          </button>
        </div>
      </div>
    </div>
  );
}
