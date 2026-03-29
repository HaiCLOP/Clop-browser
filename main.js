// ═══════════════════════════════════════════════════════════════════
//  CLOP / VOID BROWSER — Main Process
//  Handles: Window creation, WebContentsView management, Tab state,
//           IPC handlers, Navigation, Layout calculations,
//           Dark mode, Bookmarks, History, Settings, Find, Zoom
// ═══════════════════════════════════════════════════════════════════

const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  nativeTheme,
  dialog
} = require('electron');
const path = require('path');
const fs = require('fs');

// ── Force Dark Mode globally ──
nativeTheme.themeSource = 'dark';

// ── GPU Acceleration ──
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// ═══════════════════════════════════════════════════════════════════
//  PERSISTENT STORAGE (Bookmarks, History, Settings)
// ═══════════════════════════════════════════════════════════════════

const DATA_DIR = path.join(app.getPath('userData'), 'clop-data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJSON(filename, fallback = []) {
  try {
    const filepath = path.join(DATA_DIR, filename);
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch (e) { /* corrupt file, return fallback */ }
  return fallback;
}

function writeJSON(filename, data) {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
}

// Default settings
const DEFAULT_SETTINGS = {
  darkModeInjection: true,
  searchEngine: 'google',
  homepage: 'void://newtab',
  zoomLevel: 0,
};

function getSettings() {
  return readJSON('settings.json', DEFAULT_SETTINGS);
}

function saveSettings(settings) {
  writeJSON('settings.json', settings);
}

function getBookmarks() {
  return readJSON('bookmarks.json', []);
}

function saveBookmarks(bookmarks) {
  writeJSON('bookmarks.json', bookmarks);
}

function getHistory() {
  return readJSON('history.json', []);
}

function addHistory(entry) {
  const history = getHistory();
  history.unshift({
    url: entry.url,
    title: entry.title,
    timestamp: Date.now(),
  });
  // Keep last 500 entries
  if (history.length > 500) history.length = 500;
  writeJSON('history.json', history);
}

// ── Global State ──
let mainWindow = null;

/**
 * Tab state stored in the main process.
 * Map<string, { view, url, title, favicon, canGoBack, canGoForward, isNewTab, zoomLevel }>
 */
const tabs = new Map();
let activeTabId = null;
let tabIdCounter = 0;
let aiPanelVisible = true;

// ── Layout Constants (matching CSS) ──
const TITLEBAR_HEIGHT = 42;
const TOOLBAR_HEIGHT = 50;
const STATUSBAR_HEIGHT = 22;
const SIDEBAR_WIDTH = 52;
const AI_PANEL_WIDTH = 340;

// ── Dark mode CSS injection for sites that don't support prefers-color-scheme ──
const DARK_MODE_CSS = `
  @media (prefers-color-scheme: dark) {
    /* Already handled by site */
  }
  html {
    color-scheme: dark !important;
  }
  :root {
    color-scheme: dark !important;
  }
`;

// More aggressive fallback for pages that don't respect color-scheme
const FORCE_DARK_CSS = `
  html, body {
    background-color: #1a1a2e !important;
    color: #e0e0e0 !important;
  }
  a { color: #6db3f2 !important; }
  input, textarea, select, button {
    background-color: #252540 !important;
    color: #e0e0e0 !important;
    border-color: #3a3a5c !important;
  }
  img, video, canvas, svg, iframe { filter: none !important; }
  * {
    border-color: #3a3a5c !important;
    scrollbar-color: #3a3a5c #1a1a2e !important;
  }
`;

// ═══════════════════════════════════════════════════════════════════
//  WINDOW CREATION
// ═══════════════════════════════════════════════════════════════════

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#06060a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
    },
    show: false,
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('resize', () => {
    repositionActiveView();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  VIEW BOUNDS CALCULATION
// ═══════════════════════════════════════════════════════════════════

function getPageBounds() {
  if (!mainWindow) return { x: 0, y: 0, width: 800, height: 600 };

  const [winWidth, winHeight] = mainWindow.getContentSize();

  const x = SIDEBAR_WIDTH;
  const y = TITLEBAR_HEIGHT + TOOLBAR_HEIGHT;
  const aiWidth = aiPanelVisible ? AI_PANEL_WIDTH : 0;
  const width = winWidth - SIDEBAR_WIDTH - aiWidth;
  const height = winHeight - TITLEBAR_HEIGHT - TOOLBAR_HEIGHT - STATUSBAR_HEIGHT;

  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.max(100, width),
    height: Math.max(100, height)
  };
}

function repositionActiveView() {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  const tab = tabs.get(activeTabId);
  if (!tab.view || tab.isNewTab) return;
  const bounds = getPageBounds();
  tab.view.setBounds(bounds);
}

// ═══════════════════════════════════════════════════════════════════
//  TAB MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

function nextTabId() {
  return `tab-${++tabIdCounter}`;
}

function createTab(url = null, silent = false) {
  const tabId = nextTabId();
  const isNewTab = !url || url === 'void://newtab';

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      backgroundThrottling: true,
    }
  });

  // ── Web contents event listeners ──

  view.webContents.on('page-title-updated', (_event, title) => {
    const tab = tabs.get(tabId);
    if (tab) {
      tab.title = title;
      sendTabUpdate(tabId);
    }
  });

  view.webContents.on('page-favicon-updated', (_event, favicons) => {
    const tab = tabs.get(tabId);
    if (tab && favicons.length > 0) {
      tab.favicon = favicons[0];
      sendTabUpdate(tabId);
    }
  });

  view.webContents.on('did-navigate', (_event, navigatedUrl) => {
    updateNavState(tabId, navigatedUrl);
    // Add to history (skip void:// pages)
    if (!navigatedUrl.startsWith('void://')) {
      const tab = tabs.get(tabId);
      addHistory({ url: navigatedUrl, title: tab ? tab.title : '' });
    }
  });

  view.webContents.on('did-navigate-in-page', (_event, navigatedUrl) => {
    updateNavState(tabId, navigatedUrl);
  });

  // Inject dark mode CSS after page loads
  view.webContents.on('did-finish-load', () => {
    const settings = getSettings();
    if (settings.darkModeInjection) {
      view.webContents.insertCSS(DARK_MODE_CSS).catch(() => {});
    }
  });

  view.webContents.on('did-start-loading', () => {
    if (mainWindow) {
      mainWindow.webContents.send('tab:loading', { tabId, loading: true });
    }
  });

  view.webContents.on('did-stop-loading', () => {
    if (mainWindow) {
      mainWindow.webContents.send('tab:loading', { tabId, loading: false });
    }
  });

  // Handle new-window requests
  view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    createTab(openUrl);
    switchToTab(tabs.size > 0 ? Array.from(tabs.keys()).pop() : tabId);
    return { action: 'deny' };
  });

  const tabData = {
    view,
    url: url || 'void://newtab',
    title: isNewTab ? 'New Tab' : 'Loading...',
    favicon: null,
    canGoBack: false,
    canGoForward: false,
    isNewTab,
    zoomLevel: 0,
  };

  tabs.set(tabId, tabData);

  if (!isNewTab) {
    tabData.isNewTab = false;
    view.webContents.loadURL(url);
  }

  if (!silent && mainWindow) {
    mainWindow.webContents.send('tab:created', {
      tabId,
      title: tabData.title,
      url: tabData.url,
      favicon: tabData.favicon,
      isNewTab,
    });
  }

  if (!silent) {
    switchToTab(tabId);
  } else {
    activeTabId = tabId;
  }

  return tabId;
}

