import { create } from 'zustand';
import { useStore, makeId } from './store';
import type { MediaAsset } from './types';

export const MEDIA_EXTENSIONS = [
  'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi',
  'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg',
];

export interface ImportProgress {
  total: number;
  done: number;
  currentName: string;
}

interface ImportState {
  progress: ImportProgress | null;
  /** Итог последнего импорта: что пропущено и почему. */
  notice: string | null;
  error: string | null;
  setProgress: (p: ImportProgress | null) => void;
  setNotice: (n: string | null) => void;
  setError: (e: string | null) => void;
}

export const useImportStore = create<ImportState>((set) => ({
  progress: null,
  notice: null,
  error: null,
  setProgress: (progress) => set({ progress }),
  setNotice: (notice) => set({ notice }),
  setError: (error) => set({ error }),
}));

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Файлы, перетащенные из Finder, — в абсолютные пути. */
export function pathsFromDrop(dt: DataTransfer): string[] {
  const out: string[] = [];
  for (const f of Array.from(dt.files)) {
    const p = window.vp.pathForFile(f);
    if (p) out.push(p);
  }
  return out;
}

export function isFileDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes('Files');
}

/**
 * Импорт в «Исходники»: папки раскрываются, неподдерживаемые форматы и уже
 * импортированные файлы пропускаются. Возвращает добавленные ассеты.
 */
export async function importPaths(rawPaths: string[]): Promise<MediaAsset[]> {
  const ui = useImportStore.getState();
  ui.setError(null);
  ui.setNotice(null);
  if (rawPaths.length === 0) return [];

  const { files, skipped } = await window.vp.expandMediaPaths(rawPaths, MEDIA_EXTENSIONS);
  const existing = new Set(useStore.getState().assets.map((a) => a.filePath));
  const fresh = files.filter((p) => !existing.has(p));
  const dupes = files.length - fresh.length;

  const notes: string[] = [];
  if (skipped.length > 0) {
    notes.push(
      `пропущено ${skipped.length} ${plural(skipped.length, 'файл', 'файла', 'файлов')} — формат не поддерживается` +
        (skipped.length <= 3 ? ` (${skipped.map(basename).join(', ')})` : ''),
    );
  }
  if (dupes > 0) notes.push(`${dupes} уже в исходниках`);

  const added: MediaAsset[] = [];
  if (fresh.length > 0) {
    ui.setProgress({ total: fresh.length, done: 0, currentName: '' });
    for (let i = 0; i < fresh.length; i++) {
      const filePath = fresh[i];
      const name = basename(filePath);
      ui.setProgress({ total: fresh.length, done: i, currentName: name });
      try {
        const probe = await window.vp.probeMedia(filePath);
        if (!probe.hasVideo && !probe.hasAudio) {
          notes.push(`${name}: нет ни видео, ни звука`);
          continue;
        }
        let thumbnail: string | undefined;
        if (probe.hasVideo) {
          try {
            thumbnail = await window.vp.extractThumbnail(filePath, Math.min(1, probe.durationSec / 2));
          } catch {
            /* миниатюра не обязательна */
          }
        }
        const asset: MediaAsset = { id: makeId(), filePath, fileName: name, probe, thumbnail };
        added.push(asset);
        useStore.getState().addAssets([asset]);
        if (probe.hasAudio) {
          window.vp
            .extractWaveform(filePath)
            .then((peaks) => useStore.getState().setWaveform(asset.id, peaks))
            .catch((err) => console.warn('waveform extraction failed', filePath, err));
        }
      } catch (e) {
        console.error('probe failed', filePath, e);
        notes.push(`${name}: не удалось прочитать`);
      }
    }
    ui.setProgress({ total: fresh.length, done: fresh.length, currentName: '' });
    setTimeout(() => useImportStore.getState().setProgress(null), 400);
  }

  if (added.length > 0) useStore.getState().selectAsset(added[0].id);
  if (notes.length > 0) {
    ui.setNotice(notes.join('; '));
    setTimeout(() => useImportStore.getState().setNotice(null), 6000);
  }
  return added;
}
