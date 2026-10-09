export interface MediaProbe {
  durationSec: number;
  width?: number;
  height?: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  sizeBytes?: number;
}

export interface MediaAsset {
  id: string;
  filePath: string;
  fileName: string;
  probe: MediaProbe;
  thumbnail?: string;
  /** Set on project load when the source file is no longer at `filePath`. */
  missing?: boolean;
}

export type TrackKind = 'video' | 'audio';

export interface ColorCorrection {
  enabled: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
}

export const NEUTRAL_COLOR: ColorCorrection = {
  enabled: false,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 0,
};

export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  volume: number;
  muted: boolean;
  color?: ColorCorrection;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  assetId: string;
  mediaKind: TrackKind;
  startSec: number;
  inSec: number;
  outSec: number;
  linkedClipId?: string;
  extractedAudio?: boolean;
  crop?: NormRect;
  color?: ColorCorrection;
}

export type ColorTarget =
  | { kind: 'project' }
  | { kind: 'track'; id: string }
  | { kind: 'clip'; id: string };

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  quality: 'high' | 'medium' | 'low';
}

export interface ExportSpec {
  clips: TimelineClip[];
  tracks: Array<{
    id: string;
    kind: TrackKind;
    volume: number;
    muted: boolean;
    color?: ColorCorrection;
  }>;
  assets: Array<{ id: string; filePath: string; hasVideo: boolean; hasAudio: boolean }>;
  output: {
    width: number;
    height: number;
    fps: number;
    crf: number;
    path: string;
  };
  projectColor?: ColorCorrection;
  totalDuration: number;
}

export interface ExportProgress {
  progress: number;
  currentSec: number;
  totalSec: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project / document model
// ─────────────────────────────────────────────────────────────────────────────

/** Bump when the persisted document shape changes; handled in migrateDocument(). */
export const SCHEMA_VERSION = 1;

/** A single subtitle / caption cue. No editor UI yet (roadmap stage 4) — the
 *  shape is defined now so the project format stays stable as it lands. */
export interface SubtitleCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  /** Optional track association once subtitle tracks exist. */
  trackId?: string;
}

/** Record of the last export run, restored with the project. */
export interface LastExport {
  path: string;
  at: string; // ISO timestamp
  ok: boolean;
  width: number;
  height: number;
  fps: number;
  quality: ExportSettings['quality'];
  durationSec: number;
}

/** Small UI state restored for convenience (not core document data). */
export interface ProjectUiState {
  pixelsPerSecond: number;
  playheadSec: number;
}

/** The full, serializable project document written to project.json. */
export interface ProjectDocument {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Project settings = canvas format (w/h/fps) + export quality. */
  exportSettings: ExportSettings;
  lastExport?: LastExport;
  projectColor: ColorCorrection;
  assets: MediaAsset[];
  tracks: Track[];
  clips: TimelineClip[];
  subtitles: SubtitleCue[];
  ui?: ProjectUiState;
}

/** Lightweight summary used to render the projects screen without parsing the
 *  full document (clips/assets can be large). Stored as meta.json per project. */
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Data-URL poster (a frame from the timeline) for the project card. */
  poster?: string;
  durationSec: number;
  clipCount: number;
  assetCount: number;
}
