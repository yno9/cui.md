import { st } from './state';

export let EXCLUDE = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv']);
export let EXCLUDE_EXT = new Set<string>();
export let EXCLUDE_PATTERNS: RegExp[] = [];

export const BINARY_EXT = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.avif','.svg','.ico','.bmp','.tiff','.heic','.heif','.raw','.nef','.cr2','.psd','.ai','.eps','.sketch','.fig',
  '.mp4','.mov','.avi','.mkv','.webm','.m4v','.mts','.mp3','.wav','.ogg','.flac','.aac','.m4a',
  '.pdf','.zip','.tar','.gz','.bz2','.7z','.rar','.dmg','.pkg','.exe','.dll','.iso','.bin',
  '.woff','.woff2','.ttf','.otf','.eot',
  '.db','.sqlite','.parquet','.pyc','.o','.a','.so','.dylib','.dat',
  '.doc','.docx','.xls','.xlsx','.ppt','.pptx','.numbers','.pages','.key',
]);

export const CFG_PATH = 'doucot.json';
export const CM5_KEY = 'webmd-cm5';
export const SESSION_KEY = 'webmd-session';
export const FILE_MODE_KEY = 'webmd-file-mode';
export const SORT_STATES = [
  { by: 'mtime', order: 'desc', label: 'Modified ↓' },
  { by: 'mtime', order: 'asc',  label: 'Modified ↑' },
  { by: 'name',  order: 'asc',  label: 'Name ↑' },
  { by: 'name',  order: 'desc', label: 'Name ↓' },
];

export const DEFAULT_CONFIG = {
  autosaveDelay: 30,
  exclude: ['node_modules', '.git', '.tin', '__pycache__', '.venv', 'venv'],
  sortBy: 'mtime',
  sortOrder: 'desc',
  defaultMdMode: 'edit',
  defaultHtmlMode: 'preview',
  autoIndex: false,
  hotkeys: {
    save: 'cmd+s',
    sidebar: 'cmd+b',
    open: 'cmd+o',
    togglePreview: 'cmd+e',
    newItem: 'cmd+shift+n',
    settings: 'cmd+,',
  },
};

export let appConfig: any = { ...DEFAULT_CONFIG };

export function applyConfig(cfg: any) {
  appConfig = { ...DEFAULT_CONFIG, ...cfg };
  appConfig.hotkeys = { ...DEFAULT_CONFIG.hotkeys, ...(cfg.hotkeys || {}) };
  if ((appConfig.hotkeys as any).newItem === 'cmd+n') (appConfig.hotkeys as any).newItem = 'cmd+shift+n';
  if (Array.isArray(appConfig.exclude)) {
    const plain = appConfig.exclude.filter((e: string) => !e.includes('*') && !e.includes('?'));
    EXCLUDE = new Set(plain);
    EXCLUDE_EXT = new Set(plain.filter((e: string) => e.startsWith('.')));
    EXCLUDE_PATTERNS = appConfig.exclude.filter((e: string) => e.includes('*') || e.includes('?')).map(globToRegex);
  }
  if (appConfig.sortBy) st.sortBy = appConfig.sortBy;
  if (appConfig.sortOrder) st.sortOrder = appConfig.sortOrder;
}

export function isExcluded(name: string): boolean {
  if (EXCLUDE.has(name)) return true;
  if (EXCLUDE_PATTERNS.some(p => p.test(name))) return true;
  return false;
}

export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export function matchHotkey(e: KeyboardEvent, hk: string): boolean {
  if (!hk) return false;
  const parts = hk.toLowerCase().split('+');
  const needsCmd = parts.includes('cmd') || parts.includes('ctrl');
  const needsShift = parts.includes('shift');
  const needsAlt = parts.includes('alt');
  const key = parts[parts.length - 1];
  return (e.metaKey || e.ctrlKey) === needsCmd &&
    e.shiftKey === needsShift &&
    e.altKey === needsAlt &&
    e.key.toLowerCase() === key;
}

export function formatHotkey(hk: string): string {
  return hk.split('+').map(p =>
    p === 'cmd' ? '⌘' : p === 'shift' ? '⇧' : p === 'alt' ? '⌥' : p.toUpperCase()
  ).join('');
}

export function getFileModePrefs(): Record<string, 'edit' | 'preview'> {
  try { return JSON.parse(localStorage.getItem(FILE_MODE_KEY) || '{}'); } catch { return {}; }
}
export function getFilePref(path: string): 'edit' | 'preview' | null {
  return getFileModePrefs()[path] ?? null;
}
export function setFilePref(path: string, mode: 'edit' | 'preview') {
  const prefs = getFileModePrefs();
  prefs[path] = mode;
  localStorage.setItem(FILE_MODE_KEY, JSON.stringify(prefs));
}
