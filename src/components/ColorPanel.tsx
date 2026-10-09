import { useStore } from '../store';
import type { ColorCorrection } from '../types';
import { NEUTRAL_COLOR } from '../types';

interface SliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}

function Slider({ label, value, onChange, hint }: SliderProps) {
  const pct = Math.round(value * 100);
  return (
    <div className="mb-2.5">
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-gray-400">{label}</span>
        <span className="font-mono text-gray-300">
          {pct > 0 ? '+' : ''}
          {pct}
        </span>
      </div>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => onChange(0)}
        className="w-full accent-accent h-1.5"
        title={hint ?? 'Двойной клик — сбросить'}
      />
    </div>
  );
}

export function ColorPanel() {
  const target = useStore((s) => s.activeColorTarget);
  const close = useStore((s) => s.closeColorPanel);
  const projectColor = useStore((s) => s.projectColor);
  const tracks = useStore((s) => s.tracks);
  const clips = useStore((s) => s.clips);
  const assets = useStore((s) => s.assets);
  const setProjectColor = useStore((s) => s.setProjectColor);
  const setTrackColor = useStore((s) => s.setTrackColor);
  const setClipColor = useStore((s) => s.setClipColor);
  const resetColor = useStore((s) => s.resetColor);

  if (!target) return null;

  let color: ColorCorrection = NEUTRAL_COLOR;
  let title = '';

  if (target.kind === 'project') {
    color = projectColor;
    title = 'Цвет · весь проект';
  } else if (target.kind === 'track') {
    const t = tracks.find((x) => x.id === target.id);
    color = t?.color ?? NEUTRAL_COLOR;
    title = `Цвет · «${t?.label ?? ''}»`;
  } else {
    const c = clips.find((x) => x.id === target.id);
    const asset = c ? assets.find((a) => a.id === c.assetId) : null;
    color = c?.color ?? NEUTRAL_COLOR;
    title = `Цвет · клип «${asset?.fileName ?? ''}»`;
  }

  function update(patch: Partial<ColorCorrection>) {
    const merged = { ...color, ...patch };
    if (
      patch.brightness !== undefined ||
      patch.contrast !== undefined ||
      patch.saturation !== undefined ||
      patch.gamma !== undefined
    ) {
      // If user moves a slider, auto-enable so the change is visible
      if (!merged.enabled && (merged.brightness !== 0 || merged.contrast !== 0 || merged.saturation !== 0 || merged.gamma !== 0)) {
        merged.enabled = true;
      }
    }
    if (target!.kind === 'project') {
      setProjectColor(merged);
    } else if (target!.kind === 'track') {
      setTrackColor(target!.id, merged);
    } else {
      setClipColor(target!.id, merged);
    }
  }

  const isNeutral =
    color.brightness === 0 &&
    color.contrast === 0 &&
    color.saturation === 0 &&
    color.gamma === 0;

  return (
    <div
      className="fixed z-40 bg-panel-2 border border-border rounded-lg shadow-2xl p-3 w-64"
      style={{ top: 70, right: 16 }}
    >
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[11px] uppercase tracking-wider text-gray-400 truncate" title={title}>
          {title}
        </h3>
        <button
          onClick={close}
          className="text-gray-500 hover:text-white text-xs ml-2"
          title="Закрыть"
        >
          ✕
        </button>
      </div>

      <label className="flex items-center gap-2 mb-3 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={color.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="accent-accent"
        />
        <span className={color.enabled ? 'text-white' : 'text-gray-500'}>
          {color.enabled ? 'Применяется' : 'Отключено'}
        </span>
      </label>

      <Slider label="Яркость" value={color.brightness} onChange={(v) => update({ brightness: v })} />
      <Slider label="Контраст" value={color.contrast} onChange={(v) => update({ contrast: v })} />
      <Slider
        label="Насыщенность"
        value={color.saturation}
        onChange={(v) => update({ saturation: v })}
      />
      <Slider
        label="Гамма"
        value={color.gamma}
        onChange={(v) => update({ gamma: v })}
        hint="ffmpeg eq gamma · превью без гаммы"
      />

      <div className="flex gap-2 mt-3 pt-2 border-t border-border">
        <button
          onClick={() => resetColor(target!)}
          disabled={isNeutral}
          className="flex-1 px-2 py-1 text-[11px] rounded bg-panel-3 hover:bg-panel-3/60 border border-border disabled:opacity-40"
        >
          Сбросить
        </button>
        <button
          onClick={close}
          className="flex-1 px-2 py-1 text-[11px] rounded bg-accent hover:bg-accent/80 text-white"
        >
          Готово
        </button>
      </div>
    </div>
  );
}
