import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createOrganization, reconcileTabs, createFolder, renameFolder, deleteFolder, moveFolder, moveTab } from './organization.js';
import { makeCsv } from './export.js';
import { ApiError, createWebhookServer, metadataKey, publicSnapshot } from './webhook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 17349;
const sources = new Map();
let window;
let server;
let metadata = {};
let dataFile;
let organization = createOrganization();
let organizationFile;
let serverError = '';
let webhookFile;
let webhookConfig = { enabled: true, lan: false, port: 17350, token: '' };
let webhookServer;
let webhookRunning = false;
let webhookError = '';
const durationLookups = new Set();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  app.whenReady().then(() => {
    dataFile = path.join(app.getPath('userData'), 'library.json');
    try {
      metadata = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) metadata = {};
    } catch {
      metadata = {};
    }
    organizationFile = path.join(app.getPath('userData'), 'folders.json');
    try { organization = createOrganization(JSON.parse(fs.readFileSync(organizationFile, 'utf8'))); } catch { /* First launch. */ }
    webhookFile = path.join(app.getPath('userData'), 'webhook.json');
    try {
      const saved = JSON.parse(fs.readFileSync(webhookFile, 'utf8'));
      if (typeof saved.enabled === 'boolean') webhookConfig.enabled = saved.enabled;
      if (typeof saved.lan === 'boolean') webhookConfig.lan = saved.lan;
      if (Number.isInteger(saved.port) && saved.port >= 1024 && saved.port <= 65535) webhookConfig.port = saved.port;
      if (typeof saved.token === 'string' && /^[a-f0-9]{64}$/.test(saved.token)) webhookConfig.token = saved.token;
    } catch { /* First launch. */ }
    if (!webhookConfig.token) webhookConfig.token = randomBytes(32).toString('hex');
    saveWebhookConfig();
    startServer();
    createWindow();
    startWebhook(webhookConfig).catch((error) => {
      webhookError = error.message;
      publish();
    });
  });
}

function state() {
  return {
    sources: Array.from(sources.values(), ({ id, name, tabs }) => ({ id, name, tabs })),
    metadata,
    organization,
    webhook: webhookStatus(),
    serverError
  };
}

function webhookStatus() {
  const lanUrls = [];
  if (webhookConfig.lan) {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === 'IPv4' && !address.internal) lanUrls.push(`http://${address.address}:${webhookConfig.port}`);
      }
    }
  }
  return {
    enabled: webhookConfig.enabled,
    lan: webhookConfig.lan,
    port: webhookConfig.port,
    running: webhookRunning,
    error: webhookError,
    localUrl: `http://127.0.0.1:${webhookConfig.port}`,
    lanUrls: [...new Set(lanUrls)]
  };
}

function publish() {
  if (window && !window.isDestroyed()) window.webContents.send('state', state());
}

function startServer() {
  server = new WebSocketServer({ host: '127.0.0.1', port: PORT });
  server.on('error', (error) => {
    serverError = `Local connection unavailable: ${error.message}`;
    publish();
  });

  server.on('connection', (socket) => {
    let sourceId = null;

    socket.on('message', (bytes) => {
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { return; }

      if (message.type === 'hello' && typeof message.id === 'string' && message.id.length <= 100) {
        sourceId = message.id;
        const existing = sources.get(sourceId);
        if (existing && existing.socket !== socket) existing.socket.close();
        sources.set(sourceId, {
          id: sourceId,
          name: typeof message.name === 'string' ? message.name.slice(0, 60) : 'Browser',
          tabs: [],
          socket
        });
        publish();
      }

      if (!sourceId || sources.get(sourceId)?.socket !== socket) return;

      if (message.type === 'snapshot' && Array.isArray(message.tabs)) {
        const source = sources.get(sourceId);
        const validTabs = message.tabs.slice(0, 2000).filter((tab) => {
          if (!Number.isInteger(tab.id) || !Number.isInteger(tab.windowId) || typeof tab.url !== 'string') return false;
          try {
            const host = new URL(tab.url).hostname;
            return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
          } catch { return false; }
        }).map((tab) => ({
          id: tab.id,
          windowId: tab.windowId,
          url: tab.url.slice(0, 2048),
          title: String(tab.title || 'YouTube').slice(0, 300),
          active: Boolean(tab.active)
        }));
        const reconciled = reconcileTabs(organization, sourceId, validTabs);
        source.tabs = reconciled.tabs;
        if (reconciled.changed) saveOrganization();
        publish();
        lookupDurations(source.tabs);
      }

      if (message.type === 'watched' && typeof message.videoId === 'string' && /^[\w-]{11}$/.test(message.videoId)) {
        const key = `video:${message.videoId}`;
        if (!metadata[key]?.watched) updateMeta(key, { watched: true });
      }

      if (message.type === 'duration' && typeof message.videoId === 'string' && /^[\w-]{11}$/.test(message.videoId) &&
        Number.isFinite(message.duration) && message.duration > 0 && message.duration <= 86400) {
        updateMeta(`video:${message.videoId}`, { duration: message.duration });
      }
    });

    socket.on('close', () => {
      if (sourceId && sources.get(sourceId)?.socket === socket) {
        sources.delete(sourceId);
        publish();
      }
    });
    socket.on('error', () => {});
  });
}

function ytDlpPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'yt-dlp.exe')
    : path.join(app.getAppPath(), 'vendor', 'yt-dlp.exe');
}

function youtubeVideoId(url) {
  try {
    const parsed = new URL(url);
    const id = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1).split('/')[0]
      : parsed.pathname === '/watch' ? parsed.searchParams.get('v')
      : parsed.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

function lookupDurations(tabs, force = false) {
  for (const tab of tabs) {
    const id = youtubeVideoId(tab.url);
    const key = id && `video:${id}`;
    if (!key || (!force && Number.isFinite(metadata[key]?.duration)) || durationLookups.has(key)) continue;
    durationLookups.add(key);
    execFile(ytDlpPath(), ['--print', '%(duration)s', '--skip-download', '--no-warnings', '--no-playlist', tab.url], {
      timeout: 30000,
      maxBuffer: 64 * 1024
    }, (error, stdout) => {
      durationLookups.delete(key);
      if (error) return;
      const duration = Number(stdout.trim());
      if (Number.isFinite(duration) && duration > 0 && duration <= 86400) updateMeta(key, { duration });
    });
  }
}

function updateMeta(key, patch) {
  if (typeof key !== 'string' || key.length > 220 || !patch || typeof patch !== 'object') return;
  const previous = metadata[key] || {};
  const next = { ...previous };
  if (typeof patch.watched === 'boolean') next.watched = patch.watched;
  if (Number.isFinite(patch.duration) && patch.duration > 0 && patch.duration <= 86400) next.duration = patch.duration;
  if (typeof patch.priority === 'boolean') next.priority = patch.priority;
  if (Array.isArray(patch.tags)) {
    next.tags = [...new Set(patch.tags.filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim().slice(0, 32)).filter(Boolean))].slice(0, 12);
  }
  metadata[key] = next;
  try { fs.writeFileSync(dataFile, JSON.stringify(metadata, null, 2)); } catch (error) {
    console.error('Could not save library:', error);
  }
  publish();
  return next;
}

function saveOrganization() {
  try { fs.writeFileSync(organizationFile, JSON.stringify(organization, null, 2)); } catch (error) {
    console.error('Could not save folders:', error);
  }
}

function changeOrganization(operation) {
  const result = operation();
  if (result) {
    saveOrganization();
    publish();
  }
  return result;
}

function saveWebhookConfig() {
  fs.writeFileSync(webhookFile, JSON.stringify(webhookConfig, null, 2));
}

async function stopWebhook() {
  if (!webhookServer) return;
  const previous = webhookServer;
  webhookServer = undefined;
  webhookRunning = false;
  await new Promise((resolve) => previous.close(resolve));
}

async function startWebhook(settings) {
  if (!settings.enabled) {
    webhookRunning = false;
    webhookError = '';
    publish();
    return;
  }
  const instance = createWebhookServer({
    getToken: () => webhookConfig.token,
    getSnapshot: () => publicSnapshot({ sources, metadata, organization }),
    execute: executeWebhook
  });
  await new Promise((resolve, reject) => {
    instance.once('error', reject);
    instance.listen(settings.port, settings.lan ? '0.0.0.0' : '127.0.0.1', () => {
      instance.removeListener('error', reject);
      resolve();
    });
  });
  webhookServer = instance;
  webhookRunning = true;
  webhookError = '';
  instance.on('error', (error) => {
    webhookRunning = false;
    webhookError = error.message;
    publish();
  });
  publish();
}

