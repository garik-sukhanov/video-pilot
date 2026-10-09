import { useEffect, useRef, useState } from 'react';
import {
  useStore,
  formatTime,
  makeId,
  getLinkedSiblings,
  computeRippleInsertion,
  previewInsertionStart,
} from '../store';
import type { TimelineClip, Track } from '../types';
import { Waveform } from './Waveform';
import { ClipContextMenu } from './ClipContextMenu';

const TRACK_HEIGHT = 52;
const TRACK_GAP = 4;
const RULER_HEIGHT = 24;
const HEADER_WIDTH = 150;
const TRIM_HANDLE_W = 8;

interface InitialState {
  id: string;
  startSec: number;
  inSec: number;
  outSec: number;
  srcDuration: number;
}

export function Timeline() {
  const tracks = useStore((s) => s.tracks);
  const clips = useStore((s) => s.clips);
  const assets = useStore((s) => s.assets);
  const waveforms = useStore((s) => s.waveforms);
  const playheadSec = useStore((s) => s.playheadSec);
  const seek = useStore((s) => s.seek);
  const splitSelectedAtPlayhead = useStore((s) => s.splitSelectedAtPlayhead);
  const trimSelectedToPlayhead = useStore((s) => s.trimSelectedToPlayhead);
  const removeClip = useStore((s) => s.removeClip);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectClip = useStore((s) => s.selectClip);
  const selectClipForFraming = useStore((s) => s.selectClipForFraming);
  const framingEditOpen = useStore((s) => s.framingEditOpen);
  const addClips = useStore((s) => s.addClips);
  const addClipsWithShifts = useStore((s) => s.addClipsWithShifts);
  const insertAssetsWithRipple = useStore((s) => s.insertAssetsWithRipple);
  const updateClipsBatch = useStore((s) => s.updateClipsBatch);
  const commitSnapshot = useStore((s) => s.commitSnapshot);
  const takeSnapshot = useStore((s) => s.takeSnapshot);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const pastLen = useStore((s) => s.past.length);
  const futureLen = useStore((s) => s.future.length);
  const unlinkClip = useStore((s) => s.unlinkClip);
  const extractAudio = useStore((s) => s.extractAudioFromClip);
  const addTrack = useStore((s) => s.addTrack);
  const removeTrack = useStore((s) => s.removeTrack);
  const getAssetById = useStore((s) => s.getAssetById);
  const pps = useStore((s) => s.pixelsPerSecond);
  const setPps = useStore((s) => s.setPixelsPerSecond);
  const setTrackVolume = useStore((s) => s.setTrackVolume);
  const setTrackMuted = useStore((s) => s.setTrackMuted);
  const setTrackColor = useStore((s) => s.setTrackColor);
  const setClipColor = useStore((s) => s.setClipColor);
  const openColorPanel = useStore((s) => s.openColorPanel);
  const closeColorPanel = useStore((s) => s.closeColorPanel);
  const activeColorTarget = useStore((s) => s.activeColorTarget);

  const tracksAreaRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [dragOverTrack, setDragOverTrack] = useState<string | null>(null);
  const [insertionPreview, setInsertionPreview] = useState<{ trackId: string; sec: number } | null>(
    null,
  );
  const [clipMenu, setClipMenu] = useState<{ clipId: string; x: number; y: number } | null>(null);

  const totalDuration = clips.reduce(
    (max, c) => Math.max(max, c.startSec + (c.outSec - c.inSec)),
    0,
  );
  const visibleDuration = Math.max(60, totalDuration + 10);

  function pxToSec(px: number): number {
    return Math.max(0, px / pps);
  }
  function secToPx(sec: number): number {
    return sec * pps;
  }

  function clickXToSec(clientX: number): number {
    const inner = innerRef.current;
    if (!inner) return 0;
    const rect = inner.getBoundingClientRect();
    return pxToSec(clientX - rect.left);
  }

  function handleInnerMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    seek(clickXToSec(e.clientX));
  }

  function pickDropTrack(track: Track, assetHasVideo: boolean, assetHasAudio: boolean): Track | null {
    if (track.kind === 'video' && assetHasVideo) return track;
    if (track.kind === 'audio' && assetHasAudio) return track;
    if (track.kind === 'video' && !assetHasVideo && assetHasAudio) {
      return tracks.find((t) => t.kind === 'audio') ?? null;
    }
    return null;
  }

  function handleDragOver(e: React.DragEvent, track: Track) {
    const types = e.dataTransfer.types;
    if (
      types.includes('application/x-videopilot-asset-ids') ||
      types.includes('application/x-videopilot-asset')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOverTrack(track.id);

      const requestedStart = clickXToSec(e.clientX);
      const insertSec = previewInsertionStart(clips, track.id, requestedStart);
      setInsertionPreview({ trackId: track.id, sec: insertSec });
    }
  }

  function handleDragLeave() {
    setDragOverTrack(null);
    setInsertionPreview(null);
  }

  function handleDrop(e: React.DragEvent, track: Track) {
    e.preventDefault();
    setDragOverTrack(null);
    setInsertionPreview(null);

    let assetIds: string[] = [];
    const multi = e.dataTransfer.getData('application/x-videopilot-asset-ids');
    if (multi) {
      try {
        assetIds = JSON.parse(multi);
      } catch {
        /* fall through */
      }
    }
    if (assetIds.length === 0) {
      const single = e.dataTransfer.getData('application/x-videopilot-asset');
      if (single) assetIds = [single];
    }
    if (assetIds.length === 0) return;

    const requestedStart = clickXToSec(e.clientX);

    const insertions: Array<{
      trackId: string;
      assetId: string;
      mediaKind: 'video' | 'audio';
      duration: number;
    }> = [];
    for (const id of assetIds) {
      const asset = getAssetById(id);
      if (!asset) continue;
      const target = pickDropTrack(track, asset.probe.hasVideo, asset.probe.hasAudio);
      if (!target) continue;
      insertions.push({
        trackId: target.id,
        assetId: asset.id,
        mediaKind: target.kind === 'video' ? 'video' : 'audio',
        duration: asset.probe.durationSec,
      });
    }
    if (insertions.length === 0) return;

    insertAssetsWithRipple(insertions, requestedStart);
  }

  function handleClipMouseDown(
    e: React.MouseEvent,
    clip: TimelineClip,
    mode: 'move' | 'trim-l' | 'trim-r',
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (framingEditOpen) {
      selectClipForFraming(clip.id);
    } else {
      selectClip(clip.id);
    }

    const linkedIds = getLinkedSiblings(clips, clip.id);
    const initials: InitialState[] = linkedIds.map((id) => {
      const c = clips.find((x) => x.id === id)!;
      const asset = getAssetById(c.assetId);
      return {
        id: c.id,
        startSec: c.startSec,
        inSec: c.inSec,
        outSec: c.outSec,
        srcDuration: asset?.probe.durationSec ?? Infinity,
      };
    });

    const primary = initials.find((s) => s.id === clip.id) ?? initials[0];
    const ignoreIds = new Set(initials.map((i) => i.id));
    const snapCandidates: number[] = [0, playheadSec];
    for (const c of clips) {
      if (ignoreIds.has(c.id)) continue;
      snapCandidates.push(c.startSec);
      snapCandidates.push(c.startSec + (c.outSec - c.inSec));
    }
    const snapThresholdSec = Math.max(0.08, 10 / pps);

    function bestSnap(positions: number[]): number {
      let bestDelta = 0;
      let bestDist = snapThresholdSec;
      for (const pos of positions) {
        for (const cand of snapCandidates) {
          const d = cand - pos;
          if (Math.abs(d) < bestDist) {
            bestDelta = d;
            bestDist = Math.abs(d);
          }
        }
      }
      return bestDelta;
    }

    const startX = e.clientX;
    let moved = false;
    const snapshotBefore = takeSnapshot();

    function onMove(ev: MouseEvent) {
      const dxSec = (ev.clientX - startX) / pps;
      if (!moved && Math.abs(ev.clientX - startX) < 2) return;
      moved = true;

      const patches: Array<{ id: string; patch: Partial<TimelineClip> }> = [];

      if (mode === 'move') {
        const minInitialStart = Math.min(...initials.map((s) => s.startSec));
        let clampedDx = Math.max(-minInitialStart, dxSec);

        const primaryDuration = primary.outSec - primary.inSec;
        const proposedStart = primary.startSec + clampedDx;
        const proposedEnd = proposedStart + primaryDuration;
        clampedDx += bestSnap([proposedStart, proposedEnd]);

        for (const s of initials) {
          patches.push({ id: s.id, patch: { startSec: s.startSec + clampedDx } });
        }
      } else if (mode === 'trim-l') {
        const proposedLeftOnTimeline = Math.max(
          0,
          primary.startSec + (Math.max(0, primary.inSec + dxSec) - primary.inSec),
        );
        const adjustedDx = dxSec + bestSnap([proposedLeftOnTimeline]);

        for (const s of initials) {
          const maxIn = s.outSec - 0.05;
          const newIn = Math.max(0, Math.min(maxIn, s.inSec + adjustedDx));
          const delta = newIn - s.inSec;
          patches.push({
            id: s.id,
            patch: { inSec: newIn, startSec: Math.max(0, s.startSec + delta) },
          });
        }
      } else if (mode === 'trim-r') {
        const proposedRightOnTimeline = primary.startSec + (primary.outSec - primary.inSec) + dxSec;
        const adjustedDx = dxSec + bestSnap([proposedRightOnTimeline]);

        for (const s of initials) {
          const newOut = Math.max(s.inSec + 0.05, Math.min(s.srcDuration, s.outSec + adjustedDx));
          patches.push({ id: s.id, patch: { outSec: newOut } });
        }
      }
      updateClipsBatch(patches);
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (moved) commitSnapshot(snapshotBefore);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault();
        removeClip(selectedClipId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClipId, removeClip]);

  const ticks: number[] = [];
  const tickStep = pps < 25 ? 10 : pps < 60 ? 5 : pps < 120 ? 2 : 1;
  for (let t = 0; t <= visibleDuration; t += tickStep) ticks.push(t);

  const selectedClip = clips.find((c) => c.id === selectedClipId);
  const selectedLinkedIds = selectedClipId ? getLinkedSiblings(clips, selectedClipId) : [];
  const canUnlink = selectedClip?.linkedClipId !== undefined;
  const canSplit =
    selectedClip !== undefined &&
    playheadSec > selectedClip.startSec + 0.05 &&
    playheadSec < selectedClip.startSec + (selectedClip.outSec - selectedClip.inSec) - 0.05;
  const canTrimToPlayhead = canSplit;
  const canExtract = (() => {
    if (!selectedClip || selectedClip.mediaKind !== 'video') return false;
    if (selectedClip.extractedAudio) return false;
    const asset = getAssetById(selectedClip.assetId);
    return !!asset?.probe.hasAudio;
  })();

  return (
    <div className="h-full flex flex-col">
      <div className="min-h-9 border-b border-border flex items-center px-3 py-1 text-xs text-gray-400 gap-2 flex-wrap">
        <span className="uppercase tracking-wider">Таймлайн</span>

        <button
          onClick={undo}
          disabled={pastLen === 0}
          className="w-7 h-7 flex items-center justify-center rounded text-[15px] leading-none bg-panel-3 hover:bg-accent/40 disabled:opacity-30 disabled:hover:bg-panel-3 border border-border"
          title="Назад · Cmd/Ctrl+Z"
        >
          ↶
        </button>
        <button
          onClick={redo}
          disabled={futureLen === 0}
          className="w-7 h-7 flex items-center justify-center rounded text-[15px] leading-none bg-panel-3 hover:bg-accent/40 disabled:opacity-30 disabled:hover:bg-panel-3 border border-border"
          title="Вперёд · Cmd/Ctrl+Shift+Z"
        >
          ↷
        </button>

        <span className="w-px h-4 bg-border mx-1" />

        <button
          onClick={splitSelectedAtPlayhead}
          disabled={!canSplit}
          className="px-2 py-0.5 rounded text-[11px] bg-panel-3 hover:bg-accent/40 disabled:opacity-30 disabled:hover:bg-panel-3 border border-border"
          title="Cmd/Ctrl+B — разрезать выделенный клип в позиции плейхеда"
        >
          ✂ Резать
        </button>
        <button
          onClick={() => trimSelectedToPlayhead('left')}
          disabled={!canTrimToPlayhead}
          className="w-7 h-7 flex items-center justify-center rounded text-[15px] leading-none bg-panel-3 hover:bg-accent/40 disabled:opacity-30 disabled:hover:bg-panel-3 border border-border"
          title="Обрезать слева — удалить левую часть до плейхеда"
        >
          ⇤
        </button>
        <button
          onClick={() => trimSelectedToPlayhead('right')}
          disabled={!canTrimToPlayhead}
          className="w-7 h-7 flex items-center justify-center rounded text-[15px] leading-none bg-panel-3 hover:bg-accent/40 disabled:opacity-30 disabled:hover:bg-panel-3 border border-border"
          title="Обрезать справа — удалить правую часть после плейхеда"
        >
          ⇥
        </button>

        <span className="w-px h-4 bg-border mx-1" />

        <button
          onClick={() => selectedClipId && extractAudio(selectedClipId)}
          disabled={!canExtract}
          className="px-2 py-0.5 rounded text-[11px] bg-panel-3 hover:bg-accent/40 disabled:opacity-30 disabled:hover:bg-panel-3 border border-border"
          title="Извлечь звук видео на новую аудио-дорожку"
        >
          🎵 Извлечь звук
        </button>
        <button
          onClick={() => selectedClipId && unlinkClip(selectedClipId)}
          disabled={!canUnlink}
          className="px-2 py-0.5 rounded text-[11px] bg-panel-3 hover:bg-accent/40 disabled:opacity-30 disabled:hover:bg-panel-3 border border-border"
          title="Отвязать видео от аудио"
        >
          ⛓ Отвязать
        </button>
        <button
          onClick={() => selectedClipId && removeClip(selectedClipId)}
          disabled={!selectedClipId}
          className="px-2 py-0.5 rounded text-[11px] bg-panel-3 hover:bg-red-700/40 disabled:opacity-30 disabled:hover:bg-panel-3 border border-border"
          title="Backspace"
        >
          Удалить клип
        </button>

        <div className="flex-1" />

        <button
          onClick={() => addTrack('video')}
          className="px-2 py-0.5 rounded text-[11px] bg-panel-3 hover:bg-accent/40 border border-border"
          title="Добавить видео-дорожку (верхняя перекрывает нижние)"
        >
          + Видео
        </button>
        <button
          onClick={() => addTrack('audio')}
          className="px-2 py-0.5 rounded text-[11px] bg-panel-3 hover:bg-accent/40 border border-border"
          title="Добавить аудио-дорожку (все аудио играют одновременно)"
        >
          + Аудио
        </button>

        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span>Масштаб</span>
          <input
            type="range"
            min={10}
            max={200}
            step={1}
            value={pps}
            onChange={(e) => setPps(parseInt(e.target.value, 10))}
            className="w-24 accent-accent"
          />
          <span className="w-10 text-right">{pps}px/с</span>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div
          className="border-r border-border bg-panel-2 flex flex-col overflow-y-auto"
          style={{ width: HEADER_WIDTH }}
        >
          <div style={{ height: RULER_HEIGHT }} className="border-b border-border" />
          {tracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              onVolume={(v) => setTrackVolume(track.id, v)}
              onMute={(m) => setTrackMuted(track.id, m)}
              onRemove={() => removeTrack(track.id)}
              onToggleColor={(enabled) => setTrackColor(track.id, { enabled })}
              onOpenColor={() =>
                activeColorTarget?.kind === 'track' && activeColorTarget.id === track.id
                  ? closeColorPanel()
                  : openColorPanel({ kind: 'track', id: track.id })
              }
            />
          ))}
        </div>

        <div
          ref={tracksAreaRef}
          className="flex-1 overflow-x-auto overflow-y-auto relative"
        >
          <div
            ref={innerRef}
            style={{ width: secToPx(visibleDuration), minWidth: '100%' }}
            className="relative cursor-pointer"
            onMouseDown={handleInnerMouseDown}
          >
            <div
              className="sticky top-0 z-10 border-b border-border bg-panel-2"
              style={{ height: RULER_HEIGHT }}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full flex flex-col justify-end pl-1 text-[10px] text-gray-500 border-l border-border/40 pointer-events-none"
                  style={{ left: secToPx(t) }}
                >
                  {formatTime(t).split('.')[0]}
                </div>
              ))}
            </div>

            {tracks.map((track) => {
              const trackClips = clips.filter((c) => c.trackId === track.id);
              return (
                <div
                  key={track.id}
                  style={{ height: TRACK_HEIGHT, marginTop: TRACK_GAP }}
                  className={`relative ${dragOverTrack === track.id ? 'bg-accent/10' : ''}`}
                  onDragOver={(e) => handleDragOver(e, track)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, track)}
                >
                  <div className="absolute inset-0 bg-panel-3/40 border-y border-border" />

                  {trackClips.map((clip) => {
                    const asset = assets.find((a) => a.id === clip.assetId);
                    const clipDur = clip.outSec - clip.inSec;
                    const widthPx = Math.max(12, secToPx(clipDur));
                    const isSelected = clip.id === selectedClipId;
                    const isLinkedToSelected =
                      !isSelected && selectedLinkedIds.includes(clip.id);
                    const isVideo = clip.mediaKind === 'video';
                    const peaks = !isVideo && asset ? waveforms[asset.id] : undefined;

                    return (
                      <div
                        key={clip.id}
                        onMouseDown={(e) => handleClipMouseDown(e, clip, 'move')}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          selectClip(clip.id);
                          setClipMenu({ clipId: clip.id, x: e.clientX, y: e.clientY });
                        }}
                        className={`absolute top-1 bottom-1 rounded overflow-hidden outline-none transition-shadow ${
                          isSelected
                            ? 'ring-2 ring-accent shadow-md shadow-accent/30 z-10'
                            : isLinkedToSelected
                            ? 'ring-2 ring-accent/60'
                            : 'ring-1 ring-white/10 hover:ring-accent/60'
                        }`}
                        style={{
                          left: secToPx(clip.startSec),
                          width: widthPx,
                          background: isVideo
                            ? 'linear-gradient(180deg, #5b3eb8 0%, #432a8c 100%)'
                            : 'linear-gradient(180deg, #2d8a4e 0%, #1e6a3a 100%)',
                          cursor: 'grab',
                        }}
                        title={asset?.fileName}
                      >
                        {isVideo && asset?.thumbnail && (
                          <img
                            src={asset.thumbnail}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none"
                            draggable={false}
                          />
                        )}

                        {!isVideo && peaks && asset && (
                          <Waveform
                            peaks={peaks}
                            inSec={clip.inSec}
                            outSec={clip.outSec}
                            sourceDurationSec={asset.probe.durationSec}
                            width={widthPx}
                            height={TRACK_HEIGHT - 8}
                          />
                        )}

                        <div className="absolute top-1 right-1 flex items-center gap-0.5">
                          {clip.linkedClipId && (
                            <span
                              className="text-[9px] text-white/70 pointer-events-none"
                              title="Связано с парным клипом"
                            >
                              🔗
                            </span>
                          )}
                          {isVideo && (
                            <>
                              <button
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setClipColor(clip.id, { enabled: !clip.color?.enabled });
                                }}
                                className={`w-2 h-2 rounded-full ${
                                  clip.color?.enabled
                                    ? 'bg-accent-2 ring-1 ring-white/60'
                                    : 'bg-white/30 hover:bg-white/50'
                                }`}
                                title={
                                  clip.color?.enabled
                                    ? 'Цветокор клипа применяется (клик — выключить)'
                                    : 'Цветокор клипа выключен (клик — включить)'
                                }
                              />
                              <button
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (
                                    activeColorTarget?.kind === 'clip' &&
                                    activeColorTarget.id === clip.id
                                  ) {
                                    closeColorPanel();
                                  } else {
                                    openColorPanel({ kind: 'clip', id: clip.id });
                                  }
                                }}
                                className="text-[9px] text-white/70 hover:text-white px-0.5 leading-none"
                                title="Открыть цветокор клипа"
                              >
                                ◐
                              </button>
                            </>
                          )}
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              selectClip(clip.id);
                              setClipMenu({
                                clipId: clip.id,
                                x: rect.left,
                                y: rect.bottom + 4,
                              });
                            }}
                            className="text-[11px] leading-none text-white/70 hover:text-white px-0.5"
                            title="Действия с клипом (или правый клик)"
                          >
                            ⋯
                          </button>
                        </div>

                        <div className="absolute inset-0 px-2 py-1 flex flex-col justify-between text-[10px] pointer-events-none">
                          <div className="truncate text-white/90 font-medium drop-shadow pr-16">
                            {asset?.fileName ?? 'clip'}
                          </div>
                          <div className="text-white/70 font-mono">{formatTime(clipDur)}</div>
                        </div>

                        <div
                          onMouseDown={(e) => handleClipMouseDown(e, clip, 'trim-l')}
                          className="absolute top-0 bottom-0 left-0 hover:bg-white/30"
                          style={{ width: TRIM_HANDLE_W, cursor: 'ew-resize' }}
                          title="Обрезать слева"
                        />
                        <div
                          onMouseDown={(e) => handleClipMouseDown(e, clip, 'trim-r')}
                          className="absolute top-0 bottom-0 right-0 hover:bg-white/30"
                          style={{ width: TRIM_HANDLE_W, cursor: 'ew-resize' }}
                          title="Обрезать справа"
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div
              className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none z-20"
              style={{ left: secToPx(playheadSec) }}
            >
              <div className="absolute -top-0.5 -left-1.5 w-3 h-3 bg-red-500 rounded-sm" />
            </div>

            {insertionPreview && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-accent-2 pointer-events-none z-30 shadow-[0_0_8px_rgba(78,201,255,0.7)]"
                style={{ left: secToPx(insertionPreview.sec) }}
              >
                <div className="absolute -top-1 -left-[3px] w-2 h-2 bg-accent-2 rounded-full" />
                <div className="absolute -bottom-1 -left-[3px] w-2 h-2 bg-accent-2 rounded-full" />
              </div>
            )}
          </div>
        </div>
      </div>

      {clipMenu && (
        <ClipContextMenu
          clipId={clipMenu.clipId}
          x={clipMenu.x}
          y={clipMenu.y}
          onClose={() => setClipMenu(null)}
        />
      )}
    </div>
  );
}

