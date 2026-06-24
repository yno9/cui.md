import type { IBackend, DirEntry } from './backend'
import { BINARY_EXT, EXCLUDE_EXT, isExcluded } from './config'
import { parseFrontmatter } from './fs'

const FSA_INVALID = /[*<>?\\:|"]/

export function hasFSAInvalidChars(name: string): boolean {
  return FSA_INVALID.test(name)
}

export class FSABackend implements IBackend {
  readonly pathHandleMap = new Map<string, any>()

  constructor(readonly rootHandle: any) {}

  private async _dirHandle(relPath: string): Promise<any> {
    if (!relPath) return this.rootHandle
    const parts = relPath.split('/')
    let dir = this.rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    return dir
  }

  async getFileHandle(relPath: string): Promise<any> {
    if (this.pathHandleMap.has(relPath)) return this.pathHandleMap.get(relPath)
    const parts = relPath.split('/')
    let dir = this.rootHandle
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i])
    const h = await dir.getFileHandle(parts[parts.length - 1])
    this.pathHandleMap.set(relPath, h)
    return h
  }

  async readFile(path: string): Promise<string> {
    return (await (await this.getFileHandle(path)).getFile()).text()
  }

  async writeFile(path: string, content: string): Promise<void> {
    const parts = path.split('/')
    let dir = this.rootHandle
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create: true })
    const h = await dir.getFileHandle(parts[parts.length - 1], { create: true })
    this.pathHandleMap.set(path, h)
    const w = await h.createWritable()
    await w.write(content)
    await w.close()
  }

  async deleteEntry(path: string): Promise<void> {
    const parts = path.split('/')
    const name = parts[parts.length - 1]
    const parentDir = parts.slice(0, -1).join('/')
    const parentH = await this._dirHandle(parentDir)
    await parentH.removeEntry(name, { recursive: true })
    this.pathHandleMap.delete(path)
  }

  async createDir(path: string): Promise<void> {
    const parts = path.split('/')
    let dir = this.rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
  }

  async rename(from: string, to: string): Promise<void> {
    const content = await this.readFile(from)
    await this.writeFile(to, content)
    const fromParts = from.split('/')
    const fromName = fromParts[fromParts.length - 1]
    const fromParent = fromParts.slice(0, -1).join('/')
    const parentH = await this._dirHandle(fromParent)
    await parentH.removeEntry(fromName)
    this.pathHandleMap.delete(from)
  }

  async listDir(vaultPath: string): Promise<DirEntry[]> {
    const dirHandle = await this._dirHandle(vaultPath)
    const entries: DirEntry[] = []
    for await (const [name, handle] of dirHandle.entries()) {
      if (isExcluded(name)) continue
      const relPath = vaultPath ? `${vaultPath}/${name}` : name
      if (handle.kind === 'directory') {
        entries.push({ name, path: relPath, type: 'directory', mtime: new Date(0) })
      } else {
        const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : ''
        if (BINARY_EXT.has(ext) || EXCLUDE_EXT.has(ext)) continue
        const file = await handle.getFile()
        const entry: DirEntry = { name, path: relPath, type: 'file', mtime: new Date(file.lastModified) }
        if (ext === '.md') {
          try {
            const content = await file.text()
            const fm = parseFrontmatter(content)
            if (fm.tags) entry.tags = Array.isArray(fm.tags) ? fm.tags : [fm.tags]
            if (fm.category) entry.category = fm.category
          } catch {}
        }
        this.pathHandleMap.set(relPath, handle)
        entries.push(entry)
      }
    }
    return entries
  }
}
