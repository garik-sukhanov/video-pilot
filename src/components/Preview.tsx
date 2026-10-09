import { useLayoutEffect, useRef, useState } from 'react';
import { useStore, formatTime } from '../store';
import { PlaybackEngine } from './PlaybackEngine';
import { FramingOverlay } from './FramingOverlay';
import { ProjectFormatPicker } from './ProjectFormatPicker';

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isPlaying = useStore((s) => s.isPlaying);
  const playheadSec = useStore((s) => s.playheadSec);
  const togglePlay = useStore((s) => s.togglePlay);
  const seek = useStore((s) => s.seek);
  const totalDuration = useStore((s) => s.getTotalDuration());
  const hasClips = useStore((s) => s.clips.length > 0);
  const framingOpen = useStore((s) => s.framingEditOpen);
  const enterFraming = useStore((s) => s.enterFramingMode);
  const hasVideoClip = useStore((s) => s.clips.some((c) => c.mediaKind === 'video'));
  const projectW = useStore((s) => s.exportSettings.width);
  const projectH = useStore((s) => s.exportSettings.height);
  const projectColor = useStore((s) => s.projectColor);
  const openColorPanel = useStore((s) => s.openColorPanel);
  const setProjectColor = useStore((s) => s.setProjectColor);
  const activeColorTarget = useStore((s) => s.activeColorTarget);

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const projectAspect = projectW / projectH;
  let canvasW = 0;
  let canvasH = 0;
  if (containerSize.w > 0 && containerSize.h > 0) {
    const margin = 20;
    const availW = Math.max(20, containerSize.w - margin * 2);
    const availH = Math.max(20, containerSize.h - margin * 2);
    const containerAspect = availW / availH;
    if (projectAspect > containerAspect) {
      canvasW = availW;
      canvasH = availW / projectAspect;
    } else {
      canvasH = availH;
      canvasW = availH * projectAspect;
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PlaybackEngine canvasRef={canvasRef} />

      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative bg-panel flex items-center justify-center overflow-hidden"
      >
        <div
          className="relative shadow-[0_0_40px_rgba(0,0,0,0.5)] bg-black"
          style={{ width: canvasW, height: canvasH }}
        >
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          <FramingOverlay />
          {!hasClips && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm pointer-events-none">
              Перетащите ассет на таймлайн, чтобы начать.
            </div>
          )}
        </div>

        <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
          <div className="pointer-events-auto">
            <ProjectFormatPicker />
          </div>
          {!framingOpen && hasClips && (
            <div className="pointer-events-auto flex items-center gap-2">
              <div
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
                  projectColor.enabled ? 'bg-accent/30' : 'bg-black/55'
                }`}
                title="Цветокор всего проекта"
              >
                <input
                  type="checkbox"
                  checked={projectColor.enabled}
                  onChange={(e) => setProjectColor({ enabled: e.target.checked })}
                  className="accent-accent w-3 h-3"
                  title={projectColor.enabled ? 'Применяется' : 'Отключено'}
                />
                <button
                  onClick={() =>
                    activeColorTarget?.kind === 'project'
                      ? useStore.getState().closeColorPanel()
                      : openColorPanel({ kind: 'project' })
                  }
                  className="text-[11px] text-white hover:text-accent-2 px-1"
                >
                  ◐ Цвет
                </button>
              </div>
              <button
                onClick={enterFraming}
                disabled={!hasVideoClip}
                className="px-2 py-1 text-[11px] bg-black/55 hover:bg-black/75 disabled:opacity-30 text-white rounded"
                title="Кадрировать выделенный видео-клип (или активный под плейхедом)"
              >
                ⌗ Кадрировать
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-panel-2 px-4 py-2 flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={!hasClips}
          className="w-9 h-9 rounded-full bg-accent hover:bg-accent/80 disabled:opacity-30 flex items-center justify-center transition-colors"
          title="Пробел"
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className="text-xs text-gray-400 font-mono w-32">
          {formatTime(playheadSec)} / {formatTime(totalDuration)}
        </div>
        <input
          type="range"
          min={0}
          max={totalDuration || 0}
          step={0.01}
          value={playheadSec}
          onChange={(e) => seek(parseFloat(e.target.value))}
          disabled={!hasClips}
          className="flex-1 accent-accent"
        />
      </div>
    </div>
  );
}