interface HeaderProps {
  track: Track;
  onVolume: (v: number) => void;
  onMute: (m: boolean) => void;
  onRemove: () => void;
  onToggleColor: (enabled: boolean) => void;
  onOpenColor: () => void;
}

function TrackHeader({
  track,
  onVolume,
  onMute,
  onRemove,
  onToggleColor,
  onOpenColor,
}: HeaderProps) {
  const colorEnabled = !!track.color?.enabled;
  return (
    <div
      style={{ height: TRACK_HEIGHT, marginTop: TRACK_GAP }}
      className="group px-2 py-1 border-b border-border bg-panel-2/60 flex flex-col justify-between"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 truncate" title={track.label}>
          {track.label}
        </span>
        <div className="flex items-center gap-1">
          {track.kind === 'video' && (
            <>
              <input
                type="checkbox"
                checked={colorEnabled}
                onChange={(e) => onToggleColor(e.target.checked)}
                className="accent-accent w-2.5 h-2.5"
                title={colorEnabled ? 'Цветокор дорожки применяется' : 'Цветокор дорожки выключен'}
              />
              <button
                onClick={onOpenColor}
                className={`text-[9px] px-1 rounded ${
                  colorEnabled ? 'bg-accent/30 text-white' : 'bg-panel-3 text-gray-400 hover:text-white'
                }`}
                title="Цветокор дорожки"
              >
                ◐
              </button>
            </>
          )}
          <button
            onClick={() => onMute(!track.muted)}
            className={`text-[9px] px-1 rounded ${
              track.muted ? 'bg-red-700/40 text-red-200' : 'bg-panel-3 text-gray-400 hover:text-white'
            }`}
            title={track.muted ? 'Включить звук' : 'Заглушить'}
          >
            {track.muted ? '🔇' : track.kind === 'video' ? '🎬' : '🔊'}
          </button>
          <button
            onClick={onRemove}
            className="text-[10px] text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
            title="Удалить дорожку"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          className="flex-1 accent-accent h-1"
          title="Громкость"
        />
        <span className="text-[9px] text-gray-500 w-6 text-right">
          {Math.round(track.volume * 100)}
        </span>
      </div>
    </div>
  );
}
