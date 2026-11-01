# mdlite

A small local web server that reads a folder of Markdown files and serves it as a browsable, editable site. Built for a notes vault.

## Run

Requires Node.js 20 or newer (the server runs TypeScript through `tsx`).

```bash
npm install
npm run dev      # api on :4747, ui on http://localhost:5173
```

Or build the UI and serve everything from one port:

```bash
npm run build
npm start        # http://127.0.0.1:4747
```

The server binds to `127.0.0.1` only.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MDLITE_ROOT` | `~/git/notes` | Seeds the first root folder |
| `MDLITE_CONFIG` | `~/.mdlite.json` | Where the root list is stored |
| `PORT` | `4747` | API and production UI port |

```bash
MDLITE_ROOT=/path/to/vault PORT=5000 npm start
```

### Root folders

Open the gear button in the sidebar to manage roots. You can add any absolute path on the machine running the server, switch between them, and remove entries. The active root changes what the tree, search, editor and file operations act on, and is persisted in `~/.mdlite.json`.

The server binds to `127.0.0.1`. If you expose it to a network, put authentication in front of it: anyone who can reach it can read and write every folder you have added.

## Install as an app

The UI ships a web app manifest and a service worker, so browsers offer to install it. The service worker caches the app shell (HTML, JS, CSS, icons) and never caches `/api/` responses, so file operations always hit the server. Serve it over HTTPS for the install prompt outside localhost.

## Keyboard

| Keys | Action |
|---|---|
| `⌃E` | Fuzzy find a file |
| `⌃G` | Search file contents (grep) |
| `⌃N` / `⌃P` | Move down / up in the tree, folder table and finder |
| `j` `k` `h` `l` `g` `G` | Tree navigation: down, up, collapse, expand, top, bottom |
| `a` `r` `d` | Tree: new file (end with `/` for a folder), rename, move to trash |
| `x` `y` `p` `u` | Tree: cut, copy, paste, undo the last file operation |
| `⌃⇧V` | Toggle edit / view (also `⌃⇧E`) |
| `⌃H` / `⌃L` | Focus the file tree / the main area |
| `⌃⇧C` | Not bound; use the copy button in the header |
| `⌃←` | Tree: collapse every folder |
| `j` / `k` | Scroll the page in view mode; move the cursor in the folder table |
| `Space` | Tree: expand or collapse the highlighted folder |
| `⌃S` | Save |
| `⌃D` / `⌃U` | Jump to the bottom / top of the screen and centre |
| `⌃F` / `⌃B` | Page down / up |
| `Esc` | Close the search overlay |

`⌘` works as well as `⌃`. The floating button in the bottom right also toggles edit and view.

## Behaviour

- **Folder browsing:** the main area is a table of the current folder with Name, Kind, Size and Modified columns, sortable by clicking a header. Breadcrumbs sit above it. Clicking a folder in the table or the tree enters it; `j`/`k` move the cursor and `Enter` opens.
- **Sidebar tree:** lists the whole vault, loads once and filters client-side. Filtering keeps the tree shape: matching files stay under their folders, and folders with matches open automatically. Sort by name or modified. Filters: path text in `contains` / `glob` / `regex` mode, kind chips (md, code, data, image, draw, other), recent 1/7/30/90 days, and file size buckets.
- **Temporary files:** drag a file from the desktop onto the window to open it without touching the vault. The header shows a `temporary` badge; `⌃S` downloads it instead of writing to disk.
- **File types:** Markdown renders with Mermaid and Shiki. Code and text files open in a highlighted read-only view and can be edited. Images open in place. Excalidraw drawings open straight into the full editor (loaded on demand and always editable). Anything else offers a raw download.
- **View and edit share a scroll position:** switching modes keeps your place, measured as a fraction of the document height.
- **Auto-save:** leaving the editor saves unsaved changes automatically, with the same modification-time conflict check as an explicit save.
- **Media:** in the editor, paste or drop an image or video, or use the attach button in the header. Files are uploaded to an `images/` folder next to the note and inserted as Markdown. Videos render with controls in the preview.
- **Resize in the preview:** drag the corner handle on an image to set its width (saved into the Markdown as `{width=N}`); drag a column edge in a table to size columns (remembered per file in the browser).
- **Copy:** the header copy button copies styled rich text in view mode and the raw Markdown in edit mode.
- **Editing:** CodeMirror with Vim keybindings and soft wrap. Code and text files open straight into the editor with syntax highlighting; Markdown and SVG keep a view mode with the floating toggle. Images are view only.
- **vimrc:** the server reads `~/.vimrc` and the app applies it: every mapping (`map`, `noremap`, `nmap`, `nnoremap`, `vmap`, `vnoremap`, `xmap`, `xnoremap`, `omap`, `onoremap`, `imap`, `inoremap`, including `<leader>` and `<silent>`), plus `set` options for tab size, indentation, line numbers and cursor line. `:w`, `:update` and `<C-s>` save the open file. The `vim` badge tooltip lists how many mappings and option lines were applied and which lines a browser editor cannot honour.
- **Find and search:** file names are fuzzy matched; content is searched with ripgrep, falling back to a built-in scanner when `rg` is unavailable.
- **Links:** relative images and links resolve against the open file, and Markdown links open inside the app.
- **Conflicts:** saves send the modification time the file was read with. If the file changed on disk meanwhile, the server returns 409 and the UI offers reload or overwrite.
- **Live updates:** the server watches the vault and pushes changes over server-sent events, so edits made elsewhere appear without a refresh.
- Hidden folders, `.git`, `node_modules`, `.obsidian` and `dist` are ignored.

## Layout

```
server/
  index.ts    routes, sse, static files
  fs.ts       path jail, tree, read/write with conflict check
  search.ts   ripgrep wrapper and fallback scanner
  watch.ts    recursive fs watch with debounce
shared/       types and fuzzy matching used by both sides
src/          react app
  components/ FileTree, FolderView, MarkdownView, CodeView, MediaView,
              ExcalidrawView, Editor, Palette
  lib/        markdown pipeline, path and file-kind helpers, vimrc parser
```

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/info` | Root path and name |
| `GET` | `/api/tree` | Full tree with size and mtime |
| `GET` | `/api/file?path=` | Raw text plus mtime |
| `PUT` | `/api/file` | Save `{path, content, mtime, force?}` |
| `GET` | `/api/raw?path=` | Raw bytes for images |
| `GET` | `/api/search?mode=grep&q=` | Content matches with line numbers |
| `GET` | `/api/search?mode=fuzzy&q=` | Ranked paths |
| `POST` | `/api/upload` | Store an image or video next to a note |
| `POST` | `/api/create` | Create a file or folder `{path, type}` |
| `POST` | `/api/rename` | Rename in place `{path, name}` |
| `POST` | `/api/transfer` | Copy or move `{from, to, copy}` |
| `POST` | `/api/trash` | Move to `.mdlite-trash` |
| `POST` | `/api/restore` | Restore from trash `{from, to}` |
| `GET` | `/api/vimrc` | Contents of `~/.vimrc` |
| `GET` | `/api/events` | SSE change notifications |

All paths are relative to the root and rejected if they resolve outside it.
