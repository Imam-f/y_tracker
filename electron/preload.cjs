const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  getState: () => ipcRenderer.invoke('get-state'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  onWindowMaximized: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on('window-maximized', listener);
    return () => ipcRenderer.removeListener('window-maximized', listener);
  },
  getWebhookSecret: () => ipcRenderer.invoke('get-webhook-secret'),
  setWebhookSettings: (settings) => ipcRenderer.invoke('set-webhook-settings', settings),
  rotateWebhookSecret: () => ipcRenderer.invoke('rotate-webhook-secret'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  openApiDocs: () => ipcRenderer.invoke('open-api-docs'),
  onNavigateView: (callback) => {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on('navigate-view', listener);
    return () => ipcRenderer.removeListener('navigate-view', listener);
  },
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  setMeta: (key, patch) => ipcRenderer.invoke('set-meta', key, patch),
  refreshDuration: (url) => ipcRenderer.invoke('refresh-duration', url),
  createFolder: (name, parentId) => ipcRenderer.invoke('create-folder', name, parentId),
  renameFolder: (id, name) => ipcRenderer.invoke('rename-folder', id, name),
  deleteFolder: (id) => ipcRenderer.invoke('delete-folder', id),
  moveFolder: (id, beforeId) => ipcRenderer.invoke('move-folder', id, beforeId),
  moveTab: (slotId, folderId, beforeId) => ipcRenderer.invoke('move-tab', slotId, folderId, beforeId),
  moveTabs: (slotIds, folderId, beforeId) => ipcRenderer.invoke('move-tabs', slotIds, folderId, beforeId),
  exportList: (rows) => ipcRenderer.invoke('export-list', rows),
  focusTab: (sourceId, tabId) => ipcRenderer.invoke('focus-tab', sourceId, tabId),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder')
});
