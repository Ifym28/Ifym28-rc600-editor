// Electron main process: window, file access for the renderer, dialogs, backup.
//
// The renderer has no Node access. Every file call goes through the handlers
// below, and each one checks that the path is inside a folder the user chose
// (a detected RC-600 volume, a folder from a dialog, or the backup folder).

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');

const allowedRoots = new Set();
let win = null;

const backupHome = () => path.join(app.getPath('documents'), 'RC-600 Backups');
const trashHome = () => path.join(app.getPath('userData'), 'trash');

function allow(root) {
  allowedRoots.add(path.resolve(root));
  return root;
}

function check(p) {
  const full = path.resolve(p);
  for (const root of allowedRoots) {
    if (full === root || full.startsWith(root + path.sep)) return full;
  }
  throw new Error(`Path is outside the connected folders: ${p}`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Accept the ROLAND folder itself, a folder that holds it, or a DATA folder. */
async function resolveRoland(folder) {
  if (await exists(path.join(folder, 'ROLAND', 'DATA'))) return path.join(folder, 'ROLAND');
  if (await exists(path.join(folder, 'DATA'))) return folder;
  if (path.basename(folder).toUpperCase() === 'DATA') return path.dirname(folder);
  return null;
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

const handlers = {
  async findVolumes() {
    const out = [];
    // RC600_VOLUMES_DIR points the scan at another folder, for development and tests.
    const base = process.env.RC600_VOLUMES_DIR || (process.platform === 'darwin' ? '/Volumes' : null);
    if (!base) return out;
    for (const name of await fs.readdir(base).catch(() => [])) {
      const root = await resolveRoland(path.join(base, name)).catch(() => null);
      if (root) out.push({ name, root: allow(root) });
    }
    return out;
  },

  async pickFolder() {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose the RC-600 volume, its ROLAND folder, or a backup copy',
      properties: ['openDirectory'],
      defaultPath: process.platform === 'darwin' ? '/Volumes' : undefined,
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const root = await resolveRoland(r.filePaths[0]);
    if (!root) throw new Error('No ROLAND/DATA folder found in that location.');
    return { name: path.basename(path.dirname(root)) || path.basename(root), root: allow(root) };
  },

  async list(dir) {
    const full = check(dir);
    const entries = await fs.readdir(full, { withFileTypes: true }).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    const out = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const item = { name: e.name, dir: e.isDirectory(), size: 0 };
      if (!item.dir) item.size = (await fs.stat(path.join(full, e.name)).catch(() => ({ size: 0 }))).size;
      out.push(item);
    }
    return out;
  },

  async read(p, start, length) {
    const full = check(p);
    if (start == null) return fs.readFile(full);
    const fh = await fs.open(full, 'r');
    try {
      const { size } = await fh.stat();
      const from = start < 0 ? Math.max(0, size + start) : Math.min(start, size);
      const len = Math.min(length ?? size, size - from);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, from);
      return buf;
    } finally {
      await fh.close();
    }
  },

  // Write to a temporary file first, then rename, so a failed write cannot leave half a file.
  async write(p, bytes) {
    const full = check(p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp-rc600`;
    await fs.writeFile(tmp, Buffer.from(bytes));
    await fs.rename(tmp, full);
    return true;
  },

  async mkdir(p) {
    await fs.mkdir(check(p), { recursive: true });
    return true;
  },

  // "Remove" keeps a copy in the app trash folder, so a deleted loop can be recovered.
  async remove(p) {
    const full = check(p);
    if (!(await exists(full))) return false;
    const dest = path.join(trashHome(), stamp(), path.basename(full));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(full, dest, { recursive: true });
    await fs.rm(full, { recursive: true, force: true });
    return true;
  },

  async backup(root, opts = {}) {
    const src = check(root);
    const dest = path.join(backupHome(), `RC-600 ${stamp()}`, 'ROLAND');
    await fs.mkdir(dest, { recursive: true });
    const skip = (f) => path.basename(f).startsWith('.');
    await fs.cp(path.join(src, 'DATA'), path.join(dest, 'DATA'), { recursive: true, filter: (f) => !skip(f) });
    if (opts.wave && (await exists(path.join(src, 'WAVE')))) {
      await fs.cp(path.join(src, 'WAVE'), path.join(dest, 'WAVE'), { recursive: true, filter: (f) => !skip(f) });
    }
    return { path: path.dirname(dest), wave: !!opts.wave };
  },

  async pickBackup() {
    await fs.mkdir(backupHome(), { recursive: true });
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a backup folder',
      properties: ['openDirectory'],
      defaultPath: backupHome(),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const root = await resolveRoland(r.filePaths[0]);
    if (!root) throw new Error('That folder does not hold a ROLAND/DATA backup.');
    return { path: allow(root), wave: await exists(path.join(root, 'WAVE')) };
  },

  async restore(backupRoot, root) {
    const src = check(backupRoot);
    const dest = check(root);
    await fs.cp(path.join(src, 'DATA'), path.join(dest, 'DATA'), { recursive: true, force: true });
    const wave = await exists(path.join(src, 'WAVE'));
    if (wave) {
      await fs.rm(path.join(dest, 'WAVE'), { recursive: true, force: true });
      await fs.cp(path.join(src, 'WAVE'), path.join(dest, 'WAVE'), { recursive: true });
    }
    return { wave };
  },

  async saveFile(defaultName, bytes) {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), defaultName) });
    if (r.canceled || !r.filePath) return false;
    await fs.writeFile(r.filePath, Buffer.from(bytes));
    return true;
  },

  async openFile(extensions) {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Files', extensions: extensions || ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), bytes: await fs.readFile(r.filePaths[0]) };
  },

  async eject(root) {
    const full = check(root);
    const m = /^\/Volumes\/[^/]+/.exec(full);
    if (!m) throw new Error('This folder is not a mounted volume.');
    await new Promise((resolve, reject) => {
      execFile('/usr/sbin/diskutil', ['eject', m[0]], (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
    });
    allowedRoots.delete(full);
    return true;
  },

  async reveal(p) {
    shell.showItemInFolder(check(p));
    return true;
  },
};

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#08080a',
    titleBarStyle: 'hiddenInset',
    title: 'RC-600 Editor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  allow(backupHome());
  // Web MIDI needs a permission grant. Only the local app page asks for it.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'midi' || permission === 'midiSysex'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'midi' || permission === 'midiSysex');
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`rc600:${name}`, async (event, ...args) => {
      if (event.senderFrame !== win?.webContents.mainFrame) throw new Error('Unknown sender');
      return fn(...args);
    });
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
