import { st } from './state';
import {
  appConfig, DEFAULT_CONFIG, CFG_PATH, SESSION_KEY, SORT_STATES,
  BINARY_EXT, getFilePref, setFilePref, formatHotkey, applyConfig,
} from './config';
import {
  readFile, writeFile,
  scanOneLevel, loadConfig, saveConfig,
} from './fs';
import { buildLinkIndex, updateLinkIndexForFile, markBrokenWikilinks, loadBacklinks, loadTags } from './links';
import { escapeHtml } from './editor';
import { hasFSAInvalidChars } from './fsa';

// ===== Dirty state =====
export function setDirty(val: boolean) {
  st.isDirty = val;
  document.getElementById('dirtyDot')!.classList.toggle('dirty', val);
  document.querySelector('.path-center-inner')!.classList.toggle('dirty-active', val);
  document.querySelectorAll('#fileList li[data-path]').forEach(li => {
    if ((li as HTMLElement).dataset.path === st.currentFile) li.classList.toggle('unsaved', val);
  });
}

export function clearFileView() {
  st.currentFile = null;
  document.getElementById('currentPath')!.textContent = 'No file selected';
  document.getElementById('preview')!.innerHTML = '';
  document.getElementById('preview')!.style.display = 'block';
  st.cmEditor.getWrapperElement().style.display = 'none';
  document.getElementById('content')!.classList.remove('edit-mode');
  document.querySelectorAll('.file-list li').forEach(li => li.classList.remove('active'));
  setDirty(false);
}

export function cleanupHtmlPlugin() {
  st.injectedPluginEls.forEach(el => el.remove());
  st.injectedPluginEls = [];
}

// ===== Path animation =====
let dissolveTimer: any = null;
let charTimers: any[] = [];
let isDissolved = false;

export function setPathText(path: string) {
  const el = document.getElementById('currentPath')!;
  const chars = [...path];
  const n = chars.length;
  el.innerHTML = chars.map((c, i) =>
    `<span class="char" style="--delay:${(n - 1 - i) * 15}ms">${c === ' ' ? '&nbsp;' : c}</span>`
  ).join('');
}

export function startDissolve() {
  isDissolved = false;
  dissolveTimer = setTimeout(() => {
    isDissolved = true;
    document.querySelector('.path-center-inner')!.classList.add('bg-hidden');
    const pathEl = document.getElementById('currentPath')!;
    const chars = [...pathEl.querySelectorAll('.char')];
    charTimers.forEach(clearTimeout);
    charTimers = chars.map((c, i) =>
      setTimeout(() => { (c as HTMLElement).style.display = 'none'; }, i * 15)
    );
  }, 4000);
}

export function restorePath() {
  if (!isDissolved) return;
  isDissolved = false;
  clearTimeout(dissolveTimer);
  charTimers.forEach(clearTimeout);
  charTimers = [];
  document.querySelector('.path-center-inner')!.classList.remove('bg-hidden');
  const pathEl = document.getElementById('currentPath')!;
  pathEl.style.display = '';
  const chars = [...pathEl.querySelectorAll<HTMLElement>('.char')];
  chars.forEach(c => { c.style.display = 'none'; });
  charTimers = chars.map((c, i) =>
    setTimeout(() => { c.style.display = ''; }, i * 15)
  );
  setTimeout(startDissolve, chars.length * 15);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function showToolbarBtns() {}

// ===== Sidebar =====
const sidebar = document.getElementById('sidebar')!;
export const mobileQuery = window.matchMedia('(max-width: 600px)');

export function updateSidebarVar() {
  if (sidebar.classList.contains('collapsed')) {
    document.documentElement.style.setProperty('--sidebar-w', '0px');
  } else {
    const w = sidebar.getBoundingClientRect().width;
    if (w > 0) st.sidebarOpenWidth = w;
    document.documentElement.style.setProperty('--sidebar-w', st.sidebarOpenWidth + 'px');
  }
}

export function applySidebarState() {
  const collapsed = mobileQuery.matches || localStorage.getItem('webmd-sidebar') !== '1';
  sidebar.classList.toggle('collapsed', collapsed);
  document.getElementById('toolbar')!.classList.toggle('hidden', !collapsed);
  updateSidebarVar();
}

export function toggleSidebar() {
  sidebar.classList.toggle('collapsed');
  const collapsed = sidebar.classList.contains('collapsed');
  document.getElementById('toolbar')!.classList.toggle('hidden', !collapsed);
  if (!mobileQuery.matches) {
    localStorage.setItem('webmd-sidebar', collapsed ? '0' : '1');
  }
  updateSidebarVar();
}

mobileQuery.addEventListener('change', applySidebarState);

document.addEventListener('touchstart', (e) => {
  st._swipeStartX = e.touches[0].clientX;
  st._swipeStartY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!mobileQuery.matches) return;
  const dx = e.changedTouches[0].clientX - st._swipeStartX;
  const dy = e.changedTouches[0].clientY - st._swipeStartY;
  if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 50) return;
  if (dx > 0 && sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    updateSidebarVar();
  } else if (dx < 0 && !sidebar.classList.contains('collapsed')) {
    sidebar.classList.add('collapsed');
    updateSidebarVar();
  }
}, { passive: true });

document.getElementById('sidebarToggleBtn')!.addEventListener('click', toggleSidebar);

// ===== Floating toggle button auto-hide =====
{
  const toolbar = document.getElementById('toolbar')!;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleToolbarFade() {
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => { toolbar.classList.add('faded'); }, 2000);
  }

  function showToolbar() {
    toolbar.classList.remove('faded');
    scheduleToolbarFade();
  }

  document.addEventListener('mousemove', (e) => {
    if (!sidebar.classList.contains('collapsed')) return;
    if (e.clientX < 60 && e.clientY < 60) showToolbar();
  });

  const obs = new MutationObserver(() => {
    if (sidebar.classList.contains('collapsed')) {
      scheduleToolbarFade();
    } else {
      if (fadeTimer) clearTimeout(fadeTimer);
      toolbar.classList.remove('faded');
    }
  });
  obs.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
}

// ===== Sidebar close button auto-hide =====
{
  const closeBtn = document.getElementById('sidebarCloseBtn')!;
  let closeFadeTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleCloseFade() {
    if (closeFadeTimer) clearTimeout(closeFadeTimer);
    closeFadeTimer = setTimeout(() => { closeBtn.classList.add('faded'); }, 2000);
  }

  function showCloseBtn() {
    closeBtn.classList.remove('faded');
    scheduleCloseFade();
  }

  sidebar.addEventListener('mousemove', () => {
    if (!sidebar.classList.contains('collapsed')) showCloseBtn();
  });

  new MutationObserver(() => {
    if (!sidebar.classList.contains('collapsed')) {
      showCloseBtn();
    } else {
      if (closeFadeTimer) clearTimeout(closeFadeTimer);
      closeBtn.classList.remove('faded');
    }
  }).observe(sidebar, { attributes: true, attributeFilter: ['class'] });

  scheduleCloseFade();
}

