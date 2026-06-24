# cui.md


A portable text editor packed into a single HTML file. Works offline via FSAA (File System Access API) or remotely via WebDAV.


## Getting started

- **FSAA (local) mode** : Download and open [docs/index.html](https://github.com/yno9/cui.m/blob/main/docs/index.html) or try [cui.md](https://cui.md) in any Chromium browser.
- **WebDAV (remote) mode** : Serve `docs/index.html` over HTTP and expose a WebDAV endpoint at `/dav/`.

## Features

- File preview and edit with syntax highlighting
- Create, rename, and delete files and folders
- File search by name and content
- `config.json` and `custom.css` in the vault root for customization
- Vim keybindings support

## Config example

```json
{
  "autosaveDelay": 30,
  "exclude": ["node_modules", ".git", "__pycache__", ".venv"],
  "sortBy": "name",
  "sortOrder": "asc",
  "defaultMdMode": "edit",
  "defaultHtmlMode": "preview",
  "autoIndex": false,
  "showFrontmatter": false,
  "hotkeys": {
    "save": "cmd+s",
    "sidebar": "cmd+b",
    "open": "cmd+o",
    "togglePreview": "cmd+e",
    "newItem": "cmd+shift+n",
    "settings": "cmd+,"
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `autosaveDelay` | `30` | Seconds after last edit before auto-save. |
| `exclude` | see above | Names to hide from the sidebar. Supports `*` and `?` globs. |
| `sortBy` | `"name"` | `"name"` or `"mtime"`. |
| `sortOrder` | `"asc"` | `"asc"` or `"desc"`. |
| `defaultMdMode` | `"edit"` | Initial mode for `.md` files: `"edit"` or `"preview"`. |
| `defaultHtmlMode` | `"preview"` | Initial mode for `.html` files: `"edit"` or `"preview"`. |
| `autoIndex` | `false` | Read all `.md` files into memory at startup so search covers the full vault immediately. |
| `showFrontmatter` | `false` | Show YAML frontmatter in preview. |
| `hotkeys` | see above | Override shortcuts. Format: `"cmd+key"`, `"ctrl+key"`, `"cmd+shift+key"`, etc. |

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `⌘S` / `Ctrl+S` | Save |
| `⌘B` / `Ctrl+B` | Toggle sidebar |
| `⌘E` / `Ctrl+E` | Switch preview / edit |
| `⌘O` / `Ctrl+O` | Open vault |
| `⌘⇧N` / `Ctrl+Shift+N` | New file or folder |
| `⌘,` / `Ctrl+,` | Settings |
| `⌘↩` / `Ctrl+Enter` | Rename file |
| `↑` `↓` `←` `→` or `h` `j` `k` `l` | Navigate file list |

## Building from source

Requires Node.js.

```bash
npm install
node build.js
```

Output: `docs/index.html` (~468 KB, single self-contained file).

## License

GNU Affero General Public License v3.0 (AGPL-3.0).
