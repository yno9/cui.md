import { st } from './state';
import { BINARY_EXT, EXCLUDE_EXT, isExcluded } from './config';
import { readFile } from './fs';
import { escapeHtml } from './editor';

export function parseLinks(content: string): { wikilinks: Set<string>; mdlinks: Set<string> } {
  const wikilinks = new Set<string>();
  const mdlinks = new Set<string>();
  const wikiRe = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wikiRe.exec(content)) !== null) {
    const name = m[1].trim();
    if (name) wikilinks.add(name);
  }
  const mdRe = /(^|[^!])\[([^\]]+)\]\(([^)]+)\)/g;
  while ((m = mdRe.exec(content)) !== null) {
    let url = m[3].trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) continue;
    url = url.split('#')[0].split('?')[0];
    if (url) mdlinks.add(url);
  }
  return { wikilinks, mdlinks };
}

export function resolveMdLinks(sourceRelPath: string, mdlinks: Set<string>): Set<string> {
  const fileDir = sourceRelPath.includes('/') ? sourceRelPath.split('/').slice(0, -1).join('/') : '';
  const resolved = new Set<string>();
  for (const url of mdlinks) {
    let p = url.startsWith('/') ? url.slice(1) : (fileDir ? `${fileDir}/${url}` : url);
    p = p.replace(/\\/g, '/');
    resolved.add(p);
  }
  return resolved;
}

export async function buildLinkIndex() {
  if (st._linkIndexRunning) return;
  st._linkIndexRunning = true;
  st.wikilinksFrom.clear();
  st.mdlinksFrom.clear();
  st.fileBaseIndex.clear();
  st.allFilesMeta = [];
  st.backend?.pathHandleMap?.clear();

  async function scanRecursive(base: string) {
    const entries = await st.backend!.listDir(base);
    for (const entry of entries) {
      if (isExcluded(entry.name)) continue;
      if (entry.type === 'directory') {
        await scanRecursive(entry.path);
      } else {
        const ext = entry.name.includes('.') ? '.' + entry.name.split('.').pop()!.toLowerCase() : '';
        if (BINARY_EXT.has(ext) || EXCLUDE_EXT.has(ext)) continue;
        const meta: any = { name: entry.name, path: entry.path, mtime: entry.mtime }
        if (entry.tags) meta.tags = entry.tags;
        if (ext === '.md') {
          const base2 = entry.name.replace(/\.md$/, '');
          if (!st.fileBaseIndex.has(base2)) st.fileBaseIndex.set(base2, []);
          st.fileBaseIndex.get(base2)!.push(entry.path);
        }
        st.allFilesMeta.push(meta);
      }
    }
  }

  try {
    await scanRecursive('');
    st.allFilesMeta.sort((a, b) => b.mtime - a.mtime);
    st.linkIndexBuilt = true;
  } finally {
    st._linkIndexRunning = false;
  }
}

export async function updateLinkIndexForFile(relPath: string) {
  if (!relPath.endsWith('.md')) return;
  const base = relPath.split('/').pop()!.replace(/\.md$/, '');
  const arr = st.fileBaseIndex.get(base) || [];
  if (!arr.includes(relPath)) { arr.push(relPath); st.fileBaseIndex.set(base, arr); }
  try {
    const content = await readFile(relPath);
    const { wikilinks, mdlinks } = parseLinks(content);
    if (wikilinks.size) st.wikilinksFrom.set(relPath, wikilinks); else st.wikilinksFrom.delete(relPath);
    if (mdlinks.size) st.mdlinksFrom.set(relPath, resolveMdLinks(relPath, mdlinks)); else st.mdlinksFrom.delete(relPath);
  } catch {}
}

export async function markBrokenWikilinks() {
  const preview = document.getElementById('preview')!;
  const links = preview.querySelectorAll<HTMLElement>('a.wikilink');
  const names = [...new Set([...links].map(a => a.dataset.wiki!))];
  if (!names.length) return;
  const existing = new Map<string, string[]>();
  for (const name of names) {
    const matches = st.fileBaseIndex.get(name);
    if (matches && matches.length) existing.set(name, matches);
  }
  links.forEach(a => {
    const name = a.dataset.wiki!;
    if (!existing.has(name)) a.classList.add('broken');
    else a.dataset.target = existing.get(name)![0];
  });
}

export async function loadBacklinks(path: string) {
  const el = document.getElementById('backlinks')!;
  if (!path.endsWith('.md')) { el.style.display = 'none'; return; }
  if (!st.linkIndexBuilt) { el.style.display = 'none'; return; }

  const targetBase = path.split('/').pop()!.replace(/\.md$/, '');
  const map = new Map<string, string>();
  for (const [src, names] of st.wikilinksFrom.entries()) {
    if (src === path) continue;
    if (names.has(targetBase)) map.set(src, 'wiki');
  }
  for (const [src, paths] of st.mdlinksFrom.entries()) {
    if (src === path) continue;
    if (paths.has(path)) map.set(src, map.has(src) ? 'both' : 'md');
  }

  if (!map.size) { el.style.display = 'none'; return; }
  const items = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([source, type]) => {
    const label = type === 'wiki' ? '[[ ]]' : type === 'md' ? '[md]' : '[[ ]]+md';
    return `<li><span class="bl-type">${label}</span><a href="#" data-bl-target="${escapeHtml(source)}">${escapeHtml(source)}</a></li>`;
  }).join('');
  el.innerHTML = `<h4>📎 Backlinks (${map.size})</h4><ul>${items}</ul>`;
  el.style.display = 'block';
  el.querySelectorAll<HTMLAnchorElement>('a[data-bl-target]').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); (window as any).loadFile(a.dataset.blTarget); };
  });
}

export async function loadTags() {
  const select = document.getElementById('tagFilter');
  if (!select) return;
  const tagMap = new Map<string, number>();
  for (const f of st.allFilesMeta) {
    if (f.tags) for (const t of f.tags) tagMap.set(t, (tagMap.get(t) || 0) + 1);
  }
  while ((select as HTMLSelectElement).options.length > 1) (select as HTMLSelectElement).remove(1);
  [...tagMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = `${tag} (${count})`;
    select.appendChild(opt);
  });
}
