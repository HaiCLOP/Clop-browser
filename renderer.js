// ═══════════════════════════════════════════════════════════════════
//  CLOP / VOID BROWSER — Renderer Script
//  Handles all UI interactions: tab chrome, URL bar, navigation
//  buttons, window controls, new-tab page, sidebar, toolbar,
//  find bar, zoom, bookmarks, history, settings, notes.
//  Communicates with main process through window.clop (preload API).
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── DOM References ──
  const tabsRow = document.getElementById('tabs-row');
  const newTabBtn = document.querySelector('.newtab');
  const urlbar = document.getElementById('urlbar');
  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnReload = document.getElementById('btn-reload');
  const urlReload = document.querySelector('.url-reload');
  const dotClose = document.getElementById('btn-close');
  const dotMin = document.getElementById('btn-min');
  const dotMax = document.getElementById('btn-max');
  const newtabPage = document.getElementById('newtab-page');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const statusTabCount = document.getElementById('status-tab-count');

  // New DOM references
  const btnBookmark = document.getElementById('btn-bookmark');
  const btnSave = document.getElementById('btn-save');
  const btnMenu = document.getElementById('btn-menu');
  const dropdownMenu = document.getElementById('dropdown-menu');
  const findbar = document.getElementById('findbar');
  const findInput = document.getElementById('find-input');
  const findCount = document.getElementById('find-count');
  const overlayPanel = document.getElementById('overlay-panel');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayContent = document.getElementById('overlay-content');
  const overlayClose = document.getElementById('overlay-close');
  const notesPad = document.getElementById('notes-pad');
  const notesTextarea = document.getElementById('notes-textarea');
  const notesClose = document.getElementById('notes-close');
  const zoomLevelEl = document.getElementById('zoom-level');
  const statusZoom = document.getElementById('status-zoom');

  // ── Internal State ──
  let activeTabId = null;
  const tabElements = new Map(); // tabId → DOM element
  let currentOverlay = null; // which overlay is open
  let menuOpen = false;

  // ═══════════════════════════════════════════════════════════════
  //  TAB DOM MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  function createTabElement(data) {
    const { tabId, title, favicon, isNewTab } = data;

    const tab = document.createElement('div');
    tab.className = 'tab active';
    tab.dataset.tabId = tabId;

    const faviconEl = document.createElement('img');
    faviconEl.className = 'tab-fav';
    faviconEl.src = favicon || '';
    faviconEl.style.display = favicon ? 'block' : 'none';
    faviconEl.width = 14;
    faviconEl.height = 14;
    faviconEl.onerror = () => { faviconEl.style.display = 'none'; };

    const titleEl = document.createElement('span');
    titleEl.className = 'tab-label';
    titleEl.textContent = title || 'New Tab';

    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-x';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.clop.closeTab(tabId);
    });

    tab.appendChild(faviconEl);
    tab.appendChild(titleEl);
    tab.appendChild(closeBtn);

    tab.addEventListener('click', () => {
      window.clop.switchTab(tabId);
    });

    // Insert before the "+" button
    tabsRow.insertBefore(tab, newTabBtn);
    tabElements.set(tabId, tab);

    // Deactivate others
    tabElements.forEach((el, id) => {
      el.classList.toggle('active', id === tabId);
    });
  }

  function updateTabElement(data) {
    const { tabId, title, url, favicon } = data;
    const el = tabElements.get(tabId);
    if (!el) return;

    const label = el.querySelector('.tab-label');
    if (label) label.textContent = title || url || 'New Tab';

    const fav = el.querySelector('.tab-fav');
    if (fav && favicon) {
      fav.src = favicon;
      fav.style.display = 'block';
    }
  }

  function removeTabElement(tabId) {
    const el = tabElements.get(tabId);
    if (el) {
      el.remove();
      tabElements.delete(tabId);
    }
  }

  function activateTab(tabId) {
    activeTabId = tabId;
    tabElements.forEach((el, id) => {
      el.classList.toggle('active', id === tabId);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  NAVIGATION UI
  // ═══════════════════════════════════════════════════════════════

  function updateNavUI(data) {
    const { url, canGoBack, canGoForward, isNewTab } = data;

    if (url !== undefined) {
      urlbar.value = url;
    }

    btnBack.classList.toggle('disabled', !canGoBack);
    btnForward.classList.toggle('disabled', !canGoForward);

    // Toggle new tab page
    if (newtabPage) {
      newtabPage.style.display = isNewTab ? 'flex' : 'none';
    }

    // Update lock icon
    const lockEl = document.querySelector('.url-lock');
    if (lockEl) {
      if (url && url.startsWith('https://')) {
        lockEl.textContent = '🔒';
        lockEl.style.opacity = '1';
      } else if (url && url.startsWith('http://')) {
        lockEl.textContent = '⚠';
        lockEl.style.opacity = '0.6';
      } else {
        lockEl.textContent = '◆';
        lockEl.style.opacity = '0.4';
      }
    }

    // Update bookmark button state
    updateBookmarkBtn(url);
  }

  // URL bar enter key
  urlbar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.clop.navigate(urlbar.value);
      urlbar.blur();
    }
  });

  // Select all on focus
  urlbar.addEventListener('focus', () => urlbar.select());

  // ── Navigation buttons ──
  btnBack.addEventListener('click', () => {
    if (!btnBack.classList.contains('disabled')) window.clop.goBack();
  });

  btnForward.addEventListener('click', () => {
    if (!btnForward.classList.contains('disabled')) window.clop.goForward();
  });

  btnReload.addEventListener('click', () => window.clop.reload());
  if (urlReload) urlReload.addEventListener('click', () => window.clop.reload());

  // ── New Tab button ──
  newTabBtn.addEventListener('click', () => window.clop.newTab());

  // ── Window controls ──
  dotClose.addEventListener('click', () => window.clop.windowClose());
  dotMin.addEventListener('click', () => window.clop.windowMinimize());
  dotMax.addEventListener('click', () => window.clop.windowMaximize());

  // ── Search input (new tab page) ──
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.clop.navigate(searchInput.value);
        searchInput.value = '';
      }
    });
  }
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      if (searchInput && searchInput.value.trim()) {
        window.clop.navigate(searchInput.value);
        searchInput.value = '';
      }
    });
  }

  // ── Quick links (new tab page) ──
  document.querySelectorAll('.qlink').forEach((link) => {
    link.addEventListener('click', () => {
      const url = link.dataset.url;
      if (url) window.clop.navigate(url);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  BOOKMARK BUTTON
  // ═══════════════════════════════════════════════════════════════

  async function updateBookmarkBtn(url) {
    if (!btnBookmark || !url || url.startsWith('void://')) {
      if (btnBookmark) btnBookmark.textContent = '☆ Bookmark';
      return;
    }
    try {
      const isBookmarked = await window.clop.bookmarkCheck(url);
      btnBookmark.textContent = isBookmarked ? '★ Bookmarked' : '☆ Bookmark';
      btnBookmark.style.color = isBookmarked ? 'var(--gold)' : '';
    } catch (e) {
      btnBookmark.textContent = '☆ Bookmark';
    }
  }

  if (btnBookmark) {
    btnBookmark.addEventListener('click', async () => {
      const info = await window.clop.getActiveTabInfo();
      if (!info || info.isNewTab) return;

      const isBookmarked = await window.clop.bookmarkCheck(info.url);
      if (isBookmarked) {
        await window.clop.bookmarkRemove(info.url);
        btnBookmark.textContent = '☆ Bookmark';
        btnBookmark.style.color = '';
      } else {
        await window.clop.bookmarkAdd(info.url, info.title);
        btnBookmark.textContent = '★ Bookmarked';
        btnBookmark.style.color = 'var(--gold)';
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  SAVE BUTTON
  // ═══════════════════════════════════════════════════════════════

  if (btnSave) {
    btnSave.addEventListener('click', () => {
      window.clop.pageSave();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  DROPDOWN MENU
  // ═══════════════════════════════════════════════════════════════

  function toggleMenu() {
    menuOpen = !menuOpen;
    if (dropdownMenu) dropdownMenu.style.display = menuOpen ? 'block' : 'none';
  }

  function closeMenu() {
    menuOpen = false;
    if (dropdownMenu) dropdownMenu.style.display = 'none';
  }

  if (btnMenu) {
    btnMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });
  }

  // Close menu on click outside
  document.addEventListener('click', (e) => {
    if (menuOpen && dropdownMenu && !dropdownMenu.contains(e.target) && e.target !== btnMenu) {
      closeMenu();
    }
  });

  // Menu items
  const dmZoomIn = document.getElementById('dm-zoom-in');
  const dmZoomOut = document.getElementById('dm-zoom-out');
  const dmZoomReset = document.getElementById('dm-zoom-reset');
  const dmFind = document.getElementById('dm-find');
  const dmDarkmode = document.getElementById('dm-darkmode');
  const dmDevtools = document.getElementById('dm-devtools');
  const dmSave = document.getElementById('dm-save');
  const dmAbout = document.getElementById('dm-about');

  if (dmZoomIn) dmZoomIn.addEventListener('click', () => { doZoom('in'); closeMenu(); });
  if (dmZoomOut) dmZoomOut.addEventListener('click', () => { doZoom('out'); closeMenu(); });
  if (dmZoomReset) dmZoomReset.addEventListener('click', () => { doZoom('reset'); closeMenu(); });
  if (dmFind) dmFind.addEventListener('click', () => { openFindBar(); closeMenu(); });
  if (dmDarkmode) dmDarkmode.addEventListener('click', () => { window.clop.forceDarkMode(); closeMenu(); });
  if (dmDevtools) dmDevtools.addEventListener('click', () => { window.clop.pageDevTools(); closeMenu(); });
  if (dmSave) dmSave.addEventListener('click', () => { window.clop.pageSave(); closeMenu(); });
  if (dmAbout) dmAbout.addEventListener('click', () => {
    closeMenu();
    alert('VOID Browser v0.1.0-alpha\nBuilt by HaiCLOP Labs\nPowered by Electron + Chromium');
  });

  // Title bar buttons
  const btnDownloadsTitle = document.getElementById('btn-downloads-title');
  const btnExtensions = document.getElementById('btn-extensions');

  if (btnDownloadsTitle) {
    btnDownloadsTitle.addEventListener('click', () => openOverlay('downloads'));
  }
  if (btnExtensions) {
    btnExtensions.addEventListener('click', () => {
      alert('Extensions support coming soon! 🚀');
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  FIND IN PAGE
  // ═══════════════════════════════════════════════════════════════

  function openFindBar() {
    if (findbar) {
      findbar.style.display = 'flex';
      findInput.value = '';
      findCount.textContent = '0/0';
      findInput.focus();
    }
  }

  function closeFindBar() {
    if (findbar) {
      findbar.style.display = 'none';
      findInput.value = '';
      findCount.textContent = '0/0';
      window.clop.findStop();
    }
  }

  if (findInput) {
    let findTimer = null;
    findInput.addEventListener('input', () => {
      clearTimeout(findTimer);
      findTimer = setTimeout(async () => {
        const text = findInput.value.trim();
        if (!text) {
          findCount.textContent = '0/0';
          window.clop.findStop();
          return;
        }
        const result = await window.clop.findStart(text);
        if (result) {
          findCount.textContent = `${result.activeMatchOrdinal}/${result.matches}`;
        }
      }, 200);
    });

    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doFindNext(!e.shiftKey);
      }
      if (e.key === 'Escape') {
        closeFindBar();
      }
    });
  }

  async function doFindNext(forward) {
    const text = findInput ? findInput.value.trim() : '';
    if (!text) return;
    const result = await window.clop.findNext(text, forward);
    if (result && findCount) {
      findCount.textContent = `${result.activeMatchOrdinal}/${result.matches}`;
    }
  }

  const findPrev = document.getElementById('find-prev');
  const findNext = document.getElementById('find-next');
  const findCloseBtn = document.getElementById('find-close');

  if (findPrev) findPrev.addEventListener('click', () => doFindNext(false));
  if (findNext) findNext.addEventListener('click', () => doFindNext(true));
  if (findCloseBtn) findCloseBtn.addEventListener('click', closeFindBar);

  // ═══════════════════════════════════════════════════════════════
  //  ZOOM
  // ═══════════════════════════════════════════════════════════════

  async function doZoom(action) {
    let level;
    if (action === 'in') level = await window.clop.zoomIn();
    else if (action === 'out') level = await window.clop.zoomOut();
    else level = await window.clop.zoomReset();

    updateZoomDisplay(level);
  }

  function updateZoomDisplay(level) {
    // Convert zoom level to percentage (level 0 = 100%, each step ≈ 20%)
    const pct = Math.round(100 * Math.pow(1.2, level));
    if (zoomLevelEl) zoomLevelEl.textContent = `${pct}%`;
    if (statusZoom) statusZoom.style.display = level !== 0 ? 'block' : 'none';
  }

  // ═══════════════════════════════════════════════════════════════
  //  SIDEBAR BUTTONS
  // ═══════════════════════════════════════════════════════════════

  const sbHome = document.getElementById('sb-home');
  const sbHistory = document.getElementById('sb-history');
  const sbBookmarks = document.getElementById('sb-bookmarks');
  const sbDownloads = document.getElementById('sb-downloads');
  const sbNotes = document.getElementById('sb-notes');
  const sbReader = document.getElementById('sb-reader');
  const sbSettings = document.getElementById('sb-settings');

  function setActiveSidebar(id) {
    document.querySelectorAll('.sb-icon').forEach(btn => btn.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  if (sbHome) {
    sbHome.addEventListener('click', () => {
      closeOverlayPanel();
      setActiveSidebar('sb-home');
      // Create new tab (home)
      window.clop.newTab();
    });
  }

  if (sbHistory) {
    sbHistory.addEventListener('click', () => {
      setActiveSidebar('sb-history');
      openOverlay('history');
    });
  }

  if (sbBookmarks) {
    sbBookmarks.addEventListener('click', () => {
      setActiveSidebar('sb-bookmarks');
      openOverlay('bookmarks');
    });
  }

  if (sbDownloads) {
    sbDownloads.addEventListener('click', () => {
      setActiveSidebar('sb-downloads');
      openOverlay('downloads');
    });
  }

  if (sbNotes) {
    sbNotes.addEventListener('click', () => {
      setActiveSidebar('sb-notes');
      toggleNotes();
    });
  }

  if (sbReader) {
    sbReader.addEventListener('click', () => {
      alert('Reader Mode coming soon! 📖');
    });
  }

  if (sbSettings) {
    sbSettings.addEventListener('click', () => {
      setActiveSidebar('sb-settings');
      openOverlay('settings');
    });
  }

  // Overlay close
  if (overlayClose) {
    overlayClose.addEventListener('click', () => {
      closeOverlayPanel();
      setActiveSidebar('sb-home');
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  OVERLAY PANELS
  // ═══════════════════════════════════════════════════════════════

  function closeOverlayPanel() {
    if (overlayPanel) overlayPanel.style.display = 'none';
    currentOverlay = null;
  }

  async function openOverlay(type) {
    if (currentOverlay === type) {
      closeOverlayPanel();
      setActiveSidebar('sb-home');
      return;
    }
    currentOverlay = type;

    if (type === 'history') {
      overlayTitle.textContent = 'HISTORY';
      await renderHistory();
    } else if (type === 'bookmarks') {
      overlayTitle.textContent = 'BOOKMARKS';
      await renderBookmarks();
    } else if (type === 'downloads') {
      overlayTitle.textContent = 'DOWNLOADS';
      renderDownloads();
    } else if (type === 'settings') {
      overlayTitle.textContent = 'SETTINGS';
      await renderSettings();
    }

    overlayPanel.style.display = 'flex';
  }

  async function renderHistory() {
    const history = await window.clop.historyList();
    if (!history || history.length === 0) {
      overlayContent.innerHTML = '<div class="overlay-empty">No browsing history yet.<br>Start exploring! 🌐</div>';
      return;
    }

    let html = `<div style="display:flex;justify-content:flex-end;padding:0 0 8px;">
      <button class="setting-btn danger" id="btn-clear-history">Clear All History</button>
    </div>`;

    // Group by date
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    history.slice(0, 100).forEach(item => {
      const d = new Date(item.timestamp);
      const dayStr = d.toDateString();
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const displayTitle = item.title || item.url || 'Untitled';
      const shortUrl = item.url.length > 40 ? item.url.substring(0, 40) + '…' : item.url;

      html += `<div class="overlay-item" data-url="${escapeHtml(item.url)}">
        <div>
          <div class="overlay-item-title">${escapeHtml(displayTitle)}</div>
          <div class="overlay-item-url">${escapeHtml(shortUrl)}</div>
        </div>
        <span class="overlay-item-time">${timeStr}</span>
      </div>`;
    });

    overlayContent.innerHTML = html;

    // Click to navigate
    overlayContent.querySelectorAll('.overlay-item[data-url]').forEach(el => {
      el.addEventListener('click', () => {
        window.clop.navigate(el.dataset.url);
        closeOverlayPanel();
        setActiveSidebar('sb-home');
      });
    });

    const clearBtn = document.getElementById('btn-clear-history');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        await window.clop.historyClear();
        overlayContent.innerHTML = '<div class="overlay-empty">History cleared! 🧹</div>';
      });
    }
  }

  async function renderBookmarks() {
    const bookmarks = await window.clop.bookmarkList();
    if (!bookmarks || bookmarks.length === 0) {
      overlayContent.innerHTML = '<div class="overlay-empty">No bookmarks yet.<br>Click ☆ Bookmark to save pages! ⭐</div>';
      return;
    }

    let html = '';
    bookmarks.forEach(item => {
      const displayTitle = item.title || item.url || 'Untitled';
      const shortUrl = item.url.length > 40 ? item.url.substring(0, 40) + '…' : item.url;

      html += `<div class="overlay-item" data-url="${escapeHtml(item.url)}">
        <div>
          <div class="overlay-item-title">⭐ ${escapeHtml(displayTitle)}</div>
          <div class="overlay-item-url">${escapeHtml(shortUrl)}</div>
        </div>
        <div class="overlay-item-actions">
          <button class="bk-remove" data-url="${escapeHtml(item.url)}" title="Remove">✕</button>
        </div>
      </div>`;
    });

    overlayContent.innerHTML = html;

    // Click to navigate
    overlayContent.querySelectorAll('.overlay-item[data-url]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('bk-remove')) return;
        window.clop.navigate(el.dataset.url);
        closeOverlayPanel();
        setActiveSidebar('sb-home');
      });
    });

    // Remove bookmark buttons
    overlayContent.querySelectorAll('.bk-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.clop.bookmarkRemove(btn.dataset.url);
        await renderBookmarks();
      });
    });
  }

  function renderDownloads() {
    overlayContent.innerHTML = '<div class="overlay-empty">Downloads will appear here.<br>Save a page with ⬇ Save! 📥</div>';
  }

  async function renderSettings() {
    const settings = await window.clop.settingsGet();

    overlayContent.innerHTML = `
      <div class="overlay-section-title">APPEARANCE</div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Dark Mode Injection</div>
          <div class="setting-desc">Force dark theme on websites</div>
        </div>
        <button class="toggle-switch ${settings.darkModeInjection ? 'on' : ''}" id="set-darkmode"></button>
      </div>

      <div class="overlay-section-title">SEARCH</div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Search Engine</div>
          <div class="setting-desc">Default search provider</div>
        </div>
        <select class="setting-select" id="set-search-engine">
          <option value="google" ${settings.searchEngine === 'google' ? 'selected' : ''}>Google</option>
          <option value="duckduckgo" ${settings.searchEngine === 'duckduckgo' ? 'selected' : ''}>DuckDuckGo</option>
          <option value="bing" ${settings.searchEngine === 'bing' ? 'selected' : ''}>Bing</option>
        </select>
      </div>

      <div class="overlay-section-title">DATA</div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Clear Browsing History</div>
          <div class="setting-desc">Remove all history entries</div>
        </div>
        <button class="setting-btn danger" id="set-clear-history">Clear</button>
      </div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Clear All Bookmarks</div>
          <div class="setting-desc">Remove all saved bookmarks</div>
        </div>
        <button class="setting-btn danger" id="set-clear-bookmarks">Clear</button>
      </div>

      <div class="overlay-section-title">ABOUT</div>
      <div class="setting-row">
        <div>
          <div class="setting-label" style="color:var(--acid)">VOID Browser</div>
          <div class="setting-desc">v0.1.0-alpha · Built by HaiCLOP Labs</div>
          <div class="setting-desc">Electron + Chromium · ${navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || 'N/A'}</div>
        </div>
      </div>
    `;

    // Dark mode toggle
    const darkToggle = document.getElementById('set-darkmode');
    if (darkToggle) {
      darkToggle.addEventListener('click', async () => {
        const cur = await window.clop.settingsGet();
        const newVal = !cur.darkModeInjection;
        await window.clop.settingsSet({ darkModeInjection: newVal });
        darkToggle.classList.toggle('on', newVal);
      });
    }

    // Search engine
    const searchSelect = document.getElementById('set-search-engine');
    if (searchSelect) {
      searchSelect.addEventListener('change', async () => {
        await window.clop.settingsSet({ searchEngine: searchSelect.value });
      });
    }

    // Clear history
    const clearHist = document.getElementById('set-clear-history');
    if (clearHist) {
      clearHist.addEventListener('click', async () => {
        await window.clop.historyClear();
        clearHist.textContent = 'Cleared ✓';
        clearHist.disabled = true;
      });
    }

    // Clear bookmarks
    const clearBk = document.getElementById('set-clear-bookmarks');
    if (clearBk) {
      clearBk.addEventListener('click', async () => {
        // Remove all bookmarks
        const bks = await window.clop.bookmarkList();
        for (const b of bks) {
          await window.clop.bookmarkRemove(b.url);
        }
        clearBk.textContent = 'Cleared ✓';
        clearBk.disabled = true;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  NOTES
  // ═══════════════════════════════════════════════════════════════

  function toggleNotes() {
    const isOpen = notesPad.style.display === 'flex';
    notesPad.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) {
      // Load saved notes
      const saved = localStorage.getItem('void-notes') || '';
      notesTextarea.value = saved;
      notesTextarea.focus();
    }
  }

  if (notesTextarea) {
    notesTextarea.addEventListener('input', () => {
      localStorage.setItem('void-notes', notesTextarea.value);
    });
  }

  if (notesClose) {
    notesClose.addEventListener('click', () => {
      notesPad.style.display = 'none';
      setActiveSidebar('sb-home');
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  KEYBOARD SHORTCUTS
  // ═══════════════════════════════════════════════════════════════

  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+T → new tab
    if (ctrl && e.key === 't') {
      e.preventDefault();
      window.clop.newTab();
    }

    // Ctrl+W → close tab
    if (ctrl && e.key === 'w') {
      e.preventDefault();
      if (activeTabId) window.clop.closeTab(activeTabId);
    }

    // Ctrl+L → focus URL bar
    if (ctrl && e.key === 'l') {
      e.preventDefault();
      urlbar.focus();
      urlbar.select();
    }

    // Ctrl+F → find
    if (ctrl && e.key === 'f') {
      e.preventDefault();
      openFindBar();
    }

    // Escape → close find bar / overlay
    if (e.key === 'Escape') {
      if (findbar && findbar.style.display !== 'none') {
        closeFindBar();
      }
      if (currentOverlay) {
        closeOverlayPanel();
        setActiveSidebar('sb-home');
      }
      if (menuOpen) closeMenu();
    }

    // Ctrl+Plus → zoom in
    if (ctrl && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      doZoom('in');
    }

    // Ctrl+Minus → zoom out
    if (ctrl && e.key === '-') {
      e.preventDefault();
      doZoom('out');
    }

    // Ctrl+0 → reset zoom
    if (ctrl && e.key === '0') {
      e.preventDefault();
      doZoom('reset');
    }

    // F12 → DevTools
    if (e.key === 'F12') {
      e.preventDefault();
      window.clop.pageDevTools();
    }

    // Ctrl+R → reload
    if (ctrl && e.key === 'r') {
      e.preventDefault();
      window.clop.reload();
    }

    // Ctrl+D → bookmark
    if (ctrl && e.key === 'd') {
      e.preventDefault();
      if (btnBookmark) btnBookmark.click();
    }

    // Ctrl+S → save page
    if (ctrl && e.key === 's') {
      e.preventDefault();
      window.clop.pageSave();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  UTILITY
  // ═══════════════════════════════════════════════════════════════

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ═══════════════════════════════════════════════════════════════
  //  IPC EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════════

  // Tab created (push from main after initial hydration)
  window.clop.onTabCreated((data) => {
    createTabElement(data);
  });

  // Tab updated
  window.clop.onTabUpdated((data) => {
    updateTabElement(data);
  });

  // Tab closed
  window.clop.onTabClosed((tabId) => {
    removeTabElement(tabId);
  });

  // Tab activated
  window.clop.onTabActivated((tabId) => {
    activateTab(tabId);
  });

  // Navigation state
  window.clop.onNavigationState((data) => {
    updateNavUI(data);
  });

  // Loading state
  window.clop.onTabLoading(({ tabId, loading }) => {
    const el = tabElements.get(tabId);
    if (el) el.classList.toggle('loading', loading);

    if (tabId === activeTabId) {
      btnReload.textContent = loading ? '✕' : '↻';
    }
  });

  // Tab count
  window.clop.onTabCount((count) => {
    if (statusTabCount) {
      statusTabCount.textContent = `${count} tab${count !== 1 ? 's' : ''} open`;
    }
  });

  // Window maximize state
  window.clop.onMaximized((isMaximized) => {
    const maxDot = document.getElementById('btn-max');
    if (maxDot) {
      maxDot.style.background = isMaximized ? '#4a9' : '#e5bf3c';
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  PULL-BASED HYDRATION (on startup)
  // ═══════════════════════════════════════════════════════════════

  window.clop.rendererReady().then((state) => {
    if (!state) return;

    const { tabs: allTabs, activeTabId: mainActiveId, count } = state;

    // Create tab elements from state
    allTabs.forEach((tabData) => {
      createTabElement(tabData);
    });

    // Activate the correct tab
    if (mainActiveId) {
      activateTab(mainActiveId);
      activeTabId = mainActiveId;

      // Find the active tab and update nav
      const active = allTabs.find(t => t.tabId === mainActiveId);
      if (active) {
        updateNavUI({
          url: active.url,
          canGoBack: false,
          canGoForward: false,
          isNewTab: active.isNewTab,
        });
      }
    }

    // Update status
    if (statusTabCount) {
      statusTabCount.textContent = `${count} tab${count !== 1 ? 's' : ''} open`;
    }
  });

})();