function switchToTab(tabId) {
  if (!tabs.has(tabId) || !mainWindow) return;

  if (activeTabId && tabs.has(activeTabId)) {
    const prevTab = tabs.get(activeTabId);
    if (prevTab.view && !prevTab.isNewTab) {
      try {
        mainWindow.contentView.removeChildView(prevTab.view);
      } catch (e) { }
      prevTab.view.webContents.setBackgroundThrottling(true);
    }
  }

  activeTabId = tabId;
  const tab = tabs.get(tabId);

  if (!tab.isNewTab && tab.view) {
    const bounds = getPageBounds();
    tab.view.setBounds(bounds);
    mainWindow.contentView.addChildView(tab.view);
    tab.view.webContents.setBackgroundThrottling(false);
  }

  mainWindow.webContents.send('tab:activated', tabId);
  sendNavState(tabId);
}

function closeTab(tabId) {
  if (!tabs.has(tabId)) return;

  const tab = tabs.get(tabId);

  if (tab.view && mainWindow) {
    try {
      mainWindow.contentView.removeChildView(tab.view);
    } catch (e) { }
    tab.view.webContents.close();
  }

  tabs.delete(tabId);

  if (mainWindow) {
    mainWindow.webContents.send('tab:closed', tabId);
  }

  if (activeTabId === tabId) {
    activeTabId = null;
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchToTab(remaining[remaining.length - 1]);
    } else {
      createTab();
    }
  }

  sendTabCount();
}

// ═══════════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════════

