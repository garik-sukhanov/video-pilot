import { create } from 'zustand';
import type {
  ColorCorrection,
  ColorTarget,
  ExportSettings,
  LastExport,
  MediaAsset,
  ProjectDocument,
  SubtitleCue,
  TimelineClip,
  Track,
  TrackKind,
  NormRect,
} from './types';
import { NEUTRAL_COLOR } from './types';

export const FULL_CROP: NormRect = { x: 0, y: 0, w: 1, h: 1 };

export function isFullCrop(c: NormRect | undefined): boolean {
  if (!c) return true;
  return c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
}

const DEFAULT_EXPORT: ExportSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  quality: 'high',
};

const DEFAULT_TRACKS: Track[] = [
  { id: 'video_1', kind: 'video', label: 'Видео', volume: 1, muted: false },
  { id: 'audio_1', kind: 'audio', label: 'Аудио', volume: 0.8, muted: false },
];

const HISTORY_LIMIT = 80;

export interface DocSnapshot {
  tracks: Track[];
  clips: TimelineClip[];
  projectColor: ColorCorrection;
}

interface AppState {
  assets: MediaAsset[];
  tracks: Track[];
  clips: TimelineClip[];
  subtitles: SubtitleCue[];
  lastExport: LastExport | undefined;
  waveforms: Record<string, number[]>;
  selectedAssetIds: string[];
  assetSelectionAnchorId: string | null;
  selectedClipId: string | null;
  playheadSec: number;
  isPlaying: boolean;
  pixelsPerSecond: number;
  past: DocSnapshot[];
  future: DocSnapshot[];
  exportSettings: ExportSettings;
  framingEditOpen: boolean;
  exportModalOpen: boolean;
  projectColor: ColorCorrection;
  activeColorTarget: ColorTarget | null;
  colorPanelSnapshot: DocSnapshot | null;

  setClipCrop: (clipId: string, crop: NormRect) => void;
  resetClipCrop: (clipId: string) => void;
  setClipColor: (clipId: string, patch: Partial<ColorCorrection>) => void;
  setTrackColor: (trackId: string, patch: Partial<ColorCorrection>) => void;
  setProjectColor: (patch: Partial<ColorCorrection>) => void;
  resetColor: (target: ColorTarget) => void;
  openColorPanel: (target: ColorTarget) => void;
  closeColorPanel: () => void;
  enterFramingMode: () => void;
  selectClipForFraming: (clipId: string) => void;
  setExportSettings: (patch: Partial<ExportSettings>) => void;
  setFramingEditOpen: (open: boolean) => void;
  setExportModalOpen: (open: boolean) => void;

  addAssets: (assets: MediaAsset[]) => void;
  removeAsset: (id: string) => void;
  relinkAsset: (id: string, filePath: string) => void;
  setSubtitles: (subtitles: SubtitleCue[]) => void;
  setLastExport: (lastExport: LastExport) => void;
  loadDocument: (doc: ProjectDocument) => void;
  selectAsset: (id: string | null) => void;
  toggleAssetInSelection: (id: string) => void;
  selectAssetRange: (toId: string) => void;
  clearAssetSelection: () => void;
  setWaveform: (assetId: string, peaks: number[]) => void;

  addTrack: (kind: TrackKind) => string;
  removeTrack: (id: string) => void;
  setTrackVolume: (trackId: string, volume: number) => void;
  setTrackMuted: (trackId: string, muted: boolean) => void;

  addClips: (clips: TimelineClip[]) => void;
  addClipsWithShifts: (
    newClips: TimelineClip[],
    shifts: Array<{ id: string; newStart: number }>,
  ) => void;
  insertAssetsWithRipple: (
    insertions: Array<{ trackId: string; assetId: string; mediaKind: TrackKind; duration: number }>,
    requestedStart: number,
  ) => void;
  updateClip: (id: string, patch: Partial<TimelineClip>) => void;
  updateClipsBatch: (patches: Array<{ id: string; patch: Partial<TimelineClip> }>) => void;
  removeClip: (id: string) => void;
  removeClips: (ids: string[]) => void;
  selectClip: (id: string | null) => void;
  unlinkClip: (id: string) => void;
  splitSelectedAtPlayhead: () => void;
  trimSelectedToPlayhead: (side: 'left' | 'right') => void;
  extractAudioFromClip: (clipId: string) => void;

