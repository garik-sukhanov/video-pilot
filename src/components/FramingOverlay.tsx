import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, FULL_CROP, isFullCrop } from '../store';
import type { DocSnapshot } from '../store';
import type { NormRect } from '../types';

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'body';

interface Drag {
  handle: Handle;
  startMouse: { x: number; y: number };
  startRect: NormRect;
  videoW: number;
  videoH: number;
  preDragSnapshot: DocSnapshot;
}

export function FramingOverlay() {
  const open = useStore((s) => s.framingEditOpen);
  const setOpen = useStore((s) => s.setFramingEditOpen);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const assets = useStore((s) => s.assets);
  const setClipCrop = useStore((s) => s.setClipCrop);
  const resetClipCrop = useStore((s) => s.resetClipCrop);
  const commitSnapshot = useStore((s) => s.commitSnapshot);
  const takeSnapshot = useStore((s) => s.takeSnapshot);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [open]);

  const selectedClip = clips.find((c) => c.id === selectedClipId);
  const selectedAsset = selectedClip ? assets.find((a) => a.id === selectedClip.assetId) : null;
  const isVideoClip = selectedClip?.mediaKind === 'video';
  const currentCrop = selectedClip?.crop ?? FULL_CROP;

  useEffect(() => {
    if (!drag) return;
    function clamp01(v: number): number {
      return Math.max(0, Math.min(1, v));
    }
    function onMove(ev: MouseEvent) {
      const d = drag!;
      if (!selectedClipId) return;
      const dx = (ev.clientX - d.startMouse.x) / d.videoW;
      const dy = (ev.clientY - d.startMouse.y) / d.videoH;
      const r = d.startRect;
      let nr: NormRect;
      switch (d.handle) {
        case 'body':
          nr = { x: clamp01(r.x + dx), y: clamp01(r.y + dy), w: r.w, h: r.h };
          if (nr.x + nr.w > 1) nr.x = 1 - nr.w;
          if (nr.y + nr.h > 1) nr.y = 1 - nr.h;
          break;
        case 'nw':
          nr = {
            x: clamp01(Math.min(r.x + r.w - 0.02, r.x + dx)),
            y: clamp01(Math.min(r.y + r.h - 0.02, r.y + dy)),
            w: 0,
            h: 0,
          };
          nr.w = r.x + r.w - nr.x;
          nr.h = r.y + r.h - nr.y;
          break;
        case 'ne':
          nr = {
            x: r.x,
            y: clamp01(Math.min(r.y + r.h - 0.02, r.y + dy)),
            w: Math.max(0.02, Math.min(1 - r.x, r.w + dx)),
            h: 0,
          };
          nr.h = r.y + r.h - nr.y;
          break;
        case 'sw':
          nr = {
            x: clamp01(Math.min(r.x + r.w - 0.02, r.x + dx)),
            y: r.y,
            w: 0,
            h: Math.max(0.02, Math.min(1 - r.y, r.h + dy)),
          };
          nr.w = r.x + r.w - nr.x;
          break;
        case 'se':
          nr = {
            x: r.x,
            y: r.y,
            w: Math.max(0.02, Math.min(1 - r.x, r.w + dx)),
            h: Math.max(0.02, Math.min(1 - r.y, r.h + dy)),
          };
          break;
        case 'n':
          nr = {
            x: r.x,
            y: clamp01(Math.min(r.y + r.h - 0.02, r.y + dy)),
            w: r.w,
            h: 0,
          };
          nr.h = r.y + r.h - nr.y;
          break;
        case 's':
          nr = { x: r.x, y: r.y, w: r.w, h: Math.max(0.02, Math.min(1 - r.y, r.h + dy)) };
          break;
        case 'w':
          nr = {
            x: clamp01(Math.min(r.x + r.w - 0.02, r.x + dx)),
            y: r.y,
            w: 0,
            h: r.h,
          };
          nr.w = r.x + r.w - nr.x;
          break;
        case 'e':
          nr = { x: r.x, y: r.y, w: Math.max(0.02, Math.min(1 - r.x, r.w + dx)), h: r.h };
          break;
      }
      setClipCrop(selectedClipId, nr);
    }
    function onUp() {
      if (drag) commitSnapshot(drag.preDragSnapshot);
      setDrag(null);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, selectedClipId, setClipCrop, commitSnapshot]);

  if (!open) return <div ref={containerRef} className="absolute inset-0 pointer-events-none" />;

  const sourceAspect =
    selectedAsset?.probe.width && selectedAsset?.probe.height
      ? selectedAsset.probe.width / selectedAsset.probe.height
      : 16 / 9;

  let videoW = size.w;
  let videoH = size.h;
  if (size.w > 0 && size.h > 0 && isVideoClip) {
    const containerAspect = size.w / size.h;
    if (sourceAspect > containerAspect) {
      videoW = size.w;
      videoH = size.w / sourceAspect;
    } else {
      videoH = size.h;
      videoW = size.h * sourceAspect;
    }
  }
  const videoX = (size.w - videoW) / 2;
  const videoY = (size.h - videoH) / 2;

  const cropLeft = videoX + videoW * currentCrop.x;
  const cropTop = videoY + videoH * currentCrop.y;
  const cropWidth = videoW * currentCrop.w;
  const cropHeight = videoH * currentCrop.h;

  function startDrag(handle: Handle, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (videoW <= 0 || videoH <= 0 || !isVideoClip || !selectedClipId) return;
    setDrag({
      handle,
      startMouse: { x: e.clientX, y: e.clientY },
      startRect: { ...currentCrop },
      videoW,
      videoH,
      preDragSnapshot: takeSnapshot(),
    });
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Top toolbar — always visible in framing mode */}
      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 z-30">
        <div className="text-[11px] text-white/85 bg-black/60 px-2 py-1 rounded">
          {isVideoClip && selectedAsset ? (
            <>
              Кадрирование:{' '}
              <span className="font-medium">{selectedAsset.fileName}</span>{' '}
              · источник {selectedAsset.probe.width ?? '?'}×{selectedAsset.probe.height ?? '?'}{' '}
              · crop {(currentCrop.w * 100).toFixed(0)}%×{(currentCrop.h * 100).toFixed(0)}%
            </>
          ) : (
            <>Выберите видео-клип на таймлайне для кадрирования</>
          )}
        </div>
        <div className="flex-1" />
        {isVideoClip && !isFullCrop(currentCrop) && selectedClipId && (
          <button
            onClick={() => resetClipCrop(selectedClipId)}
            className="text-[11px] bg-black/60 hover:bg-black/80 text-white px-2 py-1 rounded"
          >
            Сбросить
          </button>
        )}
        <button
          onClick={() => setOpen(false)}
          className="text-[11px] bg-accent hover:bg-accent/80 text-white px-2 py-1 rounded"
        >
          Готово
        </button>
      </div>

      {isVideoClip && videoW > 0 && (
        <>
          {/* Dark mask outside crop rect */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: videoX,
              top: videoY,
              width: videoW,
              height: cropTop - videoY,
              background: 'rgba(0,0,0,0.55)',
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              left: videoX,
              top: cropTop + cropHeight,
              width: videoW,
              height: videoY + videoH - (cropTop + cropHeight),
              background: 'rgba(0,0,0,0.55)',
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              left: videoX,
              top: cropTop,
              width: cropLeft - videoX,
              height: cropHeight,
              background: 'rgba(0,0,0,0.55)',
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              left: cropLeft + cropWidth,
              top: cropTop,
              width: videoX + videoW - (cropLeft + cropWidth),
              height: cropHeight,
              background: 'rgba(0,0,0,0.55)',
            }}
          />

          {/* Crop rect */}
          <div
            className="absolute"
            style={{
              left: cropLeft,
              top: cropTop,
              width: cropWidth,
              height: cropHeight,
              boxShadow: '0 0 0 1px #7c5cff',
              cursor: 'move',
            }}
            onMouseDown={(e) => startDrag('body', e)}
          >
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/3 left-0 right-0 border-t border-white/15" />
              <div className="absolute top-2/3 left-0 right-0 border-t border-white/15" />
              <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/15" />
              <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/15" />
            </div>

            <CropHandle pos="nw" startDrag={startDrag} />
            <CropHandle pos="ne" startDrag={startDrag} />
            <CropHandle pos="sw" startDrag={startDrag} />
            <CropHandle pos="se" startDrag={startDrag} />
            <CropHandle pos="n" startDrag={startDrag} />
            <CropHandle pos="s" startDrag={startDrag} />
            <CropHandle pos="e" startDrag={startDrag} />
            <CropHandle pos="w" startDrag={startDrag} />
          </div>
        </>
      )}
    </div>
  );
}

function CropHandle({
  pos,
  startDrag,
}: {
  pos: Handle;
  startDrag: (h: Handle, e: React.MouseEvent) => void;
}) {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    width: 11,
    height: 11,
    background: '#7c5cff',
    border: '2px solid white',
    borderRadius: 2,
    boxSizing: 'border-box',
  };
  const map: Record<Handle, React.CSSProperties> = {
    nw: { left: -6, top: -6, cursor: 'nwse-resize' },
    ne: { right: -6, top: -6, cursor: 'nesw-resize' },
    sw: { left: -6, bottom: -6, cursor: 'nesw-resize' },
    se: { right: -6, bottom: -6, cursor: 'nwse-resize' },
    n: { left: '50%', top: -6, marginLeft: -5, cursor: 'ns-resize' },
    s: { left: '50%', bottom: -6, marginLeft: -5, cursor: 'ns-resize' },
    w: { top: '50%', left: -6, marginTop: -5, cursor: 'ew-resize' },
    e: { top: '50%', right: -6, marginTop: -5, cursor: 'ew-resize' },
    body: {},
  };
  return (
    <div
      style={{ ...baseStyle, ...map[pos] }}
      onMouseDown={(e) => startDrag(pos, e)}
    />
  );
}
