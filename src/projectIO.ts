import { useStore } from './store';
import { useAppStore, metaToOpen } from './appStore';
import { SCHEMA_VERSION } from './types';
import type { ProjectDocument } from './types';

const AUTOSAVE_DEBOUNCE_MS = 700;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

/** Fields of the editor store whose change should trigger an autosave.
 *  playheadSec / isPlaying are intentionally excluded so playback doesn't
 *  fire a save on every frame. */
function persistSignature(s: ReturnType<typeof useStore.getState>) {
  return [
    s.assets,
    s.tracks,
    s.clips,
    s.subtitles,
    s.projectColor,
    s.exportSettings,
    s.lastExport,
    s.pixelsPerSecond,
  ];
}

/** Build the serializable document from the current editor + shell state. */
export function buildDocument(): ProjectDocument | null {
  const app = useAppStore.getState();
  if (!app.current) return null;
  const s = useStore.getState();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: app.current.id,
    name: app.current.name,
    createdAt: app.current.createdAt,
    updatedAt: new Date().toISOString(),
    exportSettings: s.exportSettings,
    lastExport: s.lastExport,
    projectColor: s.projectColor,
    // Drop transient `missing` flags from persisted assets.
    assets: s.assets.map(({ missing: _missing, ...a }) => a),
    tracks: s.tracks,
    clips: s.clips,
    subtitles: s.subtitles,
    ui: { pixelsPerSecond: s.pixelsPerSecond, playheadSec: s.playheadSec },
  };
}

/** Poster for the project card: first available asset thumbnail, preferring
 *  one that's actually used by a video clip on the timeline. */
function pickPoster(): string | undefined {
  const s = useStore.getState();
  const usedAssetIds = new Set(
    s.clips.filter((c) => c.mediaKind === 'video').map((c) => c.assetId),
  );
  const used = s.assets.find((a) => usedAssetIds.has(a.id) && a.thumbnail);
  if (used?.thumbnail) return used.thumbnail;
  return s.assets.find((a) => a.thumbnail)?.thumbnail;
}

export async function saveCurrentProject(): Promise<void> {
  const doc = buildDocument();
  if (!doc) return;
  useAppStore.getState().setSaving(true);
  try {
    const meta = await window.vp.projects.save(doc, pickPoster());
    useAppStore.getState().markSaved(meta.updatedAt);
    useAppStore.getState().bumpProjects();
  } catch (e) {
    console.error('project save failed', e);
    useAppStore.getState().setSaving(false);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveCurrentProject();
  }, AUTOSAVE_DEBOUNCE_MS);
}

/** Start watching the editor store and autosaving on change. */
export function startAutosave() {
  stopAutosave();
  let prev = persistSignature(useStore.getState());
  unsubscribe = useStore.subscribe((state) => {
    const next = persistSignature(state);
    const changed = next.some((v, i) => v !== prev[i]);
    prev = next;
    if (!changed) return;
    useAppStore.getState().markDirty();
    scheduleSave();
  });
}

export function stopAutosave() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

/** After a project loads, flag assets whose source file has moved/disappeared. */
async function flagMissingMedia() {
  const assets = useStore.getState().assets;
  await Promise.all(
    assets.map(async (a) => {
      const exists = await window.vp.pathExists(a.filePath);
      if (!exists) {
        useStore.setState((s) => ({
          assets: s.assets.map((x) => (x.id === a.id ? { ...x, missing: true } : x)),
        }));
      }
    }),
  );
}

/** Regenerate waveform peaks for audio-bearing assets (cheap: ffmpeg caches
 *  them on disk keyed by file path, so this is near-instant on reload). */
async function regenerateWaveforms() {
  const assets = useStore.getState().assets;
  for (const a of assets) {
    if (!a.probe.hasAudio || a.missing) continue;
    window.vp
      .extractWaveform(a.filePath)
      .then((peaks) => useStore.getState().setWaveform(a.id, peaks))
      .catch(() => {
        /* waveform is optional */
      });
  }
}

function afterOpen(doc: ProjectDocument) {
  useStore.getState().loadDocument(doc);
  useAppStore.getState().setCurrent(metaToOpen(doc));
  useAppStore.getState().setView('editor');
  startAutosave();
  void flagMissingMedia().then(regenerateWaveforms);
}

export async function openProject(id: string): Promise<void> {
  const doc = await window.vp.projects.load(id);
  afterOpen(doc);
}

export async function createAndOpenProject(name: string): Promise<void> {
  const doc = await window.vp.projects.create(name);
  afterOpen(doc);
}

/** Save and return to the projects screen. */
export async function closeToProjects(): Promise<void> {
  await saveCurrentProject();
  stopAutosave();
  useAppStore.getState().setView('projects');
  useAppStore.getState().setCurrent(null);
  useAppStore.getState().bumpProjects();
}

/** Wire the quit handshake once at app startup so the open project is flushed
 *  to disk before the process exits. */
export function installQuitFlush() {
  window.vp.onFlushSave(async () => {
    if (useAppStore.getState().current) {
      await saveCurrentProject();
    }
    window.vp.flushSaveDone();
  });
}