// ===== Sidebar resize drag =====
{
  let isResizing = false;
  let dragStartX = 0;
  let dragStartWidth = 0;
  let dragMoved = false;
  const closeBtn = document.getElementById('sidebarCloseBtn')!;
  closeBtn.addEventListener('pointerdown', (e) => {
    dragStartX = e.clientX;
    dragStartWidth = sidebar.classList.contains('collapsed') ? 0 : sidebar.getBoundingClientRect().width;
    dragMoved = false;
    isResizing = true;
    closeBtn.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  closeBtn.addEventListener('pointermove', (e) => {
    if (!isResizing) return;
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) > 4) dragMoved = true;
    if (!dragMoved) return;
    document.body.style.cursor = 'col-resize';
    const w = Math.max(60, Math.min(dragStartWidth + dx, window.innerWidth - 200));
    sidebar.style.transition = 'none';
    sidebar.classList.add('dragging');
    if (w <= 80) {
      sidebar.classList.add('collapsed');
      sidebar.style.width = '';
    } else {
      sidebar.classList.remove('collapsed');
      sidebar.style.width = w + 'px';
    }
    updateSidebarVar();
  });
  closeBtn.addEventListener('pointerup', () => {
    if (!isResizing) return;
    isResizing = false;
    sidebar.classList.remove('dragging');
    sidebar.style.transition = '';
    document.body.style.cursor = '';
  });
  closeBtn.addEventListener('click', () => { if (!dragMoved) toggleSidebar(); });
}

// ===== Sidebar search =====
function getSnippet(content: string, q: string): string {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + q.length + 60);
  let snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet += '…';
  return escapeHtml(snippet).replace(
    new RegExp(escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
    m => `<mark>${m}</mark>`
  );
}

const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchWrap  = document.getElementById('search-wrap')!;
let searchNavActive = false;

function activateSearch() {
  searchWrap.classList.add('search-active');
  searchInput.focus();
}
function deactivateSearch() {
  searchWrap.classList.remove('search-active');
  searchInput.value = '';
  (window as any).loadDirectory(st.currentDir);
}

searchWrap.addEventListener('click', (e) => {
  const t = e.target as Element;
  if (t.closest('a[data-dir]') || t.closest('#sidebarCloseBtn')) return;
  activateSearch();
});

searchInput.addEventListener('blur', () => {
  if (searchNavActive) return;
  if (!searchInput.value) deactivateSearch();
});

searchInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape' || (e.key === 'ArrowLeft' && searchInput.selectionStart === 0 && searchInput.selectionEnd === 0)) {
    e.preventDefault(); e.stopPropagation();
    const focusBcAfter = e.key === 'ArrowLeft';
    searchWrap.classList.remove('search-active');
    searchInput.value = '';
    searchInput.blur();
    (window as any).loadDirectory(st.currentDir).then(() => {
      if (!focusBcAfter) return;
      const bcCurrent = document.querySelector<HTMLElement>('#breadcrumb a.bc-current, #breadcrumb span.bc-current');
      if (bcCurrent) {
        const fileListEl = document.getElementById('fileList');
        fileListEl?.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus'));
        bcCurrent.classList.add('nav-focus');
        fileListEl?.classList.add('keyboard-nav', 'bc-focused');
      }
    });
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'ArrowRight') {
    e.preventDefault();
    const fileListEl = document.getElementById('fileList')!;
    const allLi = Array.from(fileListEl.querySelectorAll<HTMLElement>('li[data-search-path]'));
    if (!allLi.length) {
      if (e.key === 'ArrowDown') {
        searchNavActive = true;
        searchWrap.classList.remove('search-active');
        searchInput.value = '';
        searchInput.blur();
        searchNavActive = false;
        (window as any).loadDirectory(st.currentDir).then(() => {
          const first = fileListEl.querySelector<HTMLElement>('li[data-path], li[data-dir]');
          if (first) {
            fileListEl.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus'));
            first.classList.add('nav-focus');
            fileListEl.classList.add('keyboard-nav');
            console.log('[scroll] searchInput ArrowDown first', first);
            first.scrollIntoView({ block: 'nearest' });
          }
        });
      }
      return;
    }
    const currentIdx = allLi.findIndex(li => li.classList.contains('nav-focus'));
    if (e.key === 'Enter' || e.key === 'ArrowRight') {
      const target = currentIdx >= 0 ? allLi[currentIdx] : allLi[0];
      const path = target?.dataset.searchPath;
      if (path) {
        searchNavActive = true;
        await (window as any).loadFile(path);
        if (st.isEditing) st.cmEditor.focus();
        else document.getElementById('preview')!.focus();
        searchNavActive = false;
        const fileListEl2 = document.getElementById('fileList')!;
        const targetLi = fileListEl2.querySelector<HTMLElement>(`li[data-search-path="${path}"]`);
        if (targetLi) {
          fileListEl2.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus'));
          targetLi.classList.add('nav-focus');
          fileListEl2.classList.add('keyboard-nav');
        }
      }
      return;
    }
    if (e.key === 'ArrowUp' && currentIdx <= 0) {
      allLi.forEach(li => li.classList.remove('nav-focus'));
      searchInput.focus();
      return;
    }
    allLi.forEach(li => li.classList.remove('nav-focus'));
    fileListEl.classList.add('keyboard-nav');
    const next = e.key === 'ArrowDown'
      ? (currentIdx < allLi.length - 1 ? currentIdx + 1 : 0)
      : currentIdx - 1;
    allLi[next].classList.add('nav-focus');
    console.log('[scroll] searchInput nav', allLi[next]);
    allLi[next].scrollIntoView({ block: 'nearest' });
    const path = allLi[next].dataset.searchPath;
    if (path) {
      searchNavActive = true;
      (window as any).loadFile(path);
      requestAnimationFrame(() => {
        searchNavActive = false;
        allLi.forEach(li => li.classList.remove('nav-focus'));
        allLi[next].classList.add('nav-focus');
        searchInput.focus();
      });
    }
  }
});
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { (window as any).loadDirectory(st.currentDir); return; }
  const fileListEl = document.getElementById('fileList')!;
  const breadcrumb = document.getElementById('breadcrumb');
  if (breadcrumb) breadcrumb.innerHTML = '';

  const nameMatches: any[] = [];
  const contentMatches: { file: any; snippet: string }[] = [];
  for (const f of st.allFilesMeta) {
    if (f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) {
      nameMatches.push(f);
    } else if (f.path.endsWith('.md')) {
      const content = st.fileContentCache.get(f.path) || '';
      if (content.toLowerCase().includes(q)) {
        contentMatches.push({ file: f, snippet: getSnippet(content, q) });
      }
    }
  }

  fileListEl.innerHTML = '';
  for (const file of [...nameMatches, ...contentMatches.map(c => c.file)].slice(0, 100)) {
    const cm = contentMatches.find(c => c.file === file);
    const li = document.createElement('li');
    li.dataset.searchPath = file.path;
    li.innerHTML = `<span class="filer-name"><span class="filer-fname">${escapeHtml(file.name)}</span><span class="search-path">${escapeHtml(file.path)}</span>${cm?.snippet ? `<span class="search-snippet">${cm.snippet}</span>` : ''}</span>`;
    li.onclick = () => (window as any).loadFile(file.path);
    fileListEl.appendChild(li);
  }
  if (!nameMatches.length && !contentMatches.length) {
    fileListEl.innerHTML = '<li style="padding:8px;color:var(--ink-subtle)">No results</li>';
  }
});

document.getElementById('fileList')!.addEventListener('mousemove', () => {
  document.getElementById('fileList')!.classList.remove('keyboard-nav');
});

// ===== Mouse zone for path restore =====
document.querySelector('.path-center-inner')!.addEventListener('mouseenter', restorePath);
document.addEventListener('mousemove', e => {
  const inZone = e.clientY < 60 && e.clientX > window.innerWidth * 0.3 && e.clientX < window.innerWidth * 0.7;
  if (inZone) restorePath();
  if (e.clientY < 80) showToolbarBtns();
});


