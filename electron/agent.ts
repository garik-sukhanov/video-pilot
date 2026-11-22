import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listProjects, loadProject, saveProject } from './ipc/projects.js';
import { probe } from './ipc/ffmpeg.js';
import { runExport } from './ipc/export.js';
import { checkForUpdate, getUpdateState, installUpdate } from './updater.js';
import type { ExportSpec, ProjectDocument } from '../src/types.js';

const PORT = Number(process.env['VIDEOPILOT_AGENT_PORT'] ?? 3911);
const MAX_BODY = 50 * 1024 * 1024;
const CRF = { high: 18, medium: 22, low: 28 } as const;

type Op = 'state' | 'getDocument' | 'applyDocument' | 'open';
type RendererState = { view: string; projectId: string | null; name: string | null; dirty: boolean };

let win: () => BrowserWindow | null = () => null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function askRenderer<T>(op: Op, payload?: unknown, timeoutMs = 15000): Promise<T> {
  const w = win();
  if (!w || w.isDestroyed()) return Promise.reject(new Error('окно VideoPilot не открыто'));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`renderer не ответил на ${op}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(t);
        resolve(v as T);
      },
      reject: (e) => {
        clearTimeout(t);
        reject(e);
      },
    });
    w.webContents.send('agent:request', id, op, payload);
  });
}

function timeline(doc: ProjectDocument): number {
  let max = 0;
  for (const c of doc.clips) max = Math.max(max, c.startSec + (c.outSec - c.inSec));
  return max;
}

function specFor(doc: ProjectDocument, path: string, quality?: keyof typeof CRF): ExportSpec {
  const s = doc.exportSettings;
  return {
    clips: doc.clips,
    tracks: doc.tracks.map((t) => ({ id: t.id, kind: t.kind, volume: t.volume, muted: t.muted, color: t.color })),
    assets: doc.assets.map((a) => ({
      id: a.id,
      filePath: a.filePath,
      hasVideo: a.probe.hasVideo,
      hasAudio: a.probe.hasAudio,
    })),
    output: { width: s.width, height: s.height, fps: s.fps, crf: CRF[quality ?? s.quality], path },
    projectColor: doc.projectColor,
    totalDuration: timeline(doc),
  };
}

async function currentState(): Promise<RendererState> {
  try {
    return await askRenderer<RendererState>('state', undefined, 3000);
  } catch {
    return { view: 'none', projectId: null, name: null, dirty: false };
  }
}

async function readDoc(id: string): Promise<{ doc: ProjectDocument; live: boolean }> {
  const st = await currentState();
  if (st.projectId === id) {
    return { doc: await askRenderer<ProjectDocument>('getDocument'), live: true };
  }
  return { doc: await loadProject(id), live: false };
}

async function fillProbes(doc: ProjectDocument) {
  for (const a of doc.assets) {
    if (!a.probe) a.probe = await probe(a.filePath);
    if (!a.fileName) a.fileName = a.filePath.split('/').pop() ?? a.filePath;
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('слишком большое тело запроса'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('тело запроса — не JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const host = (req.headers.host ?? '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return send(res, 403, { error: 'только localhost' });

  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const m = req.method ?? 'GET';
  if (parts[0] !== 'agent') return send(res, 404, { error: 'нет такой ручки' });
  const [, a, id, action] = parts;

  if (m === 'GET' && a === 'health') {
    return send(res, 200, { ok: true, app: 'VideoPilot', version: app.getVersion(), port: PORT });
  }
  if (m === 'GET' && a === 'state') return send(res, 200, await currentState());
  if (m === 'GET' && a === 'update') return send(res, 200, getUpdateState());
  if (m === 'POST' && a === 'update' && id === 'check') return send(res, 200, await checkForUpdate());
  if (m === 'POST' && a === 'update' && id === 'install') {
    void installUpdate().catch(() => {});
    return send(res, 202, { ok: true, note: 'скачиваю и устанавливаю; приложение перезапустится' });
  }
  if (m === 'GET' && a === 'projects' && !id) return send(res, 200, await listProjects());
  if (m === 'POST' && a === 'probe') {
    const { path } = (await readBody(req)) as { path?: string };
    if (!path) return send(res, 400, { error: 'нужен path' });
    return send(res, 200, await probe(path));
  }
  if (a === 'projects' && id && !action) {
    if (m === 'GET') {
      const { doc, live } = await readDoc(id);
      return send(res, 200, { live, doc });
    }
    if (m === 'PUT') {
      const doc = (await readBody(req)) as ProjectDocument;
      if (!doc || doc.id !== id) return send(res, 400, { error: 'id в теле не совпадает с адресом' });
      await fillProbes(doc);
      const st = await currentState();
      if (st.projectId === id) {
        await askRenderer('applyDocument', doc, 60000);
        return send(res, 200, { ok: true, live: true });
      }
      const meta = await saveProject(doc);
      return send(res, 200, { ok: true, live: false, meta });
    }
  }
  if (m === 'POST' && a === 'projects' && id && action === 'open') {
    await askRenderer('open', id, 30000);
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && a === 'projects' && id && action === 'export') {
    const body = (await readBody(req)) as { path?: string; quality?: keyof typeof CRF };
    if (!body.path) return send(res, 400, { error: 'нужен path для готового файла' });
    const { doc } = await readDoc(id);
    const w = win();
    if (!w) return send(res, 409, { error: 'окно VideoPilot не открыто' });
    const t0 = Date.now();
    const out = await runExport(specFor(doc, body.path, body.quality), w.webContents);
    return send(res, 200, { ...out, seconds: (Date.now() - t0) / 1000, durationSec: timeline(doc) });
  }
  return send(res, 404, { error: 'нет такой ручки' });
}

export function startAgentServer(getWindow: () => BrowserWindow | null) {
  win = getWindow;
  ipcMain.on('agent:reply', (_e, id: number, ok: boolean, data: unknown) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(data);
    else p.reject(new Error(String(data)));
  });

  const server = createServer((req, res) => {
    route(req, res).catch((e: Error) => send(res, 500, { error: e.message }));
  });
  server.on('error', (e) => console.error('agent server', e));
  server.listen(PORT, '127.0.0.1', () => {
    void writeFile(
      join(app.getPath('userData'), 'agent.json'),
      JSON.stringify({ url: `http://127.0.0.1:${PORT}/agent`, pid: process.pid }, null, 2),
    );
  });
}