function parseUrlInput(input) {
  input = input.trim();
  if (/^https?:\/\//i.test(input)) return input;
  if (/^void:\/\//i.test(input)) return input;
  if (/^[^\s]+\.[^\s]+$/.test(input) && !input.includes(' ')) {
    return `https://${input}`;
  }
  // Use configured search engine
  const settings = getSettings();
  const engines = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q=',
  };
  const base = engines[settings.searchEngine] || engines.google;
  return `${base}${encodeURIComponent(input)}`;
}

function navigateActiveTab(rawUrl) {
  if (!activeTabId || !tabs.has(activeTabId)) return;

  const url = parseUrlInput(rawUrl);
  const tab = tabs.get(activeTabId);

  if (tab.isNewTab) {
    tab.isNewTab = false;
    const bounds = getPageBounds();
    tab.view.setBounds(bounds);
    mainWindow.contentView.addChildView(tab.view);
  }

  tab.url = url;
  tab.view.webContents.loadURL(url);
}

function updateNavState(tabId, url) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  tab.url = url;
  const nav = tab.view.webContents.navigationHistory;
  if (nav) {
    tab.canGoBack = nav.canGoBack();
    tab.canGoForward = nav.canGoForward();
  } else {
    tab.canGoBack = tab.view.webContents.canGoBack();
    tab.canGoForward = tab.view.webContents.canGoForward();
  }

  sendTabUpdate(tabId);
  if (tabId === activeTabId) {
    sendNavState(tabId);
  }
}

function sendNavState(tabId) {
  if (!mainWindow || !tabs.has(tabId)) return;
  const tab = tabs.get(tabId);
  mainWindow.webContents.send('nav:state', {
    tabId,
    url: tab.url,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isNewTab: tab.isNewTab,
  });
}

function sendTabUpdate(tabId) {
  if (!mainWindow || !tabs.has(tabId)) return;
  const tab = tabs.get(tabId);
  mainWindow.webContents.send('tab:updated', {
    tabId,
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon,
  });
}

function sendTabCount() {
  if (!mainWindow) return;
  mainWindow.webContents.send('status:tabcount', tabs.size);
}

// ═══════════════════════════════════════════════════════════════════
//  IPC HANDLERS
// ═══════════════════════════════════════════════════════════════════