// ===== Preview/Edit toggle =====
const TIN_IDS = new Set(['app','sidebar','main','content','editor','preview','toolbar','qs-overlay','qs-modal','qs-input','qs-list','qs-header','sortBtn','cmdBtn','fileList','breadcrumb','dirtyDot','currentPath','grid-overlay','workspace-picker','kb-overlay','prompt-overlay','ctx-menu']);

export function switchToPreview() {
  if (!st.currentFile) return;
  const isHtml = st.currentFile.endsWith('.html') || st.currentFile.endsWith('.htm');
  if (isHtml) {
    const raw = st.cmEditor.getValue();
    const doc2 = new DOMParser().parseFromString(raw, 'text/html');
    doc2.querySelectorAll('script').forEach(s => s.remove());
    doc2.body.querySelectorAll('[id]').forEach(el => { if (TIN_IDS.has((el as HTMLElement).id)) el.removeAttribute('id'); });
    document.getElementById('preview')!.innerHTML = doc2.body.innerHTML;
  }
  document.getElementById('preview')!.style.display = 'block';
  st.cmEditor.getWrapperElement().style.display = 'none';
  document.getElementById('editBtn')!.style.display = 'inline-block';
  document.getElementById('content')!.classList.remove('edit-mode');
  st.isEditing = false;
  setFilePref(st.currentFile, 'preview');
}

export function switchToEdit() {
  if (!st.currentFile) return;
  document.getElementById('preview')!.style.display = 'none';
  st.cmEditor.getWrapperElement().style.display = '';
  document.getElementById('editBtn')!.style.display = 'none';
  document.getElementById('content')!.classList.add('edit-mode');
  st.isEditing = true;
  if (st.pendingHtmlContent !== null) {
    st.cmEditor.setValue(st.pendingHtmlContent);
    st.cmEditor.setOption('mode', 'text/html');
    st.pendingHtmlContent = null;
  }
  st.cmEditor.focus();
  requestAnimationFrame(() => { requestAnimationFrame(() => { st.cmEditor.refresh(); }); });
  setFilePref(st.currentFile, 'edit');
}

// ===== Save =====
export async function saveCurrentFile() {
  if (!st.currentFile || !st.isDirty) return;
  const content = st.cmEditor.getValue();
  st.isSaving = true;
  await writeFile(st.currentFile, content);
  setTimeout(() => { st.isSaving = false; }, 600);
  if (st.currentFile === CFG_PATH) { try { applyConfig(JSON.parse(content)); } catch {} }
  setDirty(false);
  await updateLinkIndexForFile(st.currentFile);
  const meta = st.allFilesMeta.find(f => f.path === st.currentFile);
  if (meta) { meta.mtime = new Date(); }
  const dot = document.getElementById('dirtyDot')!;
  dot.classList.add('saved');
  setTimeout(() => dot.classList.remove('saved'), 800);
}

document.getElementById('editBtn')!.onclick = () => switchToEdit();
document.querySelector('.path-center-inner')!.addEventListener('click', () => {
  if (st.isDirty) saveCurrentFile();
});

