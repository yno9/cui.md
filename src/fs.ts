import { st } from './state';
import { CFG_PATH, appConfig, applyConfig, BINARY_EXT, EXCLUDE_EXT, isExcluded } from './config';

export const customStyleEl = document.createElement('style');
customStyleEl.id = 'custom-css';
document.head.appendChild(customStyleEl);

export async function loadCustomCss() {
  try {
    const text = await st.backend!.readFile('custom.css');
    customStyleEl.textContent = text;
  } catch {}
}

export async function loadPlugin() {
  try {
    const code = await st.backend!.readFile('plugin.js');
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const script = document.createElement('script');
    script.src = url;
    script.addEventListener('load', () => URL.revokeObjectURL(url));
    document.head.appendChild(script);
  } catch {}
}

export async function loadConfig() {
  try {
    const text = await st.backend!.readFile(CFG_PATH);
    st.fileContentCache.set(CFG_PATH, text);
    applyConfig(JSON.parse(text));
  } catch { applyConfig({}); }
}

export async function saveConfig(json: string) {
  await writeFile(CFG_PATH, json);
  try { applyConfig(JSON.parse(json)); } catch {}
}

export function parseFrontmatterTitle(text: string): string {
  if (!text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 3);
  const block = end === -1 ? text.slice(3) : text.slice(3, end);
  for (const line of block.split('\n')) {
    const m = line.match(/^[^:]+:\s*(.+)/);
    if (m) return m[1].trim();
  }
  return '';
}

export function parseFrontmatter(content: string): Record<string, any> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, any> = {};
  const yaml = match[1];
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: any = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((v: string) => v.trim().replace(/['"]/g, ''));
    } else if (value === '') {
      const listItems: string[] = [];
      const lines = yaml.split('\n');
      const keyIndex = lines.findIndex(l => l.startsWith(key + ':'));
      for (let i = keyIndex + 1; i < lines.length; i++) {
        if (lines[i].startsWith('  - ')) listItems.push(lines[i].replace('  - ', '').trim());
        else if (!lines[i].startsWith(' ')) break;
      }
      if (listItems.length > 0) value = listItems;
    }
    result[key] = value;
  }
  return result;
}

export async function readFile(relPath: string): Promise<string> {
  if (st.fileContentCache.has(relPath)) return st.fileContentCache.get(relPath)!;
  const text = await st.backend!.readFile(relPath);
  st.fileContentCache.set(relPath, text);
  return text;
}

export async function writeFile(relPath: string, content: string): Promise<void> {
  await st.backend!.writeFile(relPath, content);
  st.fileContentCache.set(relPath, content);
}

export async function scanOneLevel(baseDir: string): Promise<any[]> {
  const entries = await st.backend!.listDir(baseDir);
  return entries.filter(e => !isExcluded(e.name));
}

// ── Unused exports kept for plugin API compatibility ──────────────────────

export const BINARY_EXT_RE = BINARY_EXT;
export const EXCLUDE_EXT_RE = EXCLUDE_EXT;
