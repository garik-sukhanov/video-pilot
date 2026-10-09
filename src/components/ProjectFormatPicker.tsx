import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const FORMAT_PRESETS = [
  { label: '16:9', sublabel: 'Горизонталь · YouTube', w: 1920, h: 1080 },
  { label: '9:16', sublabel: 'Вертикаль · Reels / Shorts', w: 1080, h: 1920 },
  { label: '1:1', sublabel: 'Квадрат · Instagram', w: 1080, h: 1080 },
  { label: '4:3', sublabel: 'Классический', w: 1440, h: 1080 },
  { label: '4:5', sublabel: 'Портрет · Instagram', w: 1080, h: 1350 },
  { label: '3:4', sublabel: 'Портрет', w: 1080, h: 1440 },
];

function FormatIcon({ w, h }: { w: number; h: number }) {
  const ratio = w / h;
  let iw = 14;
  let ih = 14;
  if (ratio > 1) {
    iw = 14;
    ih = 14 / ratio;
  } else {
    ih = 14;
    iw = 14 * ratio;
  }
  return (
    <div className="w-3.5 h-3.5 flex items-center justify-center">
      <div className="border border-current rounded-sm" style={{ width: iw, height: ih }} />
    </div>
  );
}

export function ProjectFormatPicker() {
  const width = useStore((s) => s.exportSettings.width);
  const height = useStore((s) => s.exportSettings.height);
  const setSettings = useStore((s) => s.setExportSettings);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const current = FORMAT_PRESETS.find(
    (p) => Math.abs(p.w / p.h - width / height) < 0.01,
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-2 py-1 text-[11px] bg-black/55 hover:bg-black/75 text-white rounded flex items-center gap-1.5"
        title="Формат проекта (аспект всего ролика)"
      >
        <FormatIcon w={width} h={height} />
        <span>Формат: {current?.label ?? `${width}×${height}`}</span>
        <span className="text-white/60 text-[9px]">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 bg-panel-2 border border-border rounded shadow-2xl min-w-[240px] py-1 z-40">
          {FORMAT_PRESETS.map((p) => {
            const isActive = current?.label === p.label;
            return (
              <button
                key={p.label}
                onClick={() => {
                  setSettings({ width: p.w, height: p.h });
                  setOpen(false);
                }}
                className={`w-full px-2 py-1.5 text-left text-xs hover:bg-accent/30 flex items-center gap-2 ${
                  isActive ? 'bg-accent/25' : ''
                }`}
              >
                <FormatIcon w={p.w} h={p.h} />
                <div className="flex-1">
                  <div className="font-medium">{p.label}</div>
                  <div className="text-[10px] text-gray-500">{p.sublabel}</div>
                </div>
                <div className="text-[10px] text-gray-500 font-mono">
                  {p.w}×{p.h}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