// ===== Load file =====
(window as any).loadFile = async function loadFile(path: string, inheritedCursor?: any, inheritedScroll?: any) {
  if (st.isInlineRenaming) return;
  st.pendingHtmlContent = null;
  const _seq = ++st._loadFileSeq;
  console.log('[loadFile] start', path, 'seq', _seq);
  if (mobileQuery.matches && !sidebar.classList.contains('collapsed')) {
    sidebar.classList.add('collapsed');
    updateSidebarVar();
  }
  const isReload = st.currentFile === path;
  const savedCursorEarly = inheritedCursor ?? (isReload ? st.cmEditor.getCursor() : null);
  const savedScrollEarly = inheritedScroll ?? (isReload ? st.cmEditor.getScrollInfo() : null);
  st.currentFile = path;
  setPathText(path);
  startDissolve();

  document.querySelectorAll('.file-list li').forEach(li => {
    const isActive = (li as HTMLElement).dataset.path === path;
    li.classList.toggle('active', isActive);
    li.classList.toggle('nav-focus', isActive);
  });

  const fileExt = path.includes('.') ? '.' + path.split('.').pop()!.toLowerCase() : '';
  const showBinaryMsg = () => {
    document.getElementById('preview')!.innerHTML = '<span style="color:var(--fg-faint)">Binary file — cannot display</span>';
    document.getElementById('backlinks')!.style.display = 'none';
    st.cmEditor.getWrapperElement().style.display = 'none';
    document.getElementById('preview')!.style.display = '';
    document.getElementById('content')!.classList.remove('edit-mode');
    st.isEditing = false;
  };
  if (BINARY_EXT.has(fileExt)) { showBinaryMsg(); return; }

  let content: string;
  try {
    // FSA mode: binary detection via raw bytes before reading as text
    const getHandle = st.backend?.getFileHandle?.bind(st.backend);
    if (getHandle) {
      const h = await getHandle(path);
      if (_seq !== st._loadFileSeq) { console.log('[loadFile] bail after getHandle', path, _seq, st._loadFileSeq); return; }
      const f = await h.getFile();
      if (_seq !== st._loadFileSeq) { console.log('[loadFile] bail after getFile', path, _seq, st._loadFileSeq); return; }
      st._currentFileMtime = f.lastModified;
      const chunk = await f.slice(0, 512).arrayBuffer();
      if (_seq !== st._loadFileSeq) { console.log('[loadFile] bail after chunk', path, _seq, st._loadFileSeq); return; }
      if (new Uint8Array(chunk).some(b => b === 0)) { showBinaryMsg(); return; }
    }
    const cached = st.fileContentCache.get(path);
    if (cached !== undefined) {
      content = cached;
    } else {
      content = await st.backend!.readFile(path);
      if (_seq !== st._loadFileSeq) { console.log('[loadFile] bail after readFile', path, _seq, st._loadFileSeq); return; }
      st.fileContentCache.set(path, content);
    }
  } catch (e: any) { console.log('[loadFile] error', path, (e as Error).message); document.getElementById('preview')!.textContent = `Error: ${(e as Error).message}`; return; }

  cleanupHtmlPlugin();

  // Plugin hook: if any registered handler returns true, it owns the rendering
  for (const hook of (window as any).tinAPI?._fileOpenHooks ?? []) {
    let handled = false;
    try { handled = await hook(path, content); } catch {}
    if (handled) {
      setDirty(false);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ file: path, editing: false, dir: st.currentDir }));
      history.replaceState(null, '', '#' + path.split('/').map((s: string) => encodeURIComponent(s).replace(/%40/g, '@')).join('/'));
      return;
    }
  }

  const preview = document.getElementById('preview')!;

  if (path.endsWith('.md')) {
    let mdContent = content;
    let fmHtml = '';
    const fmMatch = mdContent.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fmMatch) {
      mdContent = mdContent.slice(fmMatch[0].length);
      const items: string[] = [];
      for (const line of fmMatch[1].split('\n')) {
        const ci = line.indexOf(':');
        if (ci < 0) continue;
        const key = line.slice(0, ci).trim();
        const val = line.slice(ci + 1).trim();
        if (!key || !val) continue;
        if (key === 'tags' && val.startsWith('[') && val.endsWith(']')) {
          const tags = val.slice(1, -1).split(',').map(t => `<span class="fm-tag">${escapeHtml(t.trim().replace(/['"]/g, ''))}</span>`).join(' ');
          items.push(`<span class="fm-item"><span class="fm-key">${key}:</span> ${tags}</span>`);
        } else {
          items.push(`<span class="fm-item"><span class="fm-key">${key}:</span> <span class="fm-val">${escapeHtml(val)}</span></span>`);
        }
      }
      if (items.length) fmHtml = `<div class="frontmatter-meta">${items.join('')}</div>`;
    }
    preview.innerHTML = fmHtml + (window as any).marked.parse(mdContent);
    markBrokenWikilinks();
    loadBacklinks(path);
  } else if (path.endsWith('.html') || path.endsWith('.htm')) {
    const doc = new DOMParser().parseFromString(content, 'text/html');
    const isPlugin = !!doc.querySelector('meta[name="tin-plugin"]');
    doc.querySelectorAll('style').forEach(s => {
      const el = document.createElement('style');
      el.setAttribute('data-tin-plugin', '');
      el.textContent = s.textContent;
      document.head.appendChild(el);
      st.injectedPluginEls.push(el);
    });
    const scripts = isPlugin ? [...doc.querySelectorAll('script')] : [];
    doc.querySelectorAll('script').forEach(s => s.remove());
    doc.body.querySelectorAll('[id]').forEach(el => { if (TIN_IDS.has((el as HTMLElement).id)) el.removeAttribute('id'); });
    preview.innerHTML = doc.body.innerHTML;
    document.getElementById('backlinks')!.style.display = 'none';
    st.pendingHtmlContent = content;
    const htmlPref = getFilePref(path) ?? appConfig.defaultHtmlMode ?? 'preview';
    const htmlStartEdit = htmlPref === 'edit';
    if (htmlStartEdit) {
      preview.style.display = 'none';
      st.cmEditor.getWrapperElement().style.display = '';
      document.getElementById('editBtn')!.style.display = 'none';
      document.getElementById('content')!.classList.add('edit-mode');
      st.isEditing = true;
      st.cmEditor.setValue(st.pendingHtmlContent);
      st.cmEditor.setOption('mode', 'text/html');
      st.pendingHtmlContent = null;
      requestAnimationFrame(() => { requestAnimationFrame(() => { st.cmEditor.refresh(); }); });
    } else {
      preview.style.display = 'block';
      st.cmEditor.getWrapperElement().style.display = 'none';
      document.getElementById('editBtn')!.style.display = 'inline-block';
      document.getElementById('content')!.classList.remove('edit-mode');
      st.isEditing = false;
    }
    scripts.forEach(orig => {
      const el = document.createElement('script');
      el.setAttribute('data-tin-plugin', '');
      el.textContent = orig.textContent;
      document.body.appendChild(el);
      st.injectedPluginEls.push(el);
    });
    setDirty(false);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ file: path, editing: htmlStartEdit, dir: st.currentDir }));
    history.replaceState(null, '', '#' + path.split('/').map(s => encodeURIComponent(s).replace(/%40/g, '@')).join('/'));
    return;
  } else {
    const ext = path.split('.').pop()!;
    const lang = ({ py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', json: 'json', yaml: 'yaml', yml: 'yaml' } as any)[ext] || 'plaintext';
    const highlighted = (window as any).hljs.getLanguage(lang)
      ? (window as any).hljs.highlight(content, { language: lang }).value
      : escapeHtml(content);
    preview.innerHTML = `<pre><code class="language-${lang}">${highlighted}</code></pre>`;
    document.getElementById('backlinks')!.style.display = 'none';
  }

  const savedScroll = isReload ? st.cmEditor.getScrollInfo() : null;
  console.log('[loadFile] savedScroll', savedScroll, 'isReload', isReload);
  st.cmEditor.setValue(content);
  if (savedScroll) {
    console.log('[loadFile] restoring scroll', savedScroll, 'current', st.cmEditor.getScrollInfo());
    st.cmEditor.scrollTo(savedScroll.left, savedScroll.top);
    console.log('[loadFile] after scrollTo', st.cmEditor.getScrollInfo());
  } else {
    st.cmEditor.scrollTo(0, 0);
  }
  const ext = path.split('.').pop()!.toLowerCase();
  const mode = ext === 'md' ? 'markdown-fm'
    : ext === 'json' ? 'application/json'
    : ext === 'js' ? 'text/javascript'
    : ext === 'ts' ? 'text/typescript'
    : ext === 'css' ? 'text/css'
    : (ext === 'html' || ext === 'htm') ? 'text/html'
    : 'text/plain';
  st.cmEditor.setOption('mode', mode);
  const prefMode = getFilePref(path) ?? appConfig.defaultMdMode ?? 'edit';
  const startInPreview = prefMode === 'preview';
  preview.style.display = startInPreview ? '' : 'none';
  st.cmEditor.getWrapperElement().style.display = startInPreview ? 'none' : '';
  document.getElementById('editBtn')!.style.display = startInPreview ? 'inline-block' : 'none';
  document.getElementById('content')!.classList.toggle('edit-mode', !startInPreview);
  st.isEditing = !startInPreview;
  setDirty(false);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ file: path, editing: !startInPreview, dir: st.currentDir }));
  history.replaceState(null, '', '#' + path.split('/').map(s => encodeURIComponent(s).replace(/%40/g, '@')).join('/'));
  requestAnimationFrame(() => { requestAnimationFrame(() => {
    console.log('[loadFile] raf2 before refresh', st.cmEditor.getScrollInfo());
    st.cmEditor.refresh();
    console.log('[loadFile] raf2 after refresh', st.cmEditor.getScrollInfo());
    if (savedCursorEarly) st.cmEditor.setCursor(savedCursorEarly);
    if (savedScrollEarly) {
      console.log('[loadFile] raf2 scrollTo savedScrollEarly', savedScrollEarly);
      st.cmEditor.scrollTo(savedScrollEarly.left, savedScrollEarly.top);
    }
    else if (savedCursorEarly) {
      console.log('[loadFile] raf2 scrollIntoView');
      st.cmEditor.scrollIntoView(savedCursorEarly, 100);
    }
    console.log('[loadFile] raf2 final', st.cmEditor.getScrollInfo());
  }); });
  console.log('[loadFile] done', path, 'seq', _seq, 'len', content.length);
};

// Wikilink click handler
document.getElementById('preview')!.addEventListener('click', async (e) => {
  const a = (e.target as Element).closest('a.wikilink');
  if (!a) return;
  e.preventDefault();
  const name = (a as HTMLElement).dataset.wiki!;
  let target = (a as HTMLElement).dataset.target;
  if (!target) {
    const matches = st.fileBaseIndex.get(name);
    if (matches && matches.length) target = matches[0];
  }
  if (target) (window as any).loadFile(target);
  else alert(`Link not found: ${name}`);
});