  takeSnapshot: () => DocSnapshot;
  commitSnapshot: (snap: DocSnapshot) => void;
  undo: () => void;
  redo: () => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (sec: number) => void;
  setPlayheadSec: (sec: number) => void;

  setPixelsPerSecond: (pps: number) => void;

  getAssetById: (id: string) => MediaAsset | undefined;
  getTrackById: (id: string) => Track | undefined;
  getTotalDuration: () => number;
}

export function getLinkedSiblings(clips: TimelineClip[], clipId: string): string[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return [clipId];
  if (!clip.linkedClipId) return [clipId];
  const partner = clips.find((c) => c.id === clip.linkedClipId);
  if (!partner) return [clipId];
  return [clipId, partner.id];
}

export function computeRippleInsertion(
  clips: TimelineClip[],
  trackId: string,
  requestedStart: number,
  duration: number,
): { actualStart: number; shifts: Array<{ id: string; newStart: number }> } {
  const onTrack = clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.startSec - b.startSec);

  let actualStart = 0;
  let i = 0;
  for (; i < onTrack.length; i++) {
    const cEnd = onTrack[i].startSec + (onTrack[i].outSec - onTrack[i].inSec);
    if (cEnd <= requestedStart + 0.001) {
      actualStart = cEnd;
    } else {
      break;
    }
  }

  let cascadeEnd = actualStart + duration;
  const shifts: Array<{ id: string; newStart: number }> = [];
  for (let j = i; j < onTrack.length; j++) {
    const c = onTrack[j];
    const cDur = c.outSec - c.inSec;
    if (c.startSec < cascadeEnd - 0.001) {
      const newStart = cascadeEnd;
      shifts.push({ id: c.id, newStart });
      cascadeEnd = newStart + cDur;
    } else {
      cascadeEnd = c.startSec + cDur;
    }
  }

  return { actualStart, shifts };
}

export function previewInsertionStart(
  clips: TimelineClip[],
  trackId: string,
  requestedStart: number,
): number {
  const onTrack = clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.startSec - b.startSec);
  let actualStart = 0;
  for (const c of onTrack) {
    const cEnd = c.startSec + (c.outSec - c.inSec);
    if (cEnd <= requestedStart + 0.001) actualStart = cEnd;
    else break;
  }
  return actualStart;
}

function withHistory<T extends object>(prev: AppState, patch: T): T & { past: DocSnapshot[]; future: DocSnapshot[] } {
  return {
    ...patch,
    past: [
      ...prev.past.slice(-(HISTORY_LIMIT - 1)),
      { tracks: prev.tracks, clips: prev.clips, projectColor: prev.projectColor },
    ],
    future: [],
  };
}

