import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  ExportProgress,
  ExportSpec,
  MediaProbe,
  ProjectDocument,
  ProjectMeta,
} from '../src/types.js';

const api = {
  openMediaDialog: (): Promise<string[]> => ipcRenderer.invoke('dialog:openMedia'),
  relinkMediaDialog: (fileName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:relinkMedia', fileName),
  saveFileDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),
  pathExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', filePath),
  // Путь файла, перетащенного из Finder (File.path убран в Electron 32).
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  expandMediaPaths: (paths: string[], exts: string[]): Promise<{ files: string[]; skipped: string[] }> =>
    ipcRenderer.invoke('fs:expandMedia', paths, exts),

  projects: {
    list: (): Promise<ProjectMeta[]> => ipcRenderer.invoke('projects:list'),
    create: (name: string): Promise<ProjectDocument> => ipcRenderer.invoke('projects:create', name),
    load: (id: string): Promise<ProjectDocument> => ipcRenderer.invoke('projects:load', id),
    save: (doc: ProjectDocument, poster?: string): Promise<ProjectMeta> =>
      ipcRenderer.invoke('projects:save', doc, poster),
    rename: (id: string, name: string): Promise<ProjectMeta> =>
      ipcRenderer.invoke('projects:rename', id, name),
    duplicate: (id: string): Promise<ProjectMeta> => ipcRenderer.invoke('projects:duplicate', id),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('projects:delete', id),
  },

  // Main asks the renderer to flush the open project before the app quits.
  onFlushSave: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on('app:flushSave', listener);
    return () => ipcRenderer.removeListener('app:flushSave', listener);
  },
  flushSaveDone: (): void => {
    ipcRenderer.send('app:flushSaveDone');
  },
  probeMedia: (filePath: string): Promise<MediaProbe> =>
    ipcRenderer.invoke('ffmpeg:probe', filePath),
  extractThumbnail: (filePath: string, atSec: number): Promise<string> =>
    ipcRenderer.invoke('ffmpeg:thumbnail', filePath, atSec),
  extractWaveform: (filePath: string): Promise<number[]> =>
    ipcRenderer.invoke('ffmpeg:waveform', filePath),
  runExport: (spec: ExportSpec): Promise<{ ok: boolean; path: string }> =>
    ipcRenderer.invoke('ffmpeg:export', spec),
  cancelExport: (): Promise<boolean> => ipcRenderer.invoke('ffmpeg:cancelExport'),
  onExportProgress: (cb: (p: ExportProgress) => void): (() => void) => {
    const listener = (_e: unknown, data: ExportProgress) => cb(data);
    ipcRenderer.on('ffmpeg:exportProgress', listener);
    return () => ipcRenderer.removeListener('ffmpeg:exportProgress', listener);
  },
  revealInFinder: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:revealInFinder', filePath),

  updates: {
    getState: (): Promise<unknown> => ipcRenderer.invoke('update:getState'),
    check: (): Promise<unknown> => ipcRenderer.invoke('update:check'),
    install: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
    onState: (cb: (s: unknown) => void): (() => void) => {
      const l = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on('update:state', l);
      return () => ipcRenderer.removeListener('update:state', l);
    },
    onShowPanel: (cb: () => void): (() => void) => {
      const l = () => cb();
      ipcRenderer.on('update:showPanel', l);
      return () => ipcRenderer.removeListener('update:showPanel', l);
    },
  },

  // Local agent API (electron/agent.ts) asks the renderer about the open project.
  onAgentRequest: (cb: (id: number, op: string, payload: unknown) => void): (() => void) => {
    const listener = (_e: unknown, id: number, op: string, payload: unknown) => cb(id, op, payload);
    ipcRenderer.on('agent:request', listener);
    return () => ipcRenderer.removeListener('agent:request', listener);
  },
  agentReply: (id: number, ok: boolean, data: unknown): void => {
    ipcRenderer.send('agent:reply', id, ok, data);
  },
};

contextBridge.exposeInMainWorld('vp', api);

export type VpApi = typeof api;