// ===== Directory listing =====
(window as any).loadDirectory = async function loadDirectory(dir = '') {
  const _seq = ++st._loadDirSeq;
  const prevDir = st.currentDir;
  const dirChanged = dir !== prevDir;
  st.currentDir = dir;
  const preview = document.getElementById('preview')!;
  const savedPreviewScroll = preview.scrollTop;
  console.log('[loadDirectory] start, preview.scrollTop:', savedPreviewScroll);
  if (dirChanged && !st.currentFile) clearRightPanel();
  const sortByKey = st.sortBy;
  const tagFilter = (document.getElementById('tagFilter') as HTMLSelectElement)?.value || '';
  const fileListEl = document.getElementById('fileList')!;
  const breadcrumb = document.getElementById('breadcrumb')!;

  let entries: any[];
  try { entries = await scanOneLevel(dir); }
  catch (e) { console.error('loadDirectory failed', e); return; }
  if (_seq !== st._loadDirSeq) return;

  if (tagFilter) {
    entries = entries.filter(f => f.type === 'directory' || (f.tags && f.tags.includes(tagFilter)));
  }

  entries.sort((a: any, b: any) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    let r: number;
    if (sortByKey === 'name') r = a.name.localeCompare(b.name);
    else r = a.type === 'file' ? (a.mtime - b.mtime || a.name.localeCompare(b.name)) : a.name.localeCompare(b.name);
    return st.sortOrder === 'desc' ? -r : r;
  });

  if (breadcrumb) {
    const parts = dir ? dir.split('/') : [];
    const rootName = st.rootHandle?.name ?? st.vaultName ?? (st.backend ? window.location.hostname : 'root');
    const sep = `<span class="bc-sep">/</span>`;
    let breadcrumbHtml: string;
    if (!dir) {
      breadcrumbHtml = `<span class="bc-home bc-current">${escapeHtml(rootName)}</span>`;
    } else if (parts.length === 1) {
      breadcrumbHtml = `<a href="#" data-dir="" class="bc-home">${escapeHtml(rootName)}</a>${sep}<span class="bc-current">${escapeHtml(parts[0])}</span>`;
    } else {
      const grandparentPath = parts.slice(0, -2).join('/');
      const parentPath = parts.slice(0, -1).join('/');
      const parentName = parts[parts.length - 2];
      const currentName = parts[parts.length - 1];
      breadcrumbHtml = `<a href="#" data-dir="${escapeHtml(grandparentPath)}" class="bc-up">..</a>${sep}<a href="#" data-dir="${escapeHtml(parentPath)}">${escapeHtml(parentName)}</a>${sep}<span class="bc-current">${escapeHtml(currentName)}</span>`;
    }
    breadcrumb.innerHTML = breadcrumbHtml;
    breadcrumb.querySelectorAll('a').forEach(a => {
      a.onclick = (e) => {
        e.preventDefault();
        if (a.classList.contains('bc-current')) {
          const fl = document.getElementById('fileList')!;
          fl.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus'));
          a.classList.add('nav-focus');
          fl.classList.add('keyboard-nav', 'bc-focused');
          showWelcomePage();
          return;
        }
        (window as any).loadDirectory(a.dataset.dir).then(() => {
          if (a.dataset.dir === '') {
            const bc2 = document.querySelector<HTMLElement>('#breadcrumb a.bc-current, #breadcrumb span.bc-current');
            const fl2 = document.getElementById('fileList')!;
            if (bc2) { fl2.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus')); bc2.classList.add('nav-focus'); fl2.classList.add('keyboard-nav', 'bc-focused'); }
            showWelcomePage();
          }
        });
        clearFileView();
      };
    });
  }

  let siblings: any[] = [];
  let siblingParentDir = '';
  if (dir !== '') {
    siblingParentDir = dir.includes('/') ? dir.split('/').slice(0, -1).join('/') : '';
    const currentDirName = dir.split('/').pop();
    try {
      siblings = await scanOneLevel(siblingParentDir);
      siblings = siblings.filter((e: any) => e.name !== currentDirName);
      siblings.sort((a: any, b: any) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        let r: number;
        if (sortByKey === 'name') r = a.name.localeCompare(b.name);
        else r = a.type === 'file' ? (a.mtime - b.mtime || a.name.localeCompare(b.name)) : a.name.localeCompare(b.name);
        return st.sortOrder === 'desc' ? -r : r;
      });
    } catch (e) { console.warn('loadDirectory sibling scan failed', e); }
  }
  if (_seq !== st._loadDirSeq) return;

  const flipMap = new Map<string, number>();
  fileListEl.querySelectorAll<HTMLElement>('li[data-path]').forEach(li => {
    flipMap.set(li.dataset.path!, li.getBoundingClientRect().top);
  });
  fileListEl.innerHTML = '';

  function makeFilerItem(file: any, prefix: string) {
    const li = document.createElement('li');
    const isActive = file.path === st.currentFile || file.path === st.currentDir;
    const prefixSpan = `<span class="filer-prefix${isActive ? ' active-prefix' : ''}">${escapeHtml(prefix)}</span>`;
    li.innerHTML = `${prefixSpan}<span class="filer-name"><span class="filer-fname">${escapeHtml(file.name)}</span></span>`;
    li.dataset.path = file.path;
    li.dataset.type = file.type;
    if (isActive) li.classList.add('active');
    li.onclick = () => {
      const fl = document.getElementById('fileList')!;
      document.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus'));
      fl.classList.remove('bc-focused');
      if (file.type === 'directory') {
        st.autoFocusFirstOnLoad = true;
        (window as any).loadDirectory(file.path);
      } else {
        li.classList.add('nav-focus');
        (window as any).loadFile(file.path);
      }
    };
    return li;
  }

  function makeNewItem(prefix = '-', targetDir = dir) {
    const li = document.createElement('li') as HTMLLIElement & { __newItemDir?: string };
    li.dataset.newItem = 'true';
    li.__newItemDir = targetDir;
    const prefixEl = document.createElement('span');
    prefixEl.className = 'filer-prefix';
    prefixEl.textContent = prefix;
    const nameEl = document.createElement('span');
    nameEl.className = 'filer-name new-item-label';
    nameEl.textContent = '…';
    li.append(prefixEl, nameEl);
    li.onclick = () => showNewItemPanel(targetDir, true);
    return li;
  }

  const pfx = (depth: number, isDir: boolean) => ' '.repeat(depth) + (isDir ? '/ ' : '  ');

  if (dir === '') {
    for (const file of entries) {
      fileListEl.appendChild(makeFilerItem(file, pfx(0, file.type === 'directory')));
    }
    fileListEl.appendChild(makeNewItem(' '));
  } else {
    const depth = dir.split('/').length;
    for (const file of entries) {
      const li = makeFilerItem(file, pfx(depth, file.type === 'directory'));
      li.classList.add('in-dir');
      fileListEl.appendChild(li);
    }
    const curNewItem = makeNewItem(' '.repeat(depth) + ' ');
    curNewItem.classList.add('in-dir');
    fileListEl.appendChild(curNewItem);
    for (const file of siblings) {
      const li = makeFilerItem(file, pfx(depth - 1, file.type === 'directory'));
      li.classList.add('out-of-scope');
      fileListEl.appendChild(li);
    }
    const parentNewItem = makeNewItem(' '.repeat(depth - 1) + ' ', siblingParentDir);
    parentNewItem.classList.add('out-of-scope');
    fileListEl.appendChild(parentNewItem);
  }

  if (flipMap.size > 0) {
    fileListEl.querySelectorAll<HTMLElement>('li[data-path]').forEach(li => {
      const oldTop = flipMap.get(li.dataset.path!);
      if (oldTop === undefined) return;
      const newTop = li.getBoundingClientRect().top;
      const delta = oldTop - newTop;
      if (Math.abs(delta) < 1) return;
      if (oldTop < 0 || oldTop > window.innerHeight) return;
      li.style.transition = 'none';
      li.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        li.style.transition = 'transform 300ms ease';
        li.style.transform = '';
        li.addEventListener('transitionend', () => { li.style.transition = ''; }, { once: true });
      });
    });
  }

  if (st.autoFocusFirstOnLoad) {
    st.autoFocusFirstOnLoad = false;
    const first = fileListEl.querySelector<HTMLElement>('li[data-path], li[data-dir], li[data-new-item]');
    if (first) {
      fileListEl.classList.add('keyboard-nav');
      first.classList.add('nav-focus');
      console.log('[scroll] autoFocusFirstOnLoad first', first);
      first.scrollIntoView({ block: 'nearest' });
      if ((first as any).dataset.newItem) {
        showNewItemPanel((first as any).__newItemDir ?? st.currentDir);
      } else if (first.dataset.type === 'directory') {
        showFolderPreview(first.dataset.path!);
      } else if (first.dataset.path) {
        (window as any).loadFile(first.dataset.path);
      }
    }
  }
  console.log('[loadDirectory] end, restoring preview.scrollTop:', savedPreviewScroll);
  preview.scrollTop = savedPreviewScroll;
};