export const useStore = create<AppState>((set, get) => ({
  assets: [],
  tracks: DEFAULT_TRACKS,
  clips: [],
  subtitles: [],
  lastExport: undefined,
  waveforms: {},
  selectedAssetIds: [],
  assetSelectionAnchorId: null,
  selectedClipId: null,
  playheadSec: 0,
  isPlaying: false,
  pixelsPerSecond: 60,
  past: [],
  future: [],
  exportSettings: DEFAULT_EXPORT,
  framingEditOpen: false,
  exportModalOpen: false,
  projectColor: NEUTRAL_COLOR,
  activeColorTarget: null,
  colorPanelSnapshot: null,

  setClipCrop: (clipId, crop) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === clipId ? { ...c, crop } : c)),
    })),
  resetClipCrop: (clipId) =>
    set((s) =>
      withHistory(s, {
        clips: s.clips.map((c) => (c.id === clipId ? { ...c, crop: undefined } : c)),
      }),
    ),
  setClipColor: (clipId, patch) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== clipId) return c;
        const base = c.color ?? NEUTRAL_COLOR;
        const next = { ...base, ...patch };
        if (
          !next.enabled &&
          next.brightness === 0 &&
          next.contrast === 0 &&
          next.saturation === 0 &&
          next.gamma === 0
        ) {
          return { ...c, color: undefined };
        }
        return { ...c, color: next };
      }),
    })),
  setTrackColor: (trackId, patch) =>
    set((s) => ({
      tracks: s.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const base = t.color ?? NEUTRAL_COLOR;
        const next = { ...base, ...patch };
        if (
          !next.enabled &&
          next.brightness === 0 &&
          next.contrast === 0 &&
          next.saturation === 0 &&
          next.gamma === 0
        ) {
          return { ...t, color: undefined };
        }
        return { ...t, color: next };
      }),
    })),
  setProjectColor: (patch) =>
    set((s) => ({ projectColor: { ...s.projectColor, ...patch } })),
  resetColor: (target) =>
    set((s) => {
      if (target.kind === 'project') {
        return withHistory(s, { projectColor: NEUTRAL_COLOR });
      }
      if (target.kind === 'track') {
        return withHistory(s, {
          tracks: s.tracks.map((t) => (t.id === target.id ? { ...t, color: undefined } : t)),
        });
      }
      return withHistory(s, {
        clips: s.clips.map((c) => (c.id === target.id ? { ...c, color: undefined } : c)),
      });
    }),
  openColorPanel: (target) =>
    set((s) => ({
      activeColorTarget: target,
      colorPanelSnapshot: {
        tracks: s.tracks,
        clips: s.clips,
        projectColor: s.projectColor,
      },
    })),
  closeColorPanel: () => {
    const s = get();
    if (s.colorPanelSnapshot) {
      get().commitSnapshot(s.colorPanelSnapshot);
    }
    set({ activeColorTarget: null, colorPanelSnapshot: null });
  },
  enterFramingMode: () => {
    const s = get();
    let target: TimelineClip | undefined;

    const sel = s.clips.find((c) => c.id === s.selectedClipId);
    if (sel && sel.mediaKind === 'video') {
      target = sel;
    }
    if (!target) {
      for (const t of s.tracks) {
        if (t.kind !== 'video') continue;
        const c = s.clips.find(
          (cl) =>
            cl.trackId === t.id &&
            cl.mediaKind === 'video' &&
            s.playheadSec >= cl.startSec &&
            s.playheadSec < cl.startSec + (cl.outSec - cl.inSec),
        );
        if (c) {
          target = c;
          break;
        }
      }
    }
    if (!target) {
      target = s.clips.find((c) => c.mediaKind === 'video');
    }
    if (!target) return;

    const clipEnd = target.startSec + (target.outSec - target.inSec);
    const playhead =
      s.playheadSec >= target.startSec && s.playheadSec < clipEnd
        ? s.playheadSec
        : target.startSec + (clipEnd - target.startSec) * 0.5;

    set({
      selectedClipId: target.id,
      framingEditOpen: true,
      playheadSec: playhead,
    });
  },
  selectClipForFraming: (clipId) => {
    const s = get();
    const c = s.clips.find((x) => x.id === clipId);
    if (!c || c.mediaKind !== 'video') {
      set({ selectedClipId: clipId });
      return;
    }
    const clipEnd = c.startSec + (c.outSec - c.inSec);
    const playhead =
      s.playheadSec >= c.startSec && s.playheadSec < clipEnd
        ? s.playheadSec
        : c.startSec + (clipEnd - c.startSec) * 0.5;
    set({ selectedClipId: clipId, playheadSec: playhead });
  },
  setExportSettings: (patch) =>
    set((s) => ({ exportSettings: { ...s.exportSettings, ...patch } })),
  setFramingEditOpen: (open) => set({ framingEditOpen: open }),
  setExportModalOpen: (open) => set({ exportModalOpen: open }),

  addAssets: (assets) => set((s) => ({ assets: [...s.assets, ...assets] })),
  removeAsset: (id) =>
    set((s) => ({
      assets: s.assets.filter((a) => a.id !== id),
      clips: s.clips.filter((c) => c.assetId !== id),
      selectedAssetIds: s.selectedAssetIds.filter((x) => x !== id),
      assetSelectionAnchorId: s.assetSelectionAnchorId === id ? null : s.assetSelectionAnchorId,
    })),
  relinkAsset: (id, filePath) =>
    set((s) => ({
      assets: s.assets.map((a) =>
        a.id === id
          ? { ...a, filePath, fileName: filePath.split('/').pop() ?? a.fileName, missing: false }
          : a,
      ),
    })),
  setSubtitles: (subtitles) => set({ subtitles }),
  setLastExport: (lastExport) => set({ lastExport }),
  loadDocument: (doc) =>
    set({
      assets: doc.assets.map((a) => ({ ...a })),
      tracks: doc.tracks.map((t) => ({ ...t })),
      clips: doc.clips.map((c) => ({ ...c })),
      subtitles: (doc.subtitles ?? []).map((sub) => ({ ...sub })),
      projectColor: doc.projectColor ?? NEUTRAL_COLOR,
      exportSettings: { ...DEFAULT_EXPORT, ...doc.exportSettings },
      lastExport: doc.lastExport,
      waveforms: {},
      // reset all ephemeral / view state for a clean open
      selectedAssetIds: [],
      assetSelectionAnchorId: null,
      selectedClipId: null,
      isPlaying: false,
      past: [],
      future: [],
      framingEditOpen: false,
      exportModalOpen: false,
      activeColorTarget: null,
      colorPanelSnapshot: null,
      playheadSec: doc.ui?.playheadSec ?? 0,
      pixelsPerSecond: doc.ui?.pixelsPerSecond ?? 60,
    }),
  selectAsset: (id) =>
    set({
      selectedAssetIds: id ? [id] : [],
      assetSelectionAnchorId: id,
    }),
  toggleAssetInSelection: (id) =>
    set((s) => {
      const has = s.selectedAssetIds.includes(id);
      return {
        selectedAssetIds: has
          ? s.selectedAssetIds.filter((x) => x !== id)
          : [...s.selectedAssetIds, id],
        assetSelectionAnchorId: id,
      };
    }),
  selectAssetRange: (toId) =>
    set((s) => {
      const anchor = s.assetSelectionAnchorId;
      if (!anchor) {
        return { selectedAssetIds: [toId], assetSelectionAnchorId: toId };
      }
      const order = s.assets.map((a) => a.id);
      const ai = order.indexOf(anchor);
      const ti = order.indexOf(toId);
      if (ai < 0 || ti < 0) return {};
      const lo = Math.min(ai, ti);
      const hi = Math.max(ai, ti);
      return { selectedAssetIds: order.slice(lo, hi + 1) };
    }),
  clearAssetSelection: () => set({ selectedAssetIds: [], assetSelectionAnchorId: null }),
  setWaveform: (assetId, peaks) =>
    set((s) => ({ waveforms: { ...s.waveforms, [assetId]: peaks } })),

  addTrack: (kind) => {
    const id = `${kind}_${makeId()}`;
    set((s) => {
      const existing = s.tracks.filter((t) => t.kind === kind);
      const num = existing.length + 1;
      const newTrack: Track = {
        id,
        kind,
        label: kind === 'video' ? `Видео${num > 1 ? ' ' + num : ''}` : `Аудио${num > 1 ? ' ' + num : ''}`,
        volume: kind === 'video' ? 1 : 0.8,
        muted: false,
      };
      let newTracks: Track[];
      if (kind === 'video') {
        const firstVideoIdx = s.tracks.findIndex((t) => t.kind === 'video');
        const insertAt = firstVideoIdx === -1 ? 0 : firstVideoIdx;
        newTracks = [...s.tracks.slice(0, insertAt), newTrack, ...s.tracks.slice(insertAt)];
      } else {
        newTracks = [...s.tracks, newTrack];
      }
      return withHistory(s, { tracks: newTracks });
    });
    return id;
  },
  removeTrack: (id) =>
    set((s) =>
      withHistory(s, {
        tracks: s.tracks.filter((t) => t.id !== id),
        clips: s.clips.filter((c) => c.trackId !== id),
        selectedClipId:
          s.clips.find((c) => c.id === s.selectedClipId)?.trackId === id ? null : s.selectedClipId,
      }),
    ),
  setTrackVolume: (trackId, volume) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, volume } : t)),
    })),
  setTrackMuted: (trackId, muted) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
    })),

  addClips: (clips) =>
    set((s) =>
      withHistory(s, {
        clips: [...s.clips, ...clips],
        selectedClipId: clips.length > 0 ? clips[0].id : s.selectedClipId,
      }),
    ),
  addClipsWithShifts: (newClips, shifts) =>
    set((s) =>
      withHistory(s, {
        clips: [
          ...s.clips.map((c) => {
            const sh = shifts.find((x) => x.id === c.id);
            return sh ? { ...c, startSec: sh.newStart } : c;
          }),
          ...newClips,
        ],
        selectedClipId: newClips.length > 0 ? newClips[0].id : s.selectedClipId,
      }),
    ),
  insertAssetsWithRipple: (insertions, requestedStart) =>
    set((s) => {
      let working = [...s.clips];
      const newClips: TimelineClip[] = [];
      let currentStart = requestedStart;
      for (const ins of insertions) {
        const { actualStart, shifts } = computeRippleInsertion(
          working,
          ins.trackId,
          currentStart,
          ins.duration,
        );
        working = working.map((c) => {
          const sh = shifts.find((x) => x.id === c.id);
          return sh ? { ...c, startSec: sh.newStart } : c;
        });
        const newClip: TimelineClip = {
          id: makeId(),
          trackId: ins.trackId,
          assetId: ins.assetId,
          mediaKind: ins.mediaKind,
          startSec: actualStart,
          inSec: 0,
          outSec: ins.duration,
        };
        newClips.push(newClip);
        working.push(newClip);
        currentStart = actualStart + ins.duration;
      }
      if (newClips.length === 0) return {};
      return withHistory(s, {
        clips: working,
        selectedClipId: newClips[0].id,
      });
    }),
  updateClip: (id, patch) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  updateClipsBatch: (patches) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        const p = patches.find((x) => x.id === c.id);
        return p ? { ...c, ...p.patch } : c;
      }),
    })),
  removeClip: (id) =>
    set((s) => {
      const linked = getLinkedSiblings(s.clips, id);
      return withHistory(s, {
        clips: s.clips.filter((c) => !linked.includes(c.id)),
        selectedClipId: linked.includes(s.selectedClipId ?? '') ? null : s.selectedClipId,
      });
    }),
  removeClips: (ids) =>
    set((s) =>
      withHistory(s, {
        clips: s.clips.filter((c) => !ids.includes(c.id)),
        selectedClipId: ids.includes(s.selectedClipId ?? '') ? null : s.selectedClipId,
      }),
    ),
  selectClip: (id) => set({ selectedClipId: id }),

  unlinkClip: (id) =>
    set((s) => {
      const clip = s.clips.find((c) => c.id === id);
      if (!clip || !clip.linkedClipId) return {};
      const partnerId = clip.linkedClipId;
      return withHistory(s, {
        clips: s.clips.map((c) => {
          if (c.id === id || c.id === partnerId) {
            const patch: Partial<TimelineClip> = { linkedClipId: undefined };
            if (c.mediaKind === 'video') patch.extractedAudio = false;
            return { ...c, ...patch };
          }
          return c;
        }),
      });
    }),

  splitSelectedAtPlayhead: () => {
    const { clips, playheadSec, selectedClipId } = get();
    if (!selectedClipId) return;
    const targetIds = getLinkedSiblings(clips, selectedClipId);

    const toSplit = clips.filter((c) => {
      if (!targetIds.includes(c.id)) return false;
      const clipEnd = c.startSec + (c.outSec - c.inSec);
      return playheadSec > c.startSec + 0.05 && playheadSec < clipEnd - 0.05;
    });
    if (toSplit.length === 0) return;

    const oldToNew = new Map<string, string>();
    const newClips: TimelineClip[] = [];
    const updates: Array<{ id: string; patch: Partial<TimelineClip> }> = [];

    for (const clip of toSplit) {
      const localOffset = playheadSec - clip.startSec;
      const sourceCutAt = clip.inSec + localOffset;
      const newId = makeId();
      newClips.push({
        ...clip,
        id: newId,
        inSec: sourceCutAt,
        startSec: playheadSec,
        linkedClipId: undefined,
      });
      updates.push({ id: clip.id, patch: { outSec: sourceCutAt } });
      oldToNew.set(clip.id, newId);
    }

    for (const newClip of newClips) {
      const fromOld = [...oldToNew.entries()].find(([, nid]) => nid === newClip.id);
      if (!fromOld) continue;
      const oldClip = clips.find((c) => c.id === fromOld[0]);
      if (!oldClip || !oldClip.linkedClipId) continue;
      const partnerNew = oldToNew.get(oldClip.linkedClipId);
      if (partnerNew) newClip.linkedClipId = partnerNew;
    }

    set((s) =>
      withHistory(s, {
        clips: [
          ...s.clips.map((c) => {
            const u = updates.find((x) => x.id === c.id);
            return u ? { ...c, ...u.patch } : c;
          }),
          ...newClips,
        ],
      }),
    );
  },

  trimSelectedToPlayhead: (side) => {
    const { clips, playheadSec, selectedClipId } = get();
    if (!selectedClipId) return;
    const targetIds = getLinkedSiblings(clips, selectedClipId);

    const patches = new Map<string, Partial<TimelineClip>>();

    for (const targetId of targetIds) {
      const c = clips.find((x) => x.id === targetId);
      if (!c) continue;
      const clipEnd = c.startSec + (c.outSec - c.inSec);
      if (playheadSec <= c.startSec + 0.01 || playheadSec >= clipEnd - 0.01) continue;

      let deletedAmount = 0;
      if (side === 'left') {
        deletedAmount = playheadSec - c.startSec;
        patches.set(c.id, { inSec: c.inSec + deletedAmount });
      } else {
        deletedAmount = clipEnd - playheadSec;
        patches.set(c.id, { outSec: c.inSec + (playheadSec - c.startSec) });
      }

      for (const other of clips) {
        if (other.id === c.id) continue;
        if (other.trackId !== c.trackId) continue;
        if (other.startSec <= c.startSec) continue;
        const existing = patches.get(other.id) ?? {};
        const baseStart = existing.startSec ?? other.startSec;
        patches.set(other.id, { ...existing, startSec: Math.max(0, baseStart - deletedAmount) });
      }
    }

    if (patches.size === 0) return;

    set((s) =>
      withHistory(s, {
        clips: s.clips.map((c) => {
          const p = patches.get(c.id);
          return p ? { ...c, ...p } : c;
        }),
      }),
    );
  },

  extractAudioFromClip: (clipId) => {
    const { clips, assets, tracks } = get();
    const clip = clips.find((c) => c.id === clipId);
    if (!clip || clip.mediaKind !== 'video' || clip.extractedAudio) return;
    const asset = assets.find((a) => a.id === clip.assetId);
    if (!asset || !asset.probe.hasAudio) return;

    const existingAudio = tracks.filter((t) => t.kind === 'audio');
    const num = existingAudio.length + 1;
    const newTrack: Track = {
      id: `audio_${makeId()}`,
      kind: 'audio',
      label: `Аудио${num > 1 ? ' ' + num : ''} (из видео)`,
      volume: 1,
      muted: false,
    };

    const audioClipId = makeId();
    const audioClip: TimelineClip = {
      id: audioClipId,
      trackId: newTrack.id,
      assetId: clip.assetId,
      mediaKind: 'audio',
      startSec: clip.startSec,
      inSec: clip.inSec,
      outSec: clip.outSec,
      linkedClipId: clip.id,
    };

    set((s) =>
      withHistory(s, {
        tracks: [...s.tracks, newTrack],
        clips: [
          ...s.clips.map((c) =>
            c.id === clip.id ? { ...c, linkedClipId: audioClipId, extractedAudio: true } : c,
          ),
          audioClip,
        ],
      }),
    );
  },

  takeSnapshot: () => ({
    tracks: get().tracks,
    clips: get().clips,
    projectColor: get().projectColor,
  }),
  commitSnapshot: (snap) =>
    set((s) => {
      const sameTracks = s.tracks === snap.tracks;
      const sameClips = s.clips === snap.clips;
      const sameProjectColor = s.projectColor === snap.projectColor;
      if (sameTracks && sameClips && sameProjectColor) return {};
      return {
        past: [...s.past.slice(-(HISTORY_LIMIT - 1)), snap],
        future: [],
      };
    }),
  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const prev = s.past[s.past.length - 1];
      const cur: DocSnapshot = {
        tracks: s.tracks,
        clips: s.clips,
        projectColor: s.projectColor,
      };
      const validSelected = prev.clips.some((c) => c.id === s.selectedClipId)
        ? s.selectedClipId
        : null;
      return {
        tracks: prev.tracks,
        clips: prev.clips,
        projectColor: prev.projectColor,
        past: s.past.slice(0, -1),
        future: [...s.future, cur],
        selectedClipId: validSelected,
      };
    }),
  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[s.future.length - 1];
      const cur: DocSnapshot = {
        tracks: s.tracks,
        clips: s.clips,
        projectColor: s.projectColor,
      };
      const validSelected = next.clips.some((c) => c.id === s.selectedClipId)
        ? s.selectedClipId
        : null;
      return {
        tracks: next.tracks,
        clips: next.clips,
        projectColor: next.projectColor,
        past: [...s.past, cur],
        future: s.future.slice(0, -1),
        selectedClipId: validSelected,
      };
    }),

  play: () => {
    const { playheadSec, getTotalDuration } = get();
    if (playheadSec >= getTotalDuration() - 0.01) {
      set({ playheadSec: 0 });
    }
    set({ isPlaying: true });
  },
  pause: () => set({ isPlaying: false }),
  togglePlay: () => {
    const { isPlaying, play, pause } = get();
    if (isPlaying) pause();
    else play();
  },
  seek: (sec) => {
    const max = get().getTotalDuration();
    set({ playheadSec: Math.max(0, Math.min(sec, max)) });
  },
  setPlayheadSec: (sec) => set({ playheadSec: sec }),

  setPixelsPerSecond: (pps) => set({ pixelsPerSecond: pps }),

  getAssetById: (id) => get().assets.find((a) => a.id === id),
  getTrackById: (id) => get().tracks.find((t) => t.id === id),
  getTotalDuration: () => {
    const clips = get().clips;
    let max = 0;
    for (const c of clips) {
      const end = c.startSec + (c.outSec - c.inSec);
      if (end > max) max = end;
    }
    return max;
  },
}));

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 100);
  const base = h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
  return `${base}.${ms.toString().padStart(2, '0')}`;
}

export function fileToVpUrl(filePath: string): string {
  return `vpfile://local${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}
