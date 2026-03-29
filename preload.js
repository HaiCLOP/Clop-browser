// ═══════════════════════════════════════════════════════════════════
//  CLOP / VOID BROWSER — Preload Script
//  Securely exposes IPC functions to the renderer via contextBridge.
//  No direct Node.js access in the renderer — contextIsolation ON.
// ═══════════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clop', {

  // ── Tab Operations ──
  newTab: (url) => ipcRenderer.invoke('tab:new', url),
  closeTab: (tabId) => ipcRenderer.invoke('tab:close', tabId),
  switchTab: (tabId) => ipcRenderer.invoke('tab:switch', tabId),
  getActiveTabInfo: () => ipcRenderer.invoke('tab:active-info'),

  // ── Navigation ──
  navigate: (url) => ipcRenderer.invoke('nav:go', url),
  goBack: () => ipcRenderer.invoke('nav:back'),
  goForward: () => ipcRenderer.invoke('nav:forward'),
  reload: () => ipcRenderer.invoke('nav:reload'),

  // ── Window Controls ──
  windowClose: () => ipcRenderer.send('window:close'),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),

  // ── Layout ──
  setAIPanelVisible: (visible) => ipcRenderer.send('layout:ai-panel', visible),

  // ── Renderer Ready ──
  rendererReady: () => ipcRenderer.invoke('renderer:ready'),

  // ── Bookmarks ──
  bookmarkAdd: (url, title) => ipcRenderer.invoke('bookmark:add', { url, title }),
  bookmarkRemove: (url) => ipcRenderer.invoke('bookmark:remove', url),
  bookmarkList: () => ipcRenderer.invoke('bookmark:list'),
  bookmarkCheck: (url) => ipcRenderer.invoke('bookmark:check', url),

  // ── History ──
  historyList: () => ipcRenderer.invoke('history:list'),
  historyClear: () => ipcRenderer.invoke('history:clear'),

  // ── Settings ──
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (settings) => ipcRenderer.invoke('settings:set', settings),

  // ── Find in Page ──
  findStart: (text) => ipcRenderer.invoke('find:start', text),
  findNext: (text, forward) => ipcRenderer.invoke('find:next', text, forward),
  findStop: () => ipcRenderer.invoke('find:stop'),

  // ── Zoom ──
  zoomIn: () => ipcRenderer.invoke('zoom:in'),
  zoomOut: () => ipcRenderer.invoke('zoom:out'),
  zoomReset: () => ipcRenderer.invoke('zoom:reset'),
  zoomGet: () => ipcRenderer.invoke('zoom:get'),

  // ── Page Actions ──
  pageSave: () => ipcRenderer.invoke('page:save'),
  pageDevTools: () => ipcRenderer.invoke('page:devtools'),
  forceDarkMode: () => ipcRenderer.invoke('darkmode:inject'),

  // ── Events from Main Process → Renderer ──

  onTabCreated: (callback) => {
    ipcRenderer.on('tab:created', (_event, data) => callback(data));
  },
  onTabUpdated: (callback) => {
    ipcRenderer.on('tab:updated', (_event, data) => callback(data));
  },
  onTabClosed: (callback) => {
    ipcRenderer.on('tab:closed', (_event, tabId) => callback(tabId));
  },
  onTabActivated: (callback) => {
    ipcRenderer.on('tab:activated', (_event, tabId) => callback(tabId));
  },
  onNavigationState: (callback) => {
    ipcRenderer.on('nav:state', (_event, data) => callback(data));
  },
  onTabLoading: (callback) => {
    ipcRenderer.on('tab:loading', (_event, data) => callback(data));
  },
  onTabCount: (callback) => {
    ipcRenderer.on('status:tabcount', (_event, count) => callback(count));
  },
  onMaximized: (callback) => {
    ipcRenderer.on('window:maximized', (_event, isMaximized) => callback(isMaximized));
  },
});