// ===== Panels =====
export function clearRightPanel() {
  st.currentFile = null;
  document.getElementById('backlinks')!.style.display = 'none';
  st.cmEditor.getWrapperElement().style.display = 'none';
  document.getElementById('preview')!.style.display = '';
  document.getElementById('content')!.classList.remove('edit-mode');
  setDirty(false);
  if (!st.currentDir) {
    showWelcomePage();
  } else {
    document.getElementById('currentPath')!.textContent = 'No file selected';
    document.getElementById('preview')!.innerHTML = '';
  }
}

export function makeRightPanel(title: string) {
  clearRightPanel();
  document.getElementById('currentPath')!.textContent = title;
  const preview = document.getElementById('preview')!;
  preview.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'system-panel';
  preview.appendChild(wrap);
  return wrap;
}

export async function showFolderPreview(folderPath: string) {
  const name = folderPath.split('/').pop();
  document.getElementById('currentPath')!.textContent = name + '/';
  const preview = document.getElementById('preview')!;
  preview.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'system-panel system-panel--folder';
  preview.appendChild(wrap);
  try {
    const entries = await scanOneLevel(folderPath);
    entries.sort((a: any, b: any) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      let r: number;
      if (st.sortBy === 'name') r = a.name.localeCompare(b.name);
      else r = a.type === 'file' ? (a.mtime - b.mtime || a.name.localeCompare(b.name)) : a.name.localeCompare(b.name);
      return st.sortOrder === 'desc' ? -r : r;
    });
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = 'var(--fg-faint)';
      empty.textContent = '(empty)';
      wrap.appendChild(empty);
    } else {
      entries.forEach((entry: any) => {
        const row = document.createElement('div');
        const label = document.createElement('span');
        label.style.cssText = 'color: var(--fg-faint); word-break: break-all;';
        label.textContent = entry.name + (entry.type === 'directory' ? '/' : '');
        row.appendChild(label);
        wrap.appendChild(row);
      });
    }
  } catch {
    wrap.textContent = '(load error)';
  }
}

export function showNewItemPanel(targetDir: string, autoFocus = false) {
  st.currentFile = null;
  document.getElementById('currentPath')!.textContent = 'New';
  document.getElementById('backlinks')!.style.display = 'none';
  st.cmEditor.getWrapperElement().style.display = 'none';
  const preview = document.getElementById('preview')!;
  preview.style.display = '';
  document.getElementById('content')!.classList.remove('edit-mode');
  document.querySelectorAll('.file-list li').forEach(li => li.classList.remove('active'));
  setDirty(false);
  preview.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'system-panel system-panel--new';
  const label = document.createElement('div');
  label.className = 'system-panel__label';
  const dirName = targetDir ? targetDir.split('/').pop() : (st.rootHandle?.name ?? (st.backend ? window.location.hostname : 'root'));
  label.innerHTML = `New File or Folder (end with /) in <strong>${escapeHtml(dirName!)}</strong>`;

  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.id = 'new-item-input';
  input.placeholder = '|';
  input.style.cssText = [
    'font-family: inherit',
    'font-size: 1rem',
    'color: var(--fg)',
    'background: transparent',
    'border: none',
    'outline: none',
    'padding-inline: 0',
    'width: calc(28 * var(--cc-w))',
  ].join(';');

  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { input.value = ''; input.blur(); return; }
    if (e.key !== 'Enter') return;
    const name = input.value.trim();
    if (!name) return;
    input.value = '';
    if (name.endsWith('/')) {
      await createNewFolder(targetDir, name.slice(0, -1));
    } else {
      await createNewFile(targetDir, name);
    }
  });

  wrap.append(label, input);
  preview.appendChild(wrap);
  if (autoFocus) requestAnimationFrame(() => input.focus());
}

export function showWelcomePage() {
  st.currentFile = null;
  document.getElementById('currentPath')!.textContent = st.rootHandle?.name ?? (st.backend ? window.location.hostname : '');
  document.getElementById('backlinks')!.style.display = 'none';
  st.cmEditor.getWrapperElement().style.display = 'none';
  document.getElementById('content')!.classList.remove('edit-mode');
  setDirty(false);
  const preview = document.getElementById('preview')!;
  preview.style.display = '';
  preview.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'system-panel system-panel--welcome';

  const hkWrap = document.createElement('div');
  hkWrap.className = 'system-panel__shortcuts';
  const hkCfg = { ...DEFAULT_CONFIG.hotkeys, ...(appConfig.hotkeys || {}) };
  const keys: [string, string][] = [
    ['↑ ↓', 'Navigate'],
    ['←', 'Go up'],
    ['→ / Enter', 'Open file or folder'],
    ['Backspace', 'Delete file or folder'],
    [formatHotkey(hkCfg.newItem), 'New file or folder'],
    [formatHotkey(hkCfg.open), 'Open vault'],
    [formatHotkey(hkCfg.save), 'Save file'],
    [formatHotkey(hkCfg.sidebar), 'Sidepanel'],
    [formatHotkey(hkCfg.togglePreview), 'Switch Preview / Edit'],
    [formatHotkey(hkCfg.settings), 'Config'],
    ['⌘↩', 'Rename file'],
  ];
  keys.forEach(([key, desc]) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:var(--ch-2);margin-block-end:0.5rem;';
    const k = document.createElement('span');
    k.style.cssText = 'width:calc(10 * var(--cc-w));flex-shrink:0;';
    k.textContent = key;
    const d = document.createElement('span');
    d.textContent = desc;
    row.append(k, d);
    hkWrap.appendChild(row);
  });
  wrap.appendChild(hkWrap);
  preview.appendChild(wrap);
}

