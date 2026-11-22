import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { UpdateState } from '../src/types.js';

export type { UpdateState };

/**
 * Обновление из GitHub Releases без подписи Apple (Squirrel.Mac её требует):
 * скачать zip под свою архитектуру → сверить sha256 → распаковать → закрыться →
 * внешний скрипт подменяет .app и запускает новую версию.
 */

const REPO = 'garik-sukhanov/video-pilot';
const FEED = process.env['VIDEOPILOT_UPDATE_FEED'] ?? `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}
interface Release {
  tag_name: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: ReleaseAsset[];
}

let state: UpdateState = { status: 'idle' };
let release: Release | null = null;
let asset: ReleaseAsset | null = null;
let win: () => BrowserWindow | null = () => null;

function set(next: UpdateState) {
  state = next;
  const w = win();
  if (w && !w.isDestroyed()) w.webContents.send('update:state', state);
}

function parse(v: string): number[] {
  return v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
}

export function isNewer(remote: string, local: string): boolean {
  const a = parse(remote);
  const b = parse(local);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Папка .app, из которой запущено приложение (…/VideoPilot.app). */
function bundlePath(): string | null {
  const p = app.getPath('exe'); // …/VideoPilot.app/Contents/MacOS/VideoPilot
  const i = p.indexOf('.app/Contents/MacOS/');
  return i > 0 ? p.slice(0, i + 4) : null;
}

function pickAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  const zips = assets.filter((a) => a.name.endsWith('.zip') && /mac/i.test(a.name));
  const other = process.arch === 'arm64' ? 'x64' : 'arm64';
  return (
    zips.find((a) => a.name.includes(`-${process.arch}-`)) ??
    zips.find((a) => a.name.includes('universal')) ??
    // архив без пометки архитектуры, но не под чужой процессор
    zips.find((a) => !a.name.includes(`-${other}-`)) ??
    null
  );
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (!app.isPackaged || !bundlePath()) {
    set({ status: 'unsupported', message: 'Обновление работает только в собранном приложении' });
    return state;
  }
  if (state.status === 'downloading' || state.status === 'installing') return state;
  set({ status: 'checking' });
  try {
    const r = await fetch(FEED, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VideoPilot-updater' },
    });
    if (r.status === 404) {
      // релизов ещё нет
      set({ status: 'latest', version: app.getVersion() });
      return state;
    }
    if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
    const rel = (await r.json()) as Release;
    const version = rel.tag_name.replace(/^v/, '');
    if (rel.draft || rel.prerelease || !isNewer(version, app.getVersion())) {
      set({ status: 'latest', version: app.getVersion() });
      return state;
    }
    const a = pickAsset(rel.assets);
    if (!a) throw new Error(`в релизе ${rel.tag_name} нет zip для macOS`);
    release = rel;
    asset = a;
    set({ status: 'available', version, notes: (rel.body ?? '').trim().slice(0, 600), sizeBytes: a.size });
  } catch (e) {
    set({ status: 'error', message: `Не удалось проверить обновления: ${(e as Error).message}` });
  }
  return state;
}

async function download(a: ReleaseAsset, version: string, dir: string): Promise<string> {
  const file = join(dir, a.name);
  const r = await fetch(a.browser_download_url, { headers: { 'User-Agent': 'VideoPilot-updater' } });
  if (!r.ok || !r.body) throw new Error(`загрузка: HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || a.size || 0;
  const hash = createHash('sha256');
  let got = 0;
  let last = 0;
  const body = Readable.fromWeb(r.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    got += chunk.length;
    const now = Date.now();
    if (total && now - last > 200) {
      last = now;
      set({ status: 'downloading', version, progress: Math.min(1, got / total) });
    }
  });
  await pipeline(body, createWriteStream(file));
  const sum = hash.digest('hex');
  if (a.digest && a.digest.startsWith('sha256:') && a.digest.slice(7) !== sum) {
    throw new Error('контрольная сумма не совпала — файл повреждён, обновление отменено');
  }
  return file;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd}: ${err.trim() || code}`))));
  });
}

export async function installUpdate(): Promise<void> {
  if (state.status !== 'available' || !release || !asset) throw new Error('нет доступного обновления');
  const target = bundlePath();
  if (!target) throw new Error('не найдена папка приложения');
  const version = release.tag_name.replace(/^v/, '');
  const dir = await mkdtemp(join(tmpdir(), 'videopilot-update-'));
  try {
    set({ status: 'downloading', version, progress: 0 });
    const zip = await download(asset, version, dir);
    set({ status: 'installing', version });
    const out = join(dir, 'unpacked');
    await run('/usr/bin/ditto', ['-x', '-k', zip, out]);
    const appName = (await readdir(out)).find((n) => n.endsWith('.app'));
    if (!appName) throw new Error('в архиве нет .app');
    const fresh = join(out, appName);
    if (!existsSync(join(fresh, 'Contents', 'MacOS'))) throw new Error('архив повреждён');

    // Подмена делается снаружи: дожидаемся выхода процесса, меняем бандл,
    // при ошибке возвращаем старый, запускаем то, что получилось.
    const script = join(dir, 'swap.sh');
    await writeFile(
      script,
      `#!/bin/bash
PID=${process.pid}
APP=${JSON.stringify(target)}
NEW=${JSON.stringify(fresh)}
OLD="$APP.old-$$"
for i in $(seq 1 300); do kill -0 $PID 2>/dev/null || break; sleep 0.2; done
if mv "$APP" "$OLD" && /usr/bin/ditto "$NEW" "$APP"; then
  rm -rf "$OLD"
else
  rm -rf "$APP"; mv "$OLD" "$APP"
fi
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null
/usr/bin/open "$APP"
rm -rf ${JSON.stringify(dir)}
`,
    );
    await chmod(script, 0o755);
    if (!existsSync(dirname(target))) throw new Error('папка приложения недоступна');
    spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' }).unref();
    // before-quit в main сохранит открытый проект, затем процесс завершится
    setTimeout(() => app.quit(), 300);
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    set({ status: 'error', message: `Обновление не установлено: ${(e as Error).message}` });
    throw e;
  }
}

export function startUpdater(getWindow: () => BrowserWindow | null) {
  win = getWindow;
  ipcMain.handle('update:getState', () => state);
  ipcMain.handle('update:check', () => checkForUpdate());
  ipcMain.handle('update:install', () => installUpdate().then(() => true));
  setTimeout(() => void checkForUpdate(), 8000);
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}

export function getUpdateState(): UpdateState {
  return state;
}
