import { st } from './state';
import { appConfig, matchHotkey, SESSION_KEY, CFG_PATH, applyConfig } from './config';
import { saveHandleToIDB, loadHandleFromIDB } from './idb';
import { loadConfig, loadCustomCss, loadPlugin, readFile, writeFile } from './fs';
import { WebDAVBackend } from './backend';
import { FSABackend } from './fsa';
import { buildLinkIndex, loadTags } from './links';
import { initEditor } from './editor';
import {
  applySidebarState, toggleSidebar, updateSidebarVar, mobileQuery,
  switchToPreview, switchToEdit, saveCurrentFile,
  showWelcomePage, showNewItemPanel, showDeletePanel, startInlineRename,
  settingsOpen, settingsClose, clearFileView,
  setDirty, showFolderPreview,
} from './ui';

// ===== Editor init =====
initEditor();
st.cmEditor.getWrapperElement().style.display = 'none';
st.cmEditor.getWrapperElement().addEventListener('click', () => st.cmEditor.focus());
let _mousedownInContent = false;
document.addEventListener('mousedown', (e) => {
  _mousedownInContent = !!(e.target as Element).closest('#content');
  const fileList = document.getElementById('fileList');
  if (!fileList) return;
  if (_mousedownInContent) fileList.classList.add('editor-focused');
  else fileList.classList.remove('editor-focused');
});
st.cmEditor.on('blur', () => {
  if (!_mousedownInContent) document.getElementById('fileList')?.classList.remove('editor-focused');
});
document.getElementById('preview')!.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  (e.currentTarget as HTMLElement).blur();
  const fileListEl = document.getElementById('fileList')!;
  fileListEl.classList.remove('editor-focused');
  fileListEl.classList.add('keyboard-nav');
  const active = fileListEl.querySelector<HTMLElement>('li.active');
  if (active) { active.classList.add('nav-focus'); active.scrollIntoView({ block: 'nearest' }); }
});
st.cmEditor.on('keydown', (_cm: any, e: KeyboardEvent) => {
  if (e.key !== 'ArrowLeft') return;
  const cur = _cm.getCursor?.();
  if (!cur || (cur.line === 0 && cur.ch === 0)) {
    e.preventDefault();
    e.stopPropagation();
    _cm.getInputField?.()?.blur();
    const fileListEl = document.getElementById('fileList');
    fileListEl?.classList.remove('editor-focused');
    fileListEl?.classList.add('keyboard-nav');
    const active = fileListEl?.querySelector<HTMLElement>('li.active');
    if (active) { active.classList.add('nav-focus'); active.scrollIntoView({ block: 'nearest' }); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' && e.key !== 'ArrowLeft') return;
  const searchWrap = document.getElementById('search-wrap');
  if (!searchWrap?.classList.contains('search-active')) return;
  const focused = document.activeElement;
  if (focused === document.getElementById('searchInput')) return;
  if (focused?.closest('#sidebar')) return;
  if (e.key === 'ArrowLeft') {
    if (st.isEditing) {
      const cur = st.cmEditor.getCursor?.();
      if (cur != null) {
        if (!(cur.line === 0 && cur.ch === 0)) return;
      } else {
        const ta = document.getElementById('editor') as HTMLTextAreaElement | null;
        if (ta && ta.selectionStart !== 0) return;
      }
    } else {
      const preview = document.getElementById('preview');
      if (preview && preview.scrollTop > 0) return;
    }
  }
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('searchInput')?.focus();
}, true);
st.cmEditor.on('change', (_cm: any, change: any) => {
  if (!st.currentFile || change.origin === 'setValue') return;
  setDirty(true);
  clearTimeout(st.autosaveTimer);
  st.autosaveTimer = setTimeout(saveCurrentFile, appConfig.autosaveDelay * 1000);
});

// ===== Plugin API =====
const _fileOpenHooks: Array<(path: string, content: string) => boolean | Promise<boolean>> = [];

(window as any).tinAPI = {
  readConfig: async () => readFile(CFG_PATH),
  writeConfig: async (content: string) => {
    await writeFile(CFG_PATH, content);
    st.fileContentCache.set(CFG_PATH, content);
    try { applyConfig(JSON.parse(content)); } catch {}
  },
  readFile,
  writeFile,
  getDefaultConfig: () => ({ ...appConfig }),
  setSort: (by: string, order: string) => {
    st.sortBy = by;
    st.sortOrder = order;
    (window as any).loadDirectory(st.currentDir);
  },
  get rootHandle() { return st.rootHandle; },
  onFileOpen(cb: (path: string, content: string) => boolean | Promise<boolean>) {
    _fileOpenHooks.push(cb);
  },
  setPreview(html: string) {
    const preview = document.getElementById('preview')!;
    preview.innerHTML = html;
    preview.style.display = '';
    document.getElementById('backlinks')!.style.display = 'none';
    st.cmEditor.getWrapperElement().style.display = 'none';
    document.getElementById('editBtn')!.style.display = 'none';
    document.getElementById('content')!.classList.remove('edit-mode');
    st.isEditing = false;
  },
  _fileOpenHooks,
};

// ===== Keyboard shortcuts =====
document.addEventListener('keydown', async (e) => {
  const hk = appConfig.hotkeys;
  if (matchHotkey(e, hk.save)) {
    e.preventDefault();
    if (st.isEditing) saveCurrentFile();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
    e.preventDefault();
    toggleSidebar();
  }
  if (matchHotkey(e, hk.sidebar)) {
    e.preventDefault();
    toggleSidebar();
  }
  if (matchHotkey(e, hk.togglePreview)) {
    e.preventDefault();
    if (st.currentFile && (st.currentFile.endsWith('.md') || st.currentFile.endsWith('.html') || st.currentFile.endsWith('.htm'))) {
      if (st.isEditing) switchToPreview();
      else switchToEdit();
    }
  }
  if (matchHotkey(e, hk.open)) {
    e.preventDefault();
    openOrRestoreWorkspace(true);
  }
  if (matchHotkey(e, hk.newItem)) {
    e.preventDefault();
    if (st.backend) showNewItemPanel(st.currentDir, true);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    const focused = document.querySelector<HTMLElement>('#fileList li.nav-focus[data-path]');
    if (focused?.dataset.path && focused.dataset.type === 'file') {
      startInlineRename(focused, focused.dataset.path);
    }
  }
  if (matchHotkey(e, (hk as any).settings)) {
    e.preventDefault();
    if (st.backend) settingsOpen();
  }
  if (e.key === 'Escape') {
    if (st.settingsActive) { settingsClose(); return; }
    if (!st.currentDir && !st.currentFile && !st.cmEditor.hasFocus()) showWelcomePage();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
    e.preventDefault();
    document.getElementById('grid-overlay')?.classList.toggle('visible');
  }

  // File list arrow key navigation
  if (document.activeElement?.id === 'preview') return;
  const _vjkl: Record<string, string> = { h: 'ArrowLeft', j: 'ArrowDown', k: 'ArrowUp', l: 'ArrowRight' };
  const _navKey = _vjkl[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey ? _vjkl[e.key] : e.key;
  if (_navKey === 'ArrowUp' || _navKey === 'ArrowDown' || _navKey === 'ArrowRight' || _navKey === 'ArrowLeft' || (_navKey === 'Enter' && !e.metaKey && !e.ctrlKey) || _navKey === 'Backspace') {
    const active = document.activeElement;
    const tag = active?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (active as HTMLElement)?.classList?.contains('CodeMirror-focused')) return;
    if (st.cmEditor.hasFocus()) return;
    const fileListEl2 = document.getElementById('fileList')!;
    const bcHome = document.querySelector<HTMLElement>('#breadcrumb a.bc-current, #breadcrumb span.bc-current');
    const bcLinks = Array.from(document.querySelectorAll<HTMLElement>('#breadcrumb a:not(.bc-current)'));
    const fileItems = Array.from(document.querySelectorAll<HTMLElement>('#fileList li[data-path], #fileList li[data-dir], #fileList li[data-new-item]'));
    const items: HTMLElement[] = [...bcLinks, ...(bcHome ? [bcHome] : []), ...fileItems];
    if (!items.length) return;
    const currentIdx = items.findIndex(el => el.classList.contains('nav-focus'));
    const bcHomeIdx = bcHome ? bcLinks.length : -1;

    function navFocusItem(idx: number) {
      items.forEach(el => el.classList.remove('nav-focus'));
      document.querySelectorAll<HTMLElement>('#breadcrumb .nav-focus').forEach(el => el.classList.remove('nav-focus'));
      items[idx].classList.add('nav-focus');
      items[idx].scrollIntoView?.({ block: 'nearest' });
      fileListEl2.classList.toggle('bc-focused', idx <= bcHomeIdx);
      if (items[idx] === bcHome) {
        if (!st.settingsActive) showWelcomePage();
      } else if ((items[idx] as any).dataset.newItem) {
        if (st.settingsActive) { st.settingsActive = false; fileListEl2.classList.remove('settings-active'); const _bc = document.getElementById('breadcrumb'); if (_bc && st.settingsPrevBreadcrumb) { _bc.innerHTML = st.settingsPrevBreadcrumb; _bc.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus')); st.settingsPrevBreadcrumb = ''; } }
        showNewItemPanel((items[idx] as any).__newItemDir ?? st.currentDir);
      } else if (items[idx].dataset.type === 'directory') {
        if (st.settingsActive) { st.settingsActive = false; fileListEl2.classList.remove('settings-active'); const _bc = document.getElementById('breadcrumb'); if (_bc && st.settingsPrevBreadcrumb) { _bc.innerHTML = st.settingsPrevBreadcrumb; _bc.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus')); st.settingsPrevBreadcrumb = ''; } }
        st.currentFile = null;
        document.getElementById('backlinks')!.style.display = 'none';
        st.cmEditor.getWrapperElement().style.display = 'none';
        document.getElementById('preview')!.style.display = '';
        document.getElementById('content')!.classList.remove('edit-mode');
        document.querySelectorAll('.file-list li').forEach(li => li.classList.remove('active'));
        setDirty(false);
        showFolderPreview(items[idx].dataset.path!);
      } else if (items[idx].dataset.path) {
        if (st.settingsActive) { st.settingsActive = false; fileListEl2.classList.remove('settings-active'); const _bc = document.getElementById('breadcrumb'); if (_bc && st.settingsPrevBreadcrumb) { _bc.innerHTML = st.settingsPrevBreadcrumb; _bc.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus')); st.settingsPrevBreadcrumb = ''; } }
        (window as any).loadFile(items[idx].dataset.path!);
      }
    }

    if (_navKey === 'ArrowUp' || _navKey === 'ArrowDown') {
      e.preventDefault();
      fileListEl2.classList.add('keyboard-nav');
      const firstFileIdx = bcHomeIdx >= 0 ? bcHomeIdx + 1 : 0;
      if (_navKey === 'ArrowUp' && currentIdx === 0) {
        navFocusItem(items.length - 1);
        return;
      }
      const next = _navKey === 'ArrowDown'
        ? (currentIdx === -1 ? firstFileIdx : currentIdx < items.length - 1 ? currentIdx + 1 : 0)
        : (currentIdx === -1 ? firstFileIdx : currentIdx > 0 ? currentIdx - 1 : items.length - 1);
      navFocusItem(next);
    } else if ((_navKey === 'Enter' || _navKey === 'ArrowRight') && currentIdx >= 0) {
      e.preventDefault();
      const focused = items[currentIdx];
      if (bcLinks.includes(focused)) {
        focused.click();
      } else if (focused === bcHome) {
        const sidebarSearch = document.getElementById('searchInput') as HTMLInputElement | null;
        if (sidebarSearch) { (document.getElementById('search-wrap') as any)?.classList.add('search-active'); sidebarSearch.focus(); }
        return;
      } else if ((focused as any).dataset.newItem) {
        focused.click();
      } else if (focused.dataset.type === 'directory') {
        st.autoFocusFirstOnLoad = true;
        focused.click();
      } else if (focused.dataset.path) {
        document.getElementById('fileList')!.classList.remove('keyboard-nav');
        document.getElementById('fileList')!.classList.add('editor-focused');
        if (st.isEditing) st.cmEditor.focus();
        else document.getElementById('preview')!.focus();
      }
    } else if (_navKey === 'ArrowLeft') {
      e.preventDefault();
      if (st.settingsActive) { settingsClose(); return; }
      if (currentIdx >= 0 && currentIdx < bcHomeIdx) {
        bcLinks[currentIdx].click();
        return;
      }
      function focusBcCurrentAfterLoad() {
        const bc2 = document.querySelector<HTMLElement>('#breadcrumb a.bc-current, #breadcrumb span.bc-current');
        const fl2 = document.getElementById('fileList');
        if (bc2) { fl2?.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus')); bc2.classList.add('nav-focus'); fl2?.classList.add('keyboard-nav', 'bc-focused'); }
      }
      if (st.currentDir) {
        const parent = st.currentDir.includes('/') ? st.currentDir.split('/').slice(0, -1).join('/') : '';
        if (parent === '') {
          (window as any).loadDirectory(parent).then(() => { focusBcCurrentAfterLoad(); showWelcomePage(); });
        } else {
          (window as any).loadDirectory(parent).then(focusBcCurrentAfterLoad);
        }
        clearFileView();
      } else if (currentIdx === 0 && bcHome) {
        document.getElementById('app')!.style.display = 'none';
        document.getElementById('workspace-picker')!.style.display = 'flex';
      } else {
        items.forEach(el => el.classList.remove('nav-focus'));
        if (bcHome) { bcHome.classList.add('nav-focus'); showWelcomePage(); }
      }
    } else if (_navKey === 'Backspace') {
      const focused2 = currentIdx >= 0 ? items[currentIdx] : null;
      if (focused2 === bcHome) return;
      const target = focused2 || document.querySelector<HTMLElement>('#fileList li.active');
      if (!target || (target as any).dataset.newItem) return;
      e.preventDefault();
      showDeletePanel(target.dataset.path!, target.dataset.type === 'directory');
    }
  }
});

// ===== Workspace =====
async function initialize() {
  document.getElementById('workspace-picker')!.style.display = 'none';
  document.getElementById('app')!.style.display = 'flex';
  updateSidebarVar();
  await loadConfig();
  loadCustomCss();
  loadPlugin();
  buildLinkIndex().then(() => loadTags());

  if (st.rootHandle && 'FileSystemObserver' in window) {
    try {
      let dirObserverTimer: any = null;
      let pendingChangedPaths: Set<string> = new Set();
      const dirObserver = new (window as any).FileSystemObserver((records: any[]) => {
        for (const r of records) {
          const parts: string[] = r.relativePathComponents ?? [];
          const p = parts.join('/');
          console.log('[FileSystemObserver] changed:', p, 'type:', r.type);
          pendingChangedPaths.add(p);
        }
        clearTimeout(dirObserverTimer);
        dirObserverTimer = setTimeout(() => {
          const changed = pendingChangedPaths;
          pendingChangedPaths = new Set();
          onVaultChanged(changed);
        }, 400);
      });
      await dirObserver.observe(st.rootHandle, { recursive: true });
    } catch {}
  }

  await (window as any).loadDirectory('');

  try {
    const hash = location.hash ? decodeURIComponent(location.hash.slice(1)) : null;
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    const file = hash || session?.file;
    if (session?.dir) await (window as any).loadDirectory(session.dir);
    if (file) {
      await (window as any).loadFile(file);
      if (!hash && session.editing) document.getElementById('editBtn')!.click();
    } else {
      showWelcomePage();
    }
  } catch { showWelcomePage(); }

  if (appConfig.autoIndex) {
    (async () => {
      for (const f of st.allFilesMeta) {
        if (f.path.endsWith('.md') && !st.fileContentCache.has(f.path)) {
          try {
            const h = st.backend?.pathHandleMap?.get(f.path);
            if (h) {
              st.fileContentCache.set(f.path, await (await h.getFile()).text());
            } else if (st.backend && !st.backend.getFileHandle) {
              // WebDAV mode: read via backend
              st.fileContentCache.set(f.path, await st.backend.readFile(f.path));
            }
          } catch {}
        }
      }
    })();
  }
}

async function openOrRestoreWorkspace(forceNew = false) {
  if (!forceNew) {
    try {
      const saved = await loadHandleFromIDB();
      if (saved) {
        let perm: string;
        try {
          perm = await saved.requestPermission({ mode: 'readwrite' });
        } catch {
          perm = await saved.queryPermission({ mode: 'readwrite' });
        }
        if (perm === 'granted') {
          st.rootHandle = saved;
          st.backend = new FSABackend(saved);
          await initialize();
          return;
        }
        if (perm === 'prompt') {
          st.savedHandleForResume = saved;
          document.getElementById('picker-msg')!.textContent = '';
          return;
        }
      }
    } catch {}
    return;
  }
  try {
    st.rootHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    st.backend = new FSABackend(st.rootHandle);
    await saveHandleToIDB(st.rootHandle);
    await initialize();
  } catch (e: any) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

// Expose for use from ui.ts (star button)
(window as any).openOrRestoreWorkspace = openOrRestoreWorkspace;

document.getElementById('workspace-picker')!.onclick = async () => {
  if (st.savedHandleForResume) {
    try {
      const perm = await st.savedHandleForResume.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        st.rootHandle = st.savedHandleForResume;
        st.backend = new FSABackend(st.rootHandle);
        st.savedHandleForResume = null;
        await initialize();
        return;
      }
    } catch {}
    st.savedHandleForResume = null;
  }
  openOrRestoreWorkspace(true);
};

document.getElementById('picker-change-btn')!.addEventListener('click', (e) => {
  e.stopPropagation();
  st.savedHandleForResume = null;
  openOrRestoreWorkspace(true);
});

// ===== Vault change handler (called by FileSystemObserver and SSE) =====
async function onVaultChanged(changedPaths?: Set<string>) {
  if (st.isSaving) return;
  const scrollables = ['app', 'main', 'content', 'editor', 'preview'];
  const scrollSnapshot: Record<string, number> = {};
  scrollables.forEach(id => {
    const el = document.getElementById(id);
    if (el) scrollSnapshot[id] = el.scrollTop;
  });
  scrollSnapshot['document'] = document.documentElement.scrollTop;
  scrollSnapshot['body'] = document.body.scrollTop;
  scrollSnapshot['windowY'] = window.scrollY;
  const cmScroller = document.querySelector('.CodeMirror-scroll') as HTMLElement | null;
  if (cmScroller) scrollSnapshot['cmScroller'] = cmScroller.scrollTop;
  console.log('[onVaultChanged] scroll snapshot:', JSON.stringify(scrollSnapshot));
  const scrolledEls: any[] = [];
  document.querySelectorAll('*').forEach(el => {
    const top = (el as HTMLElement).scrollTop;
    if (top > 0) scrolledEls.push({ tag: el.tagName, id: (el as HTMLElement).id, cls: (el as HTMLElement).className, top });
  });
  console.log('[onVaultChanged] scrolled elements:', JSON.stringify(scrolledEls));
  const savedBodyScroll = document.body.scrollTop || window.scrollY;
  st.fileContentCache.clear();
  await (window as any).loadDirectory(st.currentDir);
  if (st.currentFile) {
    const fileItems = document.querySelectorAll<HTMLElement>('#fileList li[data-path]');
    const exists = [...fileItems].some(li => li.dataset.path === st.currentFile);
    console.log('[onVaultChanged] currentFile:', st.currentFile, 'exists:', exists);
    if (!exists && st.currentFile.endsWith('.md')) {
      const coreBase = (st.currentFile.split('/').pop() ?? '').replace(/^_/, '');
      const alt = [...fileItems].find(li => {
        const p = li.dataset.path;
        if (!p?.endsWith('.md')) return false;
        return (p.split('/').pop() ?? '').replace(/^_/, '') === coreBase;
      });
      console.log('[onVaultChanged] rename detected, coreBase:', coreBase, 'alt:', alt?.dataset.path);
      if (alt?.dataset.path) {
        const cursor = st.cmEditor?.getCursor();
        const scroll = st.cmEditor?.getScrollInfo();
        (window as any).loadFile(alt.dataset.path, cursor, scroll);
        return;
      }
    }
    // Never overwrite unsaved edits
    if (st.isDirty) {
      console.log('[onVaultChanged] isDirty, skipping reload');
      return;
    }
    // Only reload if disk content actually differs from what's in the editor
    try {
      const fresh = await st.backend!.readFile(st.currentFile);
      if (fresh === (st.cmEditor?.getValue() ?? '')) {
        console.log('[onVaultChanged] content unchanged, skipping reload');
        return;
      }
      console.log('[onVaultChanged] content changed, reloading');
    } catch {}
    await (window as any).loadFile(st.currentFile);
    requestAnimationFrame(() => { requestAnimationFrame(() => {
      if (savedBodyScroll) {
        window.scrollTo(0, savedBodyScroll);
        console.log('[onVaultChanged] restored body scroll:', savedBodyScroll, 'now:', window.scrollY);
      }
    }); });
  }
}

// ===== Init =====
(document.getElementById('hljs-dark') as any).disabled = true;
applySidebarState();

// Auto-detect WebDAV mode: if served over HTTP, probe /dav/
async function probeWebDAV(): Promise<boolean> {
  if (location.protocol === 'file:') return false;
  try {
    const r = await fetch('/dav/', { method: 'PROPFIND', headers: { 'Depth': '0' } });
    if (r.status === 207 || r.ok) {
      st.backend = new WebDAVBackend('/dav');
      st.vaultName = r.headers.get('x-vault-name');
      return true;
    }
  } catch {}
  return false;
}

(async () => {
  if (location.protocol !== 'file:') {
    document.getElementById('workspace-picker')!.style.display = 'none';
  }

  const isWebDAV = await probeWebDAV();
  if (isWebDAV) {
    document.getElementById('app')!.style.display = 'flex';
    await initialize();
    const sse = new EventSource('/jmap/eventsource/?types=*&closeAfter=no&ping=30');
    sse.addEventListener('state', async () => { onVaultChanged(); });
  } else {
    document.getElementById('workspace-picker')!.style.display = 'flex';
    openOrRestoreWorkspace(false).catch(() => {
      document.getElementById('workspace-picker')!.style.display = 'flex';
    });
  }
})();

document.addEventListener('keydown', (e) => {
  const picker = document.getElementById('workspace-picker')!;
  if (picker.style.display === 'none') return;
  if ((e.key === 'ArrowRight' || e.key === 'l') && st.rootHandle) {
    e.preventDefault();
    e.stopImmediatePropagation();
    picker.style.display = 'none';
    document.getElementById('app')!.style.display = '';
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopImmediatePropagation();
    st.savedHandleForResume = null;
    openOrRestoreWorkspace(true);
  }
}, true);