export function startInlineRename(liEl: HTMLElement, oldPath: string) {
  const fnameEl = liEl.querySelector('.filer-fname') as HTMLElement;
  if (!fnameEl || liEl.querySelector('input.inline-rename')) return;
  const oldName = oldPath.split('/').pop()!;
  st.isInlineRenaming = true;
  const input = document.createElement('input');
  input.className = 'inline-rename';
  input.value = oldName;
  input.style.cssText = 'font-family:inherit;font-size:inherit;color:var(--dirty);background:transparent;border:none;outline:none;width:100%;caret-color:var(--dirty);position:relative;z-index:10;margin:0;padding:0;vertical-align:baseline;line-height:inherit;';
  fnameEl.replaceWith(input);
  setTimeout(() => {
    input.focus();
    const dotIdx = oldName.lastIndexOf('.');
    input.setSelectionRange(0, dotIdx > 0 ? dotIdx : oldName.length);
  }, 0);
  const endRename = () => { st.isInlineRenaming = false; };
  const commit = async () => {
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      const parentDir = oldPath.includes('/') ? oldPath.split('/').slice(0, -1).join('/') : '';
      if (st.rootHandle && hasFSAInvalidChars(newName)) {
        alert(`Filename cannot contain: * < > ? \\ : | "`);
        endRename(); input.replaceWith(fnameEl); return;
      }
      const newPath = parentDir ? `${parentDir}/${newName}` : newName;
      try {
        await st.backend!.rename(oldPath, newPath);
        st.fileContentCache.delete(oldPath);
        st.fileContentCache.set(newPath, st.fileContentCache.get(newPath) ?? '');
        st.fileContentCache.delete(newPath); // ensure fresh read
        endRename();
        if (st.currentFile === oldPath) await (window as any).loadFile(newPath);
        await (window as any).loadDirectory(st.currentDir);
      } catch (err: any) { alert(err.message || 'Rename failed'); endRename(); input.replaceWith(fnameEl); }
    } else {
      endRename(); input.replaceWith(fnameEl);
    }
  };
  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') await commit();
    if (e.key === 'Escape') { endRename(); input.replaceWith(fnameEl); }
  });
}

export function showRenamePanel(oldPath: string) {
  const oldName = oldPath.split('/').pop()!;
  const wrap = makeRightPanel('Rename');
  const label = document.createElement('div');
  label.style.cssText = 'margin-block-end: 1rem; color: var(--fg-faint);';
  label.textContent = `Rename "${oldName}"`;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.style.cssText = 'font-family:inherit;font-size:1rem;color:var(--fg);background:transparent;border:none;border-bottom:1px solid var(--border);outline:none;width:calc(28 * var(--cc-w));';
  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { clearRightPanel(); return; }
    if (e.key !== 'Enter') return;
    const newName = input.value.trim();
    if (!newName || newName === oldName) { clearRightPanel(); return; }
    const parentDir = oldPath.includes('/') ? oldPath.split('/').slice(0, -1).join('/') : '';
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;
    try {
      await st.backend!.rename(oldPath, newPath);
      st.fileContentCache.delete(oldPath);
      if (st.currentFile === oldPath) await (window as any).loadFile(newPath);
      await (window as any).loadDirectory(st.currentDir);
    } catch (err: any) { alert(err.message || 'Rename failed'); clearRightPanel(); return; }
    clearRightPanel();
  });
  wrap.append(label, input);
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

export function showDeletePanel(path: string, isDir: boolean) {
  const name = path.split('/').pop();
  const wrap = makeRightPanel('Delete');
  const msg = document.createElement('div');
  msg.style.cssText = 'margin-block-end: 1rem;';
  msg.textContent = `Delete "${name}"?`;
  const hint = document.createElement('div');
  hint.style.cssText = 'color: var(--fg-faint); font-size: 1rem;';
  hint.textContent = 'Enter to delete, Esc to cancel';
  wrap.append(msg, hint);
  const handler = async (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.stopPropagation();
    document.removeEventListener('keydown', handler, true);
    if (e.key === 'Enter') await deleteEntry(path, isDir);
    clearRightPanel();
  };
  document.addEventListener('keydown', handler, true);
}

export function showPrompt(label: string, defaultVal = ''): Promise<string | null> {
  return new Promise(resolve => {
    const overlay = document.getElementById('prompt-overlay')!;
    const input = document.getElementById('prompt-input') as HTMLInputElement;
    const ok = document.getElementById('prompt-ok')!;
    const cancel = document.getElementById('prompt-cancel')!;
    document.getElementById('prompt-label')!.textContent = label;
    input.value = defaultVal;
    input.style.display = '';
    overlay.classList.add('open');
    input.focus();
    input.select();
    const finish = (val: string | null) => {
      overlay.classList.remove('open');
      (ok as any).onclick = (cancel as any).onclick = (input as any).onkeydown = null;
      resolve(val);
    };
    (ok as any).onclick = () => finish(input.value.trim() || null);
    (cancel as any).onclick = () => finish(null);
    (input as any).onkeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') finish(input.value.trim() || null);
      if (e.key === 'Escape') finish(null);
    };
  });
}

export function showConfirm(label: string): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = document.getElementById('prompt-overlay')!;
    const input = document.getElementById('prompt-input') as HTMLInputElement;
    const ok = document.getElementById('prompt-ok')!;
    const cancel = document.getElementById('prompt-cancel')!;
    document.getElementById('prompt-label')!.textContent = label;
    input.style.display = 'none';
    overlay.classList.add('open');
    ok.focus();
    const finish = (val: boolean) => {
      overlay.classList.remove('open');
      input.style.display = '';
      (ok as any).onclick = (cancel as any).onclick = null;
      resolve(val);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    };
    const done = (val: boolean) => {
      overlay.removeEventListener('keydown', onKey);
      (ok as any).onclick = (cancel as any).onclick = null;
      finish(val);
    };
    (ok as any).onclick = () => done(true);
    (cancel as any).onclick = () => done(false);
    overlay.addEventListener('keydown', onKey);
  });
}

// ===== File operations =====
export async function createNewFile(dir: string, name: string) {
  if (st.rootHandle && hasFSAInvalidChars(name)) {
    alert(`Filename cannot contain: * < > ? \\ : | "`);
    return;
  }
  const path = dir ? `${dir}/${name}` : name;
  await writeFile(path, '');
  await (window as any).loadDirectory(dir);
  await (window as any).loadFile(path);
}

export async function createNewFolder(dir: string, name: string) {
  try {
    const path = dir ? `${dir}/${name}` : name;
    await st.backend!.createDir(path);
    await (window as any).loadDirectory(dir);
  } catch (e: any) {
    const msg = e?.name === 'TypeMismatchError'
      ? `"${name}" already exists as a file`
      : `Failed to create folder: ${e?.message ?? e}`;
    alert(msg);
  }
}

export async function deleteEntry(path: string, _isDir: boolean) {
  await st.backend!.deleteEntry(path);
  st.fileContentCache.delete(path);
  if (st.currentFile === path) {
    st.currentFile = null;
    document.getElementById('currentPath')!.textContent = 'No file selected';
    document.getElementById('preview')!.innerHTML = '';
    document.getElementById('editor')!.style.display = 'none';
    setDirty(false);
  }
  await (window as any).loadDirectory(st.currentDir);
}

