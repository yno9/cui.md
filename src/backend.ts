// Shared backend interface + WebDAV implementation.
// FSABackend (File System Access API) lives in fsa.ts.

export interface DirEntry {
  name: string
  path: string   // vault-relative, no leading slash
  type: 'file' | 'directory'
  mtime: Date
  tags?: string[]
  category?: string
}

export interface IBackend {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  deleteEntry(path: string): Promise<void>
  createDir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  listDir(vaultPath: string): Promise<DirEntry[]>
  /** FSA-only: returns a FileSystemFileHandle; undefined in WebDAV mode */
  getFileHandle?(path: string): Promise<any>
  /** FSA-only: handle cache for cheap re-access */
  readonly pathHandleMap?: Map<string, any>
}

export class WebDAVBackend implements IBackend {
  constructor(public base: string) {} // e.g. '/dav'

  // ── URL helpers ──────────────────────────────────────────────────────────

  url(vaultPath: string): string {
    const clean = vaultPath.replace(/^\//, '')
    return clean
      ? `${this.base}/${clean.split('/').map(encodeURIComponent).join('/')}`
      : `${this.base}/`
  }

  // ── File I/O ─────────────────────────────────────────────────────────────

  async readFile(path: string): Promise<string> {
    const r = await fetch(this.url(path), { cache: 'no-store' })
    if (!r.ok) throw new Error(`DAV GET ${path}: ${r.status}`)
    return r.text()
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Ensure parent directories exist first
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      await fetch(`${this.base}/${dir}/`, { method: 'MKCOL' }) // ignore errors
    }
    const r = await fetch(this.url(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content,
    })
    if (!r.ok) throw new Error(`DAV PUT ${path}: ${r.status}`)
  }

  async deleteEntry(path: string): Promise<void> {
    await fetch(this.url(path), { method: 'DELETE' })
  }

  async createDir(path: string): Promise<void> {
    await fetch(`${this.base}/${path}/`, { method: 'MKCOL' })
  }

  async rename(from: string, to: string): Promise<void> {
    const dest = `${window.location.origin}${this.base}/${to}`
    const r = await fetch(this.url(from), {
      method: 'MOVE',
      headers: { 'Destination': dest, 'Overwrite': 'F' },
    })
    if (r.status === 412) throw new Error('A file with that name already exists.')
    if (!r.ok) throw new Error(`Rename failed: ${r.status}`)
  }

  // ── Directory listing via PROPFIND ───────────────────────────────────────

  async listDir(vaultPath: string): Promise<DirEntry[]> {
    const url = vaultPath ? `${this.base}/${vaultPath}/` : `${this.base}/`
    const r = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        'Depth': '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:getlastmodified/></D:prop></D:propfind>`,
    })
    if (!r.ok) return []
    const xml = await r.text()
    return parsePropfind(xml, vaultPath, this.base)
  }
}

// ── PROPFIND XML parser ─────────────────────────────────────────────────────

function parsePropfind(xml: string, baseDir: string, davBase: string): DirEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const responses = [...doc.getElementsByTagNameNS('DAV:', 'response')]
  if (responses.length === 0) return []

  const selfHref = davBase + (baseDir ? '/' + baseDir : '') + '/'
  const entries: DirEntry[] = []

  for (const resp of responses) {
    const hrefEl = resp.getElementsByTagNameNS('DAV:', 'href')[0]
    const rawHref = hrefEl?.textContent?.trim() ?? ''
    const href = decodeURIComponent(rawHref)

    if (href === selfHref || href === selfHref.slice(0, -1)) continue

    const stripped = href.startsWith(davBase + '/')
      ? href.slice(davBase.length + 1).replace(/\/$/, '')
      : href.replace(/\/$/, '')

    if (!stripped) continue

    const isDir = resp.getElementsByTagNameNS('DAV:', 'collection').length > 0
      || rawHref.endsWith('/')
    const lastModEl = resp.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]
    const mtime = lastModEl ? new Date(lastModEl.textContent ?? '') : new Date(0)
    const name = stripped.split('/').pop() || stripped

    entries.push({ name, path: stripped, type: isDir ? 'directory' : 'file', mtime })
  }

  return entries
}
