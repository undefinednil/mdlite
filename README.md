# mdlite

A desktop app for browsing, searching and editing a folder of Markdown notes. Built with Tauri: the UI is React, the filesystem work is native Rust. No server, no browser tab.

## Run

Requires Node 20+, Rust (`rustup`), and the Xcode command line tools on macOS (or the MSVC build tools on Windows).

```bash
npm install
npm run dev          # dev window with hot reload
```

Build a release bundle:

```bash
npm run bundle   # .app on macOS, NSIS installer on Windows
```

The macOS bundle lands in `src-tauri/target/release/bundle/macos/mdlite.app` (~23 MB). Open it with `open src-tauri/target/release/bundle/macos/mdlite.app`, or drag it to `/Applications`.

Other targets: `bundle:win`, `bundle:win:msi`, `bundle:dmg`.

`bundle:dmg` needs a signed-in desktop session because it drives Finder through AppleScript.

### Building for Windows

Windows builds must run on Windows; Tauri does not cross-compile.

1. Install the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload. This provides the linker and resource compiler Rust needs; you do not write any C or C++.
2. Install Rust from [rustup.rs](https://rustup.rs) and Node 20+.
3. Run `npm ci` then `npm run bundle`.

The installer lands in `src-tauri/target/release/bundle/nsis/mdlite_0.1.0_x64-setup.exe`. WebView2 is preinstalled on Windows 10 and 11.

`.github/workflows/desktop.yml` runs the same build on `windows-latest` and `macos-latest` and uploads both bundles, so a tag produces a Windows installer without a Windows machine.

## How it is put together

The Rust process owns the filesystem; the webview only renders the UI.

```
src-tauri/            Rust backend
  src/paths.rs        path jail and ignore rules
  src/tree.rs         directory walk with sizes and mtimes
  src/files.rs        read, write with mtime conflict, trash, uploads
  src/search.rs       ripgrep wrapper plus a pure-Rust fallback
  src/watch.rs        recursive watcher, debounced, emits fs-change
  src/state.rs        root folders persisted to ~/.mdlite.json
  src/lib.rs          17 Tauri commands
src/                  React app
  api.ts              the only seam: invoke() calls into Rust
  components/         FileTree, FolderView, MarkdownView, MediaView,
                      ExcalidrawView, Editor, Palette, SettingsView, DialogHost
  lib/                markdown pipeline, path helpers, vimrc parser
```

Images and video are served through Tauri's `asset://` protocol, because a webview cannot load `file://`.

## Root folders

Open the gear button in the sidebar to manage roots. "Browse…" opens a native folder picker. Add as many roots as you like, switch between them, and remove entries. The active root determines what the tree, search, editor and file operations act on. The list is stored in `~/.mdlite.json` (`MDLITE_CONFIG` moves it); `MDLITE_ROOT` seeds the first entry.

## Keyboard

| Keys | Action |
|---|---|
| `⌃E` | Fuzzy find a file |
| `⌃G` | Search file contents (grep) |
| `⌃N` / `⌃P` | Move down / up in the tree, folder table and finder |
| `⌃Tab` | Cycle through the last 5 opened files; release Ctrl to open the highlighted one (`⌃⇧Tab` goes backwards) |
| `j` `k` `h` `l` `g` `G` | Tree navigation: down, up, collapse, expand, top, bottom |
| `Space` | Tree: expand or collapse the highlighted folder |
| `⌃←` | Tree: collapse every folder |
| `a` `r` `d` | Tree: new file (end with `/` for a folder), rename, move to trash (all selected rows when several are selected) |
| `Shift`-click / `⌘`-click | Tree: select a range / toggle one row |
| `⌘A` / `Ctrl+A` / `Esc` | Tree: select all visible rows / clear the selection |
| `x` `y` `p` `u` | Tree: cut, copy, paste, undo the last file operation |
| `j` / `k` | Scroll the page in view mode; move the cursor in the folder table |
| `⌃H` / `⌃L` | Focus the file tree / the main area |
| `⌃⇧V` | Toggle edit / view (also `⌃⇧E`) |
| `⌃S` | Save |
| `⌃D` / `⌃U` | Jump to the bottom / top of the screen and centre |
| `⌃F` / `⌃B` | Page down / up |
| `Esc` | Close a dialog or the finder |

## Behaviour

- **Folder browsing:** the main area is a table of the current folder with Name, Kind, Size and Modified columns, sortable by clicking a header. Breadcrumbs sit above it. Clicking a folder in the table or the tree enters it; `j`/`k` move the cursor and `Enter` opens.
- **Sidebar tree:** shift-click selects a range, `⌘`-click or `Ctrl`-click toggles one row, and `d` moves every selected row to the trash in one step. Plain click clears the selection. Lists the whole vault, loads once and filters client-side. Filtering keeps the tree shape: matching files stay under their folders, and folders with matches open automatically. Sort by name or modified. Filters: path text in `contains` / `glob` / `regex` mode, kind chips (md, code, data, image, draw, other), a modified-date range, and file size buckets.
- **File types:** Markdown renders with Mermaid and Shiki. Code and text files open straight into the editor with syntax highlighting. Images open in place. Excalidraw drawings open in the full editor (loaded on demand). SVG has view and edit modes. Anything else offers to open it in the default app.
- **Temporary files:** drag a file from the desktop onto the window to open it without touching the vault. The header shows a `temporary` badge; `⌃S` exports it instead of writing to disk.
- **Media:** in the editor, paste or drop an image or video, or use the attach button in the header. Files are saved to an `images/` folder next to the note and inserted as Markdown. Videos render with controls.
- **Resize in the preview:** drag the corner handle on an image to set its width (saved into the Markdown as `{width=N}`); drag a column edge in a table to size columns (remembered per file).
- **Copy:** the header copy button copies styled rich text in view mode and the raw Markdown in edit mode.
- **Editing:** CodeMirror with Vim keybindings and soft wrap.
- **vimrc:** `~/.vimrc` is read and applied: every mapping (`map`, `noremap`, `nmap`, `nnoremap`, `vmap`, `vnoremap`, `xmap`, `xnoremap`, `omap`, `onoremap`, `imap`, `inoremap`, including `<leader>` and `<silent>`), plus `set` options for tab size, indentation, line numbers and cursor line. `:w`, `:update` and `<C-s>` save. The `vim` badge tooltip lists what was applied.
- **View and edit share a scroll position:** switching modes keeps your place, measured as a fraction of the document height.
- **Auto-save:** leaving the editor saves unsaved changes automatically, with the same modification-time conflict check as an explicit save.
- **Conflicts:** if a file changes on disk while you are editing, the app offers reload or overwrite.
- **Live updates:** the watcher pushes changes, so edits made elsewhere appear without a refresh.
- Hidden folders, `.git`, `node_modules`, `.obsidian` and `dist` are ignored.

## Icons

`src-tauri/icon_base.png` is the source artwork. Run `npm run icons` to rebuild the app icon, the platform icon set and the transparent sidebar logo.

## Notes

The bundle is unsigned. It runs locally without a prompt because nothing marks it as downloaded; copying it to another Mac will require right-click → Open, or a Developer ID signature plus notarization.
