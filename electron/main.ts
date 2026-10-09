import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { registerFfmpegHandlers } from './ipc/ffmpeg.js';
import { registerExportHandlers } from './ipc/export.js';
import { registerProjectHandlers } from './ipc/projects.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vpfile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

function mimeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function serveLocalFile(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filePath = decodeURIComponent(url.pathname);

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  const fileSize = fileStat.size;
  const range = req.headers.get('range');

  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mimeFor(filePath),
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
  }

  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': mimeFor(filePath),
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
    },
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1a1a1f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  protocol.handle('vpfile', serveLocalFile);

  registerIpc();
  registerFfmpegHandlers(ipcMain);
  registerExportHandlers(ipcMain);
  registerProjectHandlers(ipcMain);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Give the renderer a chance to flush the current project to disk before we quit.
let flushing = false;
app.on('before-quit', (e) => {
  if (flushing || !mainWindow || mainWindow.isDestroyed()) return;
  e.preventDefault();
  flushing = true;
  const done = () => app.quit();
  ipcMain.once('app:flushSaveDone', done);
  mainWindow.webContents.send('app:flushSave');
  // Safety net: never hang the quit on a stuck renderer.
  setTimeout(done, 1500);
});

function registerIpc() {
  ipcMain.handle('shell:revealInFinder', async (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle('dialog:openMedia', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Импорт исходников',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Видео и аудио',
          extensions: [
            'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi',
            'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg',
          ],
        },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('dialog:relinkMedia', async (_e, fileName: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Найти файл: ${fileName}`,
      properties: ['openFile'],
      filters: [
        {
          name: 'Видео и аудио',
          extensions: [
            'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi',
            'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg',
          ],
        },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:saveFile', async (_e, defaultName: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Экспорт',
      defaultPath: defaultName,
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    return result.canceled ? null : result.filePath;
  });
}
