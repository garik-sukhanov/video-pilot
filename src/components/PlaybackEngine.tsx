import { useCallback, useEffect, useRef } from 'react';
import { useStore, fileToVpUrl } from '../store';
import type { ColorCorrection, TimelineClip, Track } from '../types';

function colorToCSSFilter(c: ColorCorrection | undefined): string {
  if (!c || !c.enabled) return '';
  const b = 1 + c.brightness;
  const co = 1 + c.contrast;
  const s = 1 + c.saturation;
  return `brightness(${b.toFixed(3)}) contrast(${co.toFixed(3)}) saturate(${s.toFixed(3)})`;
}

const SYNC_THRESHOLD = 0.25;
const SEEK_COOLDOWN_MS = 200;

interface ElementMeta {
  lastSeekAt: number;
  wasActive: boolean;
}

interface EngineRefs {
  elements: Map<string, HTMLMediaElement>;
  meta: Map<string, ElementMeta>;
  sources: Map<string, MediaElementAudioSourceNode>;
  trackGains: Map<string, GainNode>;
  refCallbacks: Map<string, (el: HTMLMediaElement | null) => void>;
  ctx: AudioContext | null;
  canvas: HTMLCanvasElement | null;
  rafId: number;
  lastTickMs: number;
}

function clipTimelineEnd(c: TimelineClip): number {
  return c.startSec + (c.outSec - c.inSec);
}

function isActiveAt(c: TimelineClip, sec: number): boolean {
  return sec >= c.startSec && sec < clipTimelineEnd(c);
}

function findClockMaster(clips: TimelineClip[], tracks: Track[], head: number): TimelineClip | null {
  for (const t of tracks) {
    if (t.kind !== 'video') continue;
    const c = clips.find(
      (cl) => cl.trackId === t.id && cl.mediaKind === 'video' && isActiveAt(cl, head),
    );
    if (c) return c;
  }
  return null;
}

export interface EngineHandle {
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export function PlaybackEngine({ canvasRef }: EngineHandle) {
  const clips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);
  const assets = useStore((s) => s.assets);

  const engineRef = useRef<EngineRefs>({
    elements: new Map(),
    meta: new Map(),
    sources: new Map(),
    trackGains: new Map(),
    refCallbacks: new Map(),
    ctx: null,
    canvas: null,
    rafId: 0,
    lastTickMs: 0,
  });

  useEffect(() => {
    engineRef.current.canvas = canvasRef.current;
  }, [canvasRef]);

  const ensureAudioCtx = useCallback((): AudioContext => {
    const e = engineRef.current;
    if (!e.ctx) e.ctx = new AudioContext();
    if (e.ctx.state === 'suspended') {
      e.ctx.resume().catch(() => {});
    }
    return e.ctx;
  }, []);

  const ensureTrackGain = useCallback(
    (trackId: string): GainNode => {
      const e = engineRef.current;
      const ctx = ensureAudioCtx();
      let gain = e.trackGains.get(trackId);
      if (!gain) {
        gain = ctx.createGain();
        gain.connect(ctx.destination);
        e.trackGains.set(trackId, gain);
      }
      return gain;
    },
    [ensureAudioCtx],
  );

  useEffect(() => {
    for (const track of tracks) {
      const gain = engineRef.current.trackGains.get(track.id);
      if (gain) gain.gain.value = track.muted ? 0 : track.volume;
    }
  }, [tracks]);

  const attachAudioRouting = useCallback(
    (el: HTMLMediaElement, clip: TimelineClip) => {
      const e = engineRef.current;
      if (e.sources.has(clip.id)) return;
      try {
        ensureAudioCtx();
        const ctx = e.ctx!;
        const src = ctx.createMediaElementSource(el);
        const trackGain = ensureTrackGain(clip.trackId);
        const trackState = useStore.getState().tracks.find((t) => t.id === clip.trackId);
        if (trackState) {
          trackGain.gain.value = trackState.muted ? 0 : trackState.volume;
        }
        src.connect(trackGain);
        e.sources.set(clip.id, src);
      } catch (err) {
        console.warn('audio routing failed', clip.id, err);
      }
    },
    [ensureAudioCtx, ensureTrackGain],
  );

  const getRefCallback = useCallback(
    (clipId: string): ((el: HTMLMediaElement | null) => void) => {
      const e = engineRef.current;
      const cached = e.refCallbacks.get(clipId);
      if (cached) return cached;
      const cb = (el: HTMLMediaElement | null) => {
        if (el) {
          e.elements.set(clipId, el);
          if (!e.meta.has(clipId)) e.meta.set(clipId, { lastSeekAt: 0, wasActive: false });
          const clip = useStore.getState().clips.find((c) => c.id === clipId);
          if (clip) attachAudioRouting(el, clip);
        } else {
          e.elements.delete(clipId);
        }
      };
      e.refCallbacks.set(clipId, cb);
      return cb;
    },
    [attachAudioRouting],
  );

  useEffect(() => {
    const e = engineRef.current;
    const aliveIds = new Set(clips.map((c) => c.id));
    for (const id of e.refCallbacks.keys()) {
      if (!aliveIds.has(id)) {
        e.refCallbacks.delete(id);
        e.meta.delete(id);
        e.sources.delete(id);
      }
    }
  }, [clips]);

