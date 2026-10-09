import type {
  ExportProgress,
  ExportSpec,
  MediaProbe,
  ProjectDocument,
  ProjectMeta,
} from './types';

declare global {
  interface Window {
    vp: {
      openMediaDialog: () => Promise<string[]>;
      relinkMediaDialog: (fileName: string) => Promise<string | null>;
      saveFileDialog: (defaultName: string) => Promise<string | null>;
      pathExists: (filePath: string) => Promise<boolean>;
      probeMedia: (filePath: string) => Promise<MediaProbe>;
      extractThumbnail: (filePath: string, atSec: number) => Promise<string>;
      extractWaveform: (filePath: string) => Promise<number[]>;
      runExport: (spec: ExportSpec) => Promise<{ ok: boolean; path: string }>;
      cancelExport: () => Promise<boolean>;
      onExportProgress: (cb: (p: ExportProgress) => void) => () => void;
      revealInFinder: (filePath: string) => Promise<boolean>;
      projects: {
        list: () => Promise<ProjectMeta[]>;
        create: (name: string) => Promise<ProjectDocument>;
        load: (id: string) => Promise<ProjectDocument>;
        save: (doc: ProjectDocument, poster?: string) => Promise<ProjectMeta>;
        rename: (id: string, name: string) => Promise<ProjectMeta>;
        duplicate: (id: string) => Promise<ProjectMeta>;
        remove: (id: string) => Promise<boolean>;
      };
      onFlushSave: (cb: () => void) => () => void;
      flushSaveDone: () => void;
    };
  }
}

export {};
