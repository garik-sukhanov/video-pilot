import type { IpcMain } from 'electron';
import { app } from 'electron';
import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectDocument, ProjectMeta } from '../../src/types.js';

function projectsRoot(): string {
  return join(app.getPath('userData'), 'Projects');
}

function projectDir(id: string): string {
  return join(projectsRoot(), id);
}

async function ensureRoot(): Promise<void> {
  await mkdir(projectsRoot(), { recursive: true });
}

function makeProjectId(): string {
  // time-prefixed so the on-disk folder order roughly matches creation order
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function timelineDuration(doc: Pick<ProjectDocument, 'clips'>): number {
  let max = 0;
  for (const c of doc.clips) {
    const end = c.startSec + (c.outSec - c.inSec);
    if (end > max) max = end;
  }
  return max;
}

function deriveMeta(doc: ProjectDocument, poster?: string): ProjectMeta {
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    poster,
    durationSec: timelineDuration(doc),
    clipCount: doc.clips.length,
    assetCount: doc.assets.length,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function listProjects(): Promise<ProjectMeta[]> {
  await ensureRoot();
  const entries = await readdir(projectsRoot(), { withFileTypes: true });
  const metas: ProjectMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(projectDir(entry.name), 'meta.json');
    try {
      if (existsSync(metaPath)) {
        metas.push(await readJson<ProjectMeta>(metaPath));
        continue;
      }
      // Fall back to deriving meta from the document if meta.json is missing.
      const docPath = join(projectDir(entry.name), 'project.json');
      if (existsSync(docPath)) {
        const doc = await readJson<ProjectDocument>(docPath);
        metas.push(deriveMeta(doc));
      }
    } catch (e) {
      console.warn('skipping unreadable project', entry.name, e);
    }
  }
  // newest first
  metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return metas;
}

async function createProject(name: string): Promise<ProjectDocument> {
  await ensureRoot();
  const id = makeProjectId();
  const now = new Date().toISOString();
  const doc: ProjectDocument = {
    schemaVersion: 1,
    id,
    name: name.trim() || 'Без названия',
    createdAt: now,
    updatedAt: now,
    exportSettings: { width: 1920, height: 1080, fps: 30, quality: 'high' },
    projectColor: { enabled: false, brightness: 0, contrast: 0, saturation: 0, gamma: 0 },
    assets: [],
    tracks: [
      { id: 'video_1', kind: 'video', label: 'Видео', volume: 1, muted: false },
      { id: 'audio_1', kind: 'audio', label: 'Аудио', volume: 0.8, muted: false },
    ],
    clips: [],
    subtitles: [],
  };
  await mkdir(projectDir(id), { recursive: true });
  await writeJson(join(projectDir(id), 'project.json'), doc);
  await writeJson(join(projectDir(id), 'meta.json'), deriveMeta(doc));
  return doc;
}

async function loadProject(id: string): Promise<ProjectDocument> {
  const docPath = join(projectDir(id), 'project.json');
  return readJson<ProjectDocument>(docPath);
}

async function saveProject(doc: ProjectDocument, poster?: string): Promise<ProjectMeta> {
  const dir = projectDir(doc.id);
  await mkdir(dir, { recursive: true });
  const toWrite: ProjectDocument = { ...doc, updatedAt: new Date().toISOString() };
  await writeJson(join(dir, 'project.json'), toWrite);
  const meta = deriveMeta(toWrite, poster);
  await writeJson(join(dir, 'meta.json'), meta);
  return meta;
}

async function renameProject(id: string, name: string): Promise<ProjectMeta> {
  const doc = await loadProject(id);
  doc.name = name.trim() || doc.name;
  // preserve existing poster if present
  let poster: string | undefined;
  const metaPath = join(projectDir(id), 'meta.json');
  if (existsSync(metaPath)) {
    poster = (await readJson<ProjectMeta>(metaPath)).poster;
  }
  return saveProject(doc, poster);
}

async function duplicateProject(id: string): Promise<ProjectMeta> {
  const doc = await loadProject(id);
  const newId = makeProjectId();
  const now = new Date().toISOString();
  const copy: ProjectDocument = {
    ...doc,
    id: newId,
    name: `${doc.name} (копия)`,
    createdAt: now,
    updatedAt: now,
  };
  let poster: string | undefined;
  const metaPath = join(projectDir(id), 'meta.json');
  if (existsSync(metaPath)) {
    poster = (await readJson<ProjectMeta>(metaPath)).poster;
  }
  await mkdir(projectDir(newId), { recursive: true });
  await writeJson(join(projectDir(newId), 'project.json'), copy);
  const meta = deriveMeta(copy, poster);
  await writeJson(join(projectDir(newId), 'meta.json'), meta);
  return meta;
}

async function deleteProject(id: string): Promise<boolean> {
  const dir = projectDir(id);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

export function registerProjectHandlers(ipcMain: IpcMain) {
  ipcMain.handle('projects:list', () => listProjects());
  ipcMain.handle('projects:create', (_e, name: string) => createProject(name));
  ipcMain.handle('projects:load', (_e, id: string) => loadProject(id));
  ipcMain.handle('projects:save', (_e, doc: ProjectDocument, poster?: string) =>
    saveProject(doc, poster),
  );
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => renameProject(id, name));
  ipcMain.handle('projects:duplicate', (_e, id: string) => duplicateProject(id));
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id));

  // Used to detect / relink media that has moved since the project was saved.
  ipcMain.handle('fs:exists', async (_e, filePath: string) => {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  });
}