  useEffect(() => {
    function tick(now: number) {
      const e = engineRef.current;
      const state = useStore.getState();
      const { isPlaying, playheadSec, getTotalDuration, setPlayheadSec, pause } = state;
      const clipsNow = state.clips;
      const tracksNow = state.tracks;
      const total = getTotalDuration();

      const masterClip = findClockMaster(clipsNow, tracksNow, playheadSec);
      const masterEl = masterClip ? (e.elements.get(masterClip.id) as HTMLVideoElement | undefined) : undefined;

      let head = playheadSec;
      if (isPlaying) {
        if (
          masterClip &&
          masterEl &&
          !masterEl.seeking &&
          masterEl.readyState >= 3 &&
          !masterEl.paused
        ) {
          head = masterClip.startSec + (masterEl.currentTime - masterClip.inSec);
          head = Math.max(masterClip.startSec, Math.min(head, clipTimelineEnd(masterClip)));
        } else {
          const dtMs = e.lastTickMs ? now - e.lastTickMs : 0;
          if (!masterEl || masterEl.readyState >= 2) {
            head = playheadSec + dtMs / 1000;
          }
        }
        if (head >= total) {
          head = total;
          setPlayheadSec(head);
          pause();
        } else if (head !== playheadSec) {
          setPlayheadSec(head);
        }
      }
      e.lastTickMs = now;

      for (const [clipId, el] of e.elements) {
        const clip = clipsNow.find((c) => c.id === clipId);
        if (!clip) continue;
        const meta = e.meta.get(clipId) ?? { lastSeekAt: 0, wasActive: false };

        if (clip.mediaKind === 'video') {
          const desiredMuted = !!clip.extractedAudio;
          if (el.muted !== desiredMuted) el.muted = desiredMuted;
        }

        const isActive = isActiveAt(clip, head);
        const target = isActive ? clip.inSec + (head - clip.startSec) : null;
        const isMaster = masterClip?.id === clip.id;
        const becameActive = isActive && !meta.wasActive;
        const sinceSeek = now - meta.lastSeekAt;
        const canSeek = !el.seeking && sinceSeek > SEEK_COOLDOWN_MS;

        if (isActive && target !== null) {
          let doSeek = false;
          if (becameActive) doSeek = true;
          else if (!isMaster && el.readyState >= 2 && canSeek) {
            const drift = el.currentTime - target;
            if (Math.abs(drift) > SYNC_THRESHOLD) doSeek = true;
          } else if (isMaster && !isPlaying && canSeek) {
            const drift = el.currentTime - target;
            if (Math.abs(drift) > SYNC_THRESHOLD) doSeek = true;
          }

          if (doSeek) {
            try {
              el.currentTime = Math.max(0, target);
              meta.lastSeekAt = now;
            } catch {}
          }

          if (isPlaying && el.paused) {
            el.play().catch(() => {});
          } else if (!isPlaying && !el.paused) {
            el.pause();
          }
        } else if (!el.paused) {
          el.pause();
        }

        meta.wasActive = isActive;
        e.meta.set(clipId, meta);
      }

      const canvas = e.canvas;
      if (canvas) {
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          const cw = canvas.clientWidth;
          const ch = canvas.clientHeight;
          if (canvas.width !== cw) canvas.width = cw;
          if (canvas.height !== ch) canvas.height = ch;
          ctx2d.fillStyle = '#000';
          ctx2d.fillRect(0, 0, canvas.width, canvas.height);

          if (masterClip && masterEl && masterEl.videoWidth > 0) {
            const vw = masterEl.videoWidth;
            const vh = masterEl.videoHeight;
            const framingEditing = state.framingEditOpen;
            const crop = masterClip.crop;

            let sx = 0;
            let sy = 0;
            let sw = vw;
            let sh = vh;
            if (!framingEditing && crop) {
              sx = Math.max(0, vw * crop.x);
              sy = Math.max(0, vh * crop.y);
              sw = Math.max(1, vw * crop.w);
              sh = Math.max(1, vh * crop.h);
            }

            const ar = sw / sh;
            const car = canvas.width / canvas.height;
            let dw: number, dh: number;
            if (ar > car) {
              dw = canvas.width;
              dh = canvas.width / ar;
            } else {
              dh = canvas.height;
              dw = canvas.height * ar;
            }
            const dx = (canvas.width - dw) / 2;
            const dy = (canvas.height - dh) / 2;
            try {
              ctx2d.drawImage(masterEl, sx, sy, sw, sh, dx, dy, dw, dh);
            } catch {}

            const masterTrack = tracksNow.find((t) => t.id === masterClip.trackId);
            const composite = [
              colorToCSSFilter(masterClip.color),
              colorToCSSFilter(masterTrack?.color),
              colorToCSSFilter(state.projectColor),
            ]
              .filter((f) => f)
              .join(' ');
            const desired = composite || 'none';
            if (canvas.style.filter !== desired) canvas.style.filter = desired;
          } else {
            const composite = colorToCSSFilter(state.projectColor) || 'none';
            if (canvas.style.filter !== composite) canvas.style.filter = composite;
          }
        }
      }

      e.rafId = requestAnimationFrame(tick);
    }
    engineRef.current.rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(engineRef.current.rafId);
      engineRef.current.lastTickMs = 0;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') {
        e.preventDefault();
        useStore.getState().togglePlay();
      } else if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        useStore.getState().splitSelectedAtPlayhead();
      } else if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        useStore.getState().redo();
      } else if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        useStore.getState().undo();
      } else if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        useStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
      }}
    >
      {clips.map((clip) => {
        const asset = assets.find((a) => a.id === clip.assetId);
        if (!asset) return null;
        const src = fileToVpUrl(asset.filePath);
        if (clip.mediaKind === 'video') {
          return (
            <video
              key={clip.id}
              ref={getRefCallback(clip.id)}
              src={src}
              preload="auto"
              playsInline
            />
          );
        }
        return (
          <audio
            key={clip.id}
            ref={getRefCallback(clip.id)}
            src={src}
            preload="auto"
          />
        );
      })}
    </div>
  );
}