// ===== Settings =====
export function settingsClose() {
  if (!st.settingsActive) return;
  st.settingsActive = false;
  document.getElementById('fileList')?.classList.remove('settings-active');
  const bc = document.getElementById('breadcrumb');
  if (bc && st.settingsPrevBreadcrumb) {
    bc.innerHTML = st.settingsPrevBreadcrumb;
    bc.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus'));
  }
  st.settingsPrevBreadcrumb = '';
  (window as any).loadDirectory(st.currentDir).then(() => {
    const bcHome2 = document.querySelector<HTMLElement>('#breadcrumb a.bc-current, #breadcrumb span.bc-current');
    const fl2 = document.getElementById('fileList');
    if (bcHome2) { fl2?.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus')); bcHome2.classList.add('nav-focus'); fl2?.classList.add('keyboard-nav', 'bc-focused'); }
    showWelcomePage();
  });
}

export async function settingsOpen() {
  st.currentFile = null;
  st.settingsActive = true;
  setDirty(false);
  document.getElementById('currentPath')!.textContent = 'config';
  document.getElementById('backlinks')!.style.display = 'none';
  st.cmEditor.getWrapperElement().style.display = 'none';
  document.getElementById('content')!.classList.remove('edit-mode');
  document.getElementById('fileList')?.classList.add('settings-active');

  const bc = document.getElementById('breadcrumb');
  st.settingsPrevBreadcrumb = bc?.innerHTML ?? '';
  if (bc) bc.innerHTML = `<span class="bc-home bc-current">config</span>`;

  const fileListEl = document.getElementById('fileList');
  fileListEl?.querySelectorAll('.nav-focus').forEach(el => el.classList.remove('nav-focus'));
  const bcCurrent = document.querySelector<HTMLElement>('#breadcrumb .bc-current');
  if (bcCurrent) {
    bcCurrent.classList.add('nav-focus');
    fileListEl?.classList.add('keyboard-nav', 'bc-focused');
  }

  const preview = document.getElementById('preview')!;
  preview.style.display = '';
  preview.innerHTML = '';

  const body = document.createElement('div');
  body.id = 'cfg-ui';
  preview.appendChild(body);

  const defaults = DEFAULT_CONFIG as any;
  let config: any = { ...defaults, hotkeys: { ...defaults.hotkeys } };
  try {
    const saved = JSON.parse(await readFile(CFG_PATH));
    config = { ...defaults, ...saved, hotkeys: { ...defaults.hotkeys, ...(saved.hotkeys || {}) } };
  } catch {}

  function makeRow(label: string, control: HTMLElement, extra?: HTMLElement) {
    const r = document.createElement('div');
    r.className = 'cfg-row';
    const l = document.createElement('span');
    l.className = 'cfg-label';
    l.textContent = label;
    r.append(l, control);
    if (extra) r.appendChild(extra);
    body.appendChild(r);
  }

  function makeSelect(options: [string, string][], val: string): HTMLSelectElement {
    const el = document.createElement('select');
    el.className = 'cfg-input';
    el.style.cssText = 'width:auto;text-align:left;cursor:pointer;appearance:none;-webkit-appearance:none;padding:0;';
    options.forEach(([v, t]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = t; el.appendChild(o);
    });
    el.value = val;
    return el;
  }

  const autosaveEl = document.createElement('input') as HTMLInputElement;
  autosaveEl.type = 'number'; autosaveEl.min = '1'; autosaveEl.max = '600';
  autosaveEl.className = 'cfg-input';
  autosaveEl.value = String(config.autosaveDelay ?? defaults.autosaveDelay);
  const unitSpan = document.createElement('span'); unitSpan.className = 'cfg-unit'; unitSpan.textContent = 's';
  makeRow('autosaveDelay', autosaveEl, unitSpan);

  const sortEl = makeSelect([['name-asc','Name ↑'],['name-desc','Name ↓'],['mtime-desc','Modified ↓'],['mtime-asc','Modified ↑']],
    `${config.sortBy ?? defaults.sortBy}-${config.sortOrder ?? defaults.sortOrder}`);
  makeRow('sort', sortEl);

  const excludeEl = document.createElement('textarea') as HTMLTextAreaElement;
  excludeEl.className = 'cfg-exclude'; excludeEl.rows = 5; excludeEl.spellcheck = false;
  excludeEl.value = (config.exclude ?? defaults.exclude).join('\n');
  makeRow('exclude', excludeEl);

  const cm5El = makeSelect([['false','Plain textarea'],['true','CodeMirror 5']], localStorage.getItem('webmd-cm5') === 'true' ? 'true' : 'false');
  cm5El.addEventListener('change', () => { localStorage.setItem('webmd-cm5', cm5El.value); location.reload(); });
  makeRow('editor', cm5El);

  const autoIndexEl = makeSelect([['false','Off'],['true','On']], String(config.autoIndex ?? defaults.autoIndex));
  makeRow('auto index', autoIndexEl);

  const mdModeEl = makeSelect([['edit','Edit'],['preview','Preview']], config.defaultMdMode ?? defaults.defaultMdMode);
  makeRow('default view (.md)', mdModeEl);

  const htmlModeEl = makeSelect([['preview','Preview'],['edit','Edit']], config.defaultHtmlMode ?? defaults.defaultHtmlMode);
  makeRow('default view (.html)', htmlModeEl);

  const hkLabel = document.createElement('div');
  hkLabel.style.cssText = 'margin-block: 1.5rem 0.5rem; color: var(--fg-faint); font-size:1rem;';
  hkLabel.textContent = 'hotkeys';
  body.appendChild(hkLabel);

  const hotkeyActions = [
    { id: 'save',          label: 'Save file' },
    { id: 'sidebar',       label: 'Side panel' },
    { id: 'open',          label: 'Open vault' },
    { id: 'togglePreview', label: 'Toggle Preview / Edit' },
    { id: 'newItem',       label: 'New file or folder' },
  ];

  hotkeyActions.forEach(({ id, label }) => {
    const input = document.createElement('input') as HTMLInputElement;
    input.className = 'cfg-input';
    input.style.cssText = 'width:calc(16 * var(--cc-w));text-align:left;cursor:pointer;';
    input.readOnly = true;
    input.value = config.hotkeys[id] || defaults.hotkeys[id];
    input.addEventListener('focus', () => { input.value = '…'; input.style.color = 'var(--fg-faint)'; });
    input.addEventListener('keydown', (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { input.value = config.hotkeys[id] || defaults.hotkeys[id]; input.style.color = ''; input.blur(); return; }
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push('cmd');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');
      const k = e.key.toLowerCase();
      if (!['meta','control','shift','alt'].includes(k)) {
        parts.push(k);
        if (parts.length >= 2) {
          const combo = parts.join('+');
          input.value = combo; input.style.color = '';
          config.hotkeys[id] = combo;
          input.blur(); save();
        }
      }
    });
    input.addEventListener('blur', () => { if (input.value === '…') { input.value = config.hotkeys[id] || defaults.hotkeys[id]; input.style.color = ''; } });
    makeRow(label, input);
  });

  const status = document.createElement('div');
  status.style.cssText = 'margin-block-start: 2rem; color: var(--fg-faint);';
  body.appendChild(status);

  let saveTimer: ReturnType<typeof setTimeout>;

  async function save() {
    config.autosaveDelay = Number(autosaveEl.value);
    config.exclude = excludeEl.value.split('\n').map((s: string) => s.trim()).filter(Boolean);
    const [by, ord] = sortEl.value.split('-');
    config.sortBy = by; config.sortOrder = ord;
    config.autoIndex = autoIndexEl.value === 'true';
    config.defaultMdMode = mdModeEl.value;
    config.defaultHtmlMode = htmlModeEl.value;
    const knownKeys = new Set(Object.keys(defaults));
    const clean = Object.fromEntries(Object.entries(config).filter(([k]) => knownKeys.has(k)));
    try {
      await saveConfig(JSON.stringify(clean, null, 2));
      applyConfig(clean);
      status.textContent = 'saved';
      setTimeout(() => { status.textContent = ''; }, 1200);
    } catch (e: any) { status.textContent = 'error: ' + e.message; }
  }

  [autosaveEl, sortEl, excludeEl, autoIndexEl, mdModeEl, htmlModeEl].forEach(el => {
    el.addEventListener('change', () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 200); });
  });
}