function registerIPC() {

  // ── Tab Operations ──

  ipcMain.handle('tab:new', (_event, url) => {
    const tabId = createTab(url || null);
    sendTabCount();
    return tabId;
  });

  ipcMain.handle('tab:close', (_event, tabId) => {
    closeTab(tabId);
  });

  ipcMain.handle('tab:switch', (_event, tabId) => {
    switchToTab(tabId);
  });

  // ── Navigation ──

  ipcMain.handle('nav:go', (_event, url) => {
    navigateActiveTab(url);
  });

  ipcMain.handle('nav:back', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return;
    const tab = tabs.get(activeTabId);
    const nav = tab.view.webContents.navigationHistory;
    if (nav && nav.canGoBack()) {
      nav.goBack();
    }
  });

  ipcMain.handle('nav:forward', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return;
    const tab = tabs.get(activeTabId);
    const nav = tab.view.webContents.navigationHistory;
    if (nav && nav.canGoForward()) {
      nav.goForward();
    }
  });

  ipcMain.handle('nav:reload', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return;
    const tab = tabs.get(activeTabId);
    if (!tab.isNewTab) {
      tab.view.webContents.reload();
    }
  });

  // ── Window Controls ──

  ipcMain.on('window:close', () => {
    app.quit();
  });

  ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  // ── Layout ──

  ipcMain.on('layout:ai-panel', (_event, visible) => {
    aiPanelVisible = visible;
    repositionActiveView();
  });

  // ── Renderer Ready (pull-based) ──

  ipcMain.handle('renderer:ready', () => {
    if (tabs.size === 0) {
      createTab(null, true);
    }
    const allTabs = [];
    tabs.forEach((tab, tabId) => {
      allTabs.push({
        tabId,
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        isNewTab: tab.isNewTab,
      });
    });
    return { tabs: allTabs, activeTabId, count: tabs.size };
  });

  // ═══════════════════════════════════════════════════════════════
  //  BOOKMARKS
  // ═══════════════════════════════════════════════════════════════

  ipcMain.handle('bookmark:add', (_event, { url, title }) => {
    const bookmarks = getBookmarks();
    // Avoid duplicates
    if (!bookmarks.find(b => b.url === url)) {
      bookmarks.unshift({ url, title, timestamp: Date.now() });
      saveBookmarks(bookmarks);
    }
    return true;
  });

  ipcMain.handle('bookmark:remove', (_event, url) => {
    let bookmarks = getBookmarks();
    bookmarks = bookmarks.filter(b => b.url !== url);
    saveBookmarks(bookmarks);
    return true;
  });

  ipcMain.handle('bookmark:list', () => {
    return getBookmarks();
  });

  ipcMain.handle('bookmark:check', (_event, url) => {
    const bookmarks = getBookmarks();
    return !!bookmarks.find(b => b.url === url);
  });

  // ═══════════════════════════════════════════════════════════════
  //  HISTORY
  // ═══════════════════════════════════════════════════════════════

  ipcMain.handle('history:list', () => {
    return getHistory();
  });

  ipcMain.handle('history:clear', () => {
    writeJSON('history.json', []);
    return true;
  });

  // ═══════════════════════════════════════════════════════════════
  //  SETTINGS
  // ═══════════════════════════════════════════════════════════════

  ipcMain.handle('settings:get', () => {
    return getSettings();
  });

  ipcMain.handle('settings:set', (_event, newSettings) => {
    const current = getSettings();
    const merged = { ...current, ...newSettings };
    saveSettings(merged);
    return merged;
  });

  // ═══════════════════════════════════════════════════════════════
  //  FIND IN PAGE
  // ═══════════════════════════════════════════════════════════════

  ipcMain.handle('find:start', (_event, text) => {
    if (!activeTabId || !tabs.has(activeTabId)) return null;
    const tab = tabs.get(activeTabId);
    if (tab.isNewTab || !text) return null;

    return new Promise((resolve) => {
      tab.view.webContents.once('found-in-page', (_e, result) => {
        resolve({ matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal });
      });
      tab.view.webContents.findInPage(text);
    });
  });

  ipcMain.handle('find:next', (_event, text, forward) => {
    if (!activeTabId || !tabs.has(activeTabId)) return null;
    const tab = tabs.get(activeTabId);
    if (tab.isNewTab || !text) return null;

    return new Promise((resolve) => {
      tab.view.webContents.once('found-in-page', (_e, result) => {
        resolve({ matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal });
      });
      tab.view.webContents.findInPage(text, { forward, findNext: true });
    });
  });

  ipcMain.handle('find:stop', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return;
    const tab = tabs.get(activeTabId);
    if (!tab.isNewTab) {
      tab.view.webContents.stopFindInPage('clearSelection');
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  ZOOM
  // ═══════════════════════════════════════════════════════════════

  ipcMain.handle('zoom:in', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return 0;
    const tab = tabs.get(activeTabId);
    if (tab.isNewTab) return 0;
    const current = tab.view.webContents.getZoomLevel();
    const next = Math.min(current + 0.5, 5);
    tab.view.webContents.setZoomLevel(next);
    tab.zoomLevel = next;
    return next;
  });

  ipcMain.handle('zoom:out', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return 0;
    const tab = tabs.get(activeTabId);
    if (tab.isNewTab) return 0;
    const current = tab.view.webContents.getZoomLevel();
    const next = Math.max(current - 0.5, -5);
    tab.view.webContents.setZoomLevel(next);
    tab.zoomLevel = next;
    return next;
  });

  ipcMain.handle('zoom:reset', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return 0;
    const tab = tabs.get(activeTabId);
    if (!tab.isNewTab) {
      tab.view.webContents.setZoomLevel(0);
      tab.zoomLevel = 0;
    }
    return 0;
  });

  ipcMain.handle('zoom:get', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return 0;
    const tab = tabs.get(activeTabId);
    return tab.isNewTab ? 0 : tab.view.webContents.getZoomLevel();
  });

  // ═══════════════════════════════════════════════════════════════
  //  PAGE ACTIONS
  // ═══════════════════════════════════════════════════════════════

  ipcMain.handle('page:save', async () => {
    if (!activeTabId || !tabs.has(activeTabId) || !mainWindow) return false;
    const tab = tabs.get(activeTabId);
    if (tab.isNewTab) return false;

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Page',
      defaultPath: `${tab.title || 'page'}.html`,
      filters: [
        { name: 'HTML', extensions: ['html', 'htm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!canceled && filePath) {
      try {
        const html = await tab.view.webContents.executeJavaScript(
          'document.documentElement.outerHTML'
        );
        fs.writeFileSync(filePath, html, 'utf-8');
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  });

  ipcMain.handle('page:devtools', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return;
    const tab = tabs.get(activeTabId);
    if (!tab.isNewTab) {
      tab.view.webContents.toggleDevTools();
    }
  });

  // Force dark mode injection toggle
  ipcMain.handle('darkmode:inject', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return;
    const tab = tabs.get(activeTabId);
    if (!tab.isNewTab) {
      tab.view.webContents.insertCSS(FORCE_DARK_CSS).catch(() => {});
    }
  });

  // Get active tab info for bookmark/status
  ipcMain.handle('tab:active-info', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return null;
    const tab = tabs.get(activeTabId);
    return {
      tabId: activeTabId,
      url: tab.url,
      title: tab.title,
      isNewTab: tab.isNewTab,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
//  APP LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  ensureDataDir();
  registerIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