async function updateWebhookSettings(patch) {
  if (!patch || typeof patch !== 'object' ||
    (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') ||
    (patch.lan !== undefined && typeof patch.lan !== 'boolean') ||
    (patch.port !== undefined && (!Number.isInteger(patch.port) || patch.port < 1024 || patch.port > 65535))) {
    throw new Error('Use a port from 1024 to 65535 and valid on/off settings.');
  }
  const previous = { ...webhookConfig };
  const next = { ...previous, enabled: patch.enabled ?? previous.enabled, lan: patch.lan ?? previous.lan, port: patch.port ?? previous.port };
  if (previous.enabled === next.enabled && previous.lan === next.lan && previous.port === next.port && webhookRunning === next.enabled) return webhookStatus();
  await stopWebhook();
  try {
    await startWebhook(next);
    webhookConfig = next;
    saveWebhookConfig();
  } catch (error) {
    webhookError = error.message;
    webhookConfig = previous;
    try { await startWebhook(previous); } catch (restoreError) { webhookError = restoreError.message; }
    publish();
    throw new Error(`Could not start remote control: ${error.message}`);
  }
  publish();
  return webhookStatus();
}

function findTab(slotId) {
  for (const source of sources.values()) {
    const tab = source.tabs.find((item) => item.slotId === slotId);
    if (tab) return { source, tab };
  }
  return null;
}

function focusTab(sourceId, tabId) {
  const source = sources.get(sourceId);
  if (!source?.tabs.some((tab) => tab.id === tabId) || source.socket?.readyState !== WebSocket.OPEN) return false;
  source.socket.send(JSON.stringify({ type: 'focus', tabId }));
  return true;
}

function requiredTab(slotId) {
  const found = findTab(slotId);
  if (!found) throw new ApiError(404, 'tab_not_found', 'No open tab has that slotId.');
  return found;
}

function requiredFolder(id) {
  if (id !== 'unfiled' && !organization.folders.some((folder) => folder.id === id)) {
    throw new ApiError(404, 'folder_not_found', 'No folder has that folderId.');
  }
}

async function executeWebhook(command) {
  switch (command.action) {
    case 'focus_tab': {
      if (!focusTab(command.sourceId, command.tabId)) throw new ApiError(404, 'tab_not_found', 'No connected browser has that tab.');
      return { sourceId: command.sourceId, tabId: command.tabId, sent: true };
    }
    case 'set_metadata': {
      const { tab } = requiredTab(command.slotId);
      const patch = {};
      for (const field of ['watched', 'priority', 'tags']) if (Object.hasOwn(command, field)) patch[field] = command[field];
      updateMeta(metadataKey(tab.url), patch);
      return { tab: publicSnapshot({ sources, metadata, organization }).tabs.find((item) => item.slotId === command.slotId) };
    }
    case 'create_folder': {
      const folder = changeOrganization(() => createFolder(organization, command.name));
      if (!folder) throw new ApiError(409, 'folder_conflict', 'Folder name already exists or folder limit reached.');
      return { folder };
    }
    case 'rename_folder': {
      requiredFolder(command.folderId);
      if (command.folderId === 'unfiled') throw new ApiError(409, 'immutable_folder', 'Unfiled cannot be renamed.');
      if (!changeOrganization(() => renameFolder(organization, command.folderId, command.name))) throw new ApiError(409, 'folder_conflict', 'Folder name already exists.');
      return { folder: organization.folders.find((folder) => folder.id === command.folderId) };
    }
    case 'delete_folder': {
      requiredFolder(command.folderId);
      if (command.folderId === 'unfiled') throw new ApiError(409, 'immutable_folder', 'Unfiled cannot be deleted.');
      changeOrganization(() => deleteFolder(organization, command.folderId));
      return { folderId: command.folderId, movedTo: 'unfiled' };
    }
    case 'move_folder': {
      requiredFolder(command.folderId);
      if (command.folderId === 'unfiled') throw new ApiError(409, 'immutable_folder', 'Unfiled stays last.');
      if (command.beforeFolderId != null) requiredFolder(command.beforeFolderId);
      if (command.beforeFolderId === 'unfiled') throw new ApiError(409, 'immutable_folder', 'Use null to move a folder to the end.');
      if (command.folderId !== command.beforeFolderId) changeOrganization(() => moveFolder(organization, command.folderId, command.beforeFolderId));
      return { folderId: command.folderId, beforeFolderId: command.beforeFolderId ?? null };
    }
    case 'move_tab': {
      requiredTab(command.slotId);
      requiredFolder(command.folderId);
      if (command.beforeSlotId != null && !organization.order[command.folderId].includes(command.beforeSlotId)) {
        throw new ApiError(404, 'position_not_found', 'beforeSlotId is not in the destination folder.');
      }
      if (command.slotId !== command.beforeSlotId) changeOrganization(() => moveTab(organization, command.slotId, command.folderId, command.beforeSlotId));
      return { tab: publicSnapshot({ sources, metadata, organization }).tabs.find((tab) => tab.slotId === command.slotId) };
    }
    case 'show_view': {
      if (!window || window.isDestroyed()) throw new ApiError(409, 'window_unavailable', 'App window is unavailable.');
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      window.webContents.send('navigate-view', { type: command.view, value: command.view === 'tag' ? command.tag : undefined });
      return { view: command.view, ...(command.view === 'tag' ? { tag: command.tag } : {}) };
    }
  }
}

ipcMain.handle('get-state', () => state());
ipcMain.handle('get-webhook-secret', () => webhookConfig.token);
ipcMain.handle('set-webhook-settings', (_event, patch) => updateWebhookSettings(patch));
ipcMain.handle('rotate-webhook-secret', () => {
  webhookConfig.token = randomBytes(32).toString('hex');
  saveWebhookConfig();
  return webhookConfig.token;
});
ipcMain.handle('copy-text', (_event, text) => { if (typeof text === 'string' && text.length <= 4096) clipboard.writeText(text); });
ipcMain.handle('set-meta', (_event, key, patch) => updateMeta(key, patch));
ipcMain.handle('refresh-duration', (_event, url) => {
  if (typeof url !== 'string' || !youtubeVideoId(url)) return false;
  lookupDurations([{ url }], true);
  return true;
});
ipcMain.handle('create-folder', (_event, name, parentId) => changeOrganization(() => createFolder(organization, name, parentId || null)));
ipcMain.handle('rename-folder', (_event, id, name) => changeOrganization(() => renameFolder(organization, id, name)));
ipcMain.handle('delete-folder', (_event, id) => changeOrganization(() => deleteFolder(organization, id)));
ipcMain.handle('move-folder', (_event, id, beforeId) => changeOrganization(() => moveFolder(organization, id, beforeId)));
ipcMain.handle('move-tab', (_event, slotId, folderId, beforeId) => changeOrganization(() => moveTab(organization, slotId, folderId, beforeId)));
ipcMain.handle('export-list', async (_event, rows) => {
  if (!Array.isArray(rows) || rows.length > 2000) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: 'Export YouTube tabs',
    defaultPath: `youtube-tabs-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV file', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return false;
  await fs.promises.writeFile(filePath, makeCsv(rows), 'utf8');
  return true;
});
ipcMain.handle('focus-tab', (_event, sourceId, tabId) => Number.isInteger(tabId) && focusTab(sourceId, tabId));
ipcMain.handle('open-extension-folder', async () => {
  const folder = app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(app.getAppPath(), 'extension');
  return shell.openPath(folder);
});
ipcMain.handle('open-api-docs', () => shell.openPath(app.isPackaged
  ? path.join(process.resourcesPath, 'docs', 'REMOTE_API.md')
  : path.join(app.getAppPath(), 'docs', 'REMOTE_API.md')));

function createWindow() {
  window = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 850,
    minHeight: 600,
    backgroundColor: '#f8f9f7',
    title: 'YouTube Tab Desk',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged) {
    window.loadURL('http://127.0.0.1:5173');
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.on('window-all-closed', () => {
  server?.close();
  webhookServer?.close();
  app.quit();
});
