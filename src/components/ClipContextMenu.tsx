import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';

interface Props {
  clipId: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function ClipContextMenu({ clipId, x, y, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  const clip = useStore((s) => s.clips.find((c) => c.id === clipId));
  const assets = useStore((s) => s.assets);
  const playheadSec = useStore((s) => s.playheadSec);
  const splitSelectedAtPlayhead = useStore((s) => s.splitSelectedAtPlayhead);
  const trimSelectedToPlayhead = useStore((s) => s.trimSelectedToPlayhead);
  const removeClip = useStore((s) => s.removeClip);
  const unlinkClip = useStore((s) => s.unlinkClip);
  const extractAudio = useStore((s) => s.extractAudioFromClip);
  const openColorPanel = useStore((s) => s.openColorPanel);
  const setClipColor = useStore((s) => s.setClipColor);
  const resetClipCrop = useStore((s) => s.resetClipCrop);
  const enterFramingMode = useStore((s) => s.enterFramingMode);
  const selectClip = useStore((s) => s.selectClip);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth - 8) {
      nx = window.innerWidth - rect.width - 8;
    }
    if (ny + rect.height > window.innerHeight - 8) {
      ny = window.innerHeight - rect.height - 8;
    }
    setPos({ left: Math.max(8, nx), top: Math.max(8, ny) });
  }, [x, y]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!clip) return null;

  const isVideo = clip.mediaKind === 'video';
  const clipEnd = clip.startSec + (clip.outSec - clip.inSec);
  const playheadInside = playheadSec > clip.startSec + 0.05 && playheadSec < clipEnd - 0.05;
  const asset = assets.find((a) => a.id === clip.assetId);
  const canExtract = isVideo && !clip.extractedAudio && asset?.probe.hasAudio;
  const canUnlink = !!clip.linkedClipId;
  const colorEnabled = !!clip.color?.enabled;
  const hasCrop = isVideo && !!clip.crop && !(clip.crop.x === 0 && clip.crop.y === 0 && clip.crop.w === 1 && clip.crop.h === 1);

  function callAndClose(fn: () => void) {
    return () => {
      selectClip(clipId);
      fn();
      onClose();
    };
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-panel-2 border border-border rounded shadow-2xl py-1 min-w-[260px] text-xs"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wider truncate border-b border-border mb-1">
        {asset?.fileName ?? 'Клип'}
      </div>

      {isVideo && (
        <>
          <MenuItem onClick={callAndClose(() => setClipColor(clipId, { enabled: !colorEnabled }))}>
            <span>{colorEnabled ? '○ Выключить цветокор' : '● Включить цветокор'}</span>
          </MenuItem>
          <MenuItem onClick={callAndClose(() => openColorPanel({ kind: 'clip', id: clipId }))}>
            <span>◐ Открыть цветокор…</span>
          </MenuItem>
          <MenuItem onClick={callAndClose(() => enterFramingMode())}>
            <span>⌗ Кадрировать…</span>
          </MenuItem>
          {hasCrop && (
            <MenuItem onClick={callAndClose(() => resetClipCrop(clipId))}>
              <span>↺ Сбросить кадрирование</span>
            </MenuItem>
          )}
          <Divider />
        </>
      )}

      <MenuItem onClick={callAndClose(() => splitSelectedAtPlayhead())} disabled={!playheadInside}>
        <span>✂ Резать в позиции плейхеда</span>
        <kbd className="text-[10px] text-gray-500 font-mono">⌘B</kbd>
      </MenuItem>
      <MenuItem
        onClick={callAndClose(() => trimSelectedToPlayhead('left'))}
        disabled={!playheadInside}
      >
        <span>⇤ Обрезать слева от плейхеда</span>
      </MenuItem>
      <MenuItem
        onClick={callAndClose(() => trimSelectedToPlayhead('right'))}
        disabled={!playheadInside}
      >
        <span>⇥ Обрезать справа от плейхеда</span>
      </MenuItem>

      {(canExtract || canUnlink) && <Divider />}
      {canExtract && (
        <MenuItem onClick={callAndClose(() => extractAudio(clipId))}>
          <span>🎵 Извлечь звук в новую дорожку</span>
        </MenuItem>
      )}
      {canUnlink && (
        <MenuItem onClick={callAndClose(() => unlinkClip(clipId))}>
          <span>⛓ Отвязать от парного клипа</span>
        </MenuItem>
      )}

      <Divider />
      <MenuItem onClick={callAndClose(() => removeClip(clipId))} variant="danger">
        <span>✕ Удалить клип</span>
        <kbd className="text-[10px] text-gray-500 font-mono">⌫</kbd>
      </MenuItem>
    </div>
  );
}

interface MenuItemProps {
  onClick: () => void;
  disabled?: boolean;
  variant?: 'danger';
  children: React.ReactNode;
}

function MenuItem({ onClick, disabled, variant, children }: MenuItemProps) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
      className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-3 hover:bg-accent/30 disabled:opacity-30 disabled:hover:bg-transparent ${
        variant === 'danger' ? 'text-red-300 hover:text-red-200' : 'text-white'
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-border my-1" />;
}
