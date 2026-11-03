# mdlite

A desktop app for browsing, searching and editing a folder of Markdown notes. Built with Tauri: the UI is React, the filesystem work is native Rust. No server, no browser tab.

## Docs

The [documentation index](docs/README.md) is the canonical list. It gives the reading order and says which page owns each topic. Start with [Features](docs/features.md) to use the app, [Architecture](docs/architecture.md) to see how it works, and [Development](docs/development.md) to build it.

## Run

Requires Node `^20.19.0` or `>=22.12.0`, Rust 1.77+ (`rustup`), and the Xcode command line tools on macOS (or the MSVC build tools on Windows).

```bash
npm install
npm run dev          # dev window with hot reload
```

Build a release bundle:

```bash
npm run bundle   # .app on macOS, NSIS installer on Windows
```

The macOS bundle lands in `src-tauri/target/release/bundle/macos/mdlite.app` (~23 MB). Open it with `open src-tauri/target/release/bundle/macos/mdlite.app`, or drag it to `/Applications`.

Other targets: `bundle:win`, `bundle:win:msi`, `bundle:dmg`. `bundle:dmg` needs a signed-in desktop session because it drives Finder through AppleScript.

Windows builds must run on Windows; Tauri does not cross-compile. The NSIS installer lands in `src-tauri/target/release/bundle/nsis/`, and CI builds both bundles on a tag. See [Development](docs/development.md) for the Windows prerequisites and bundle commands.

## How it is put together

The Rust process owns the filesystem; the webview only renders the UI.

```
src-tauri/            Rust backend
  src/paths.rs        path jail and ignore rules
  src/tree.rs         directory walk with sizes and mtimes
  src/files.rs        read, write with mtime conflict, trash, uploads
  src/search.rs       ripgrep wrapper plus a pure-Rust fallback
  src/watch.rs        recursive watcher, debounced, emits fs-change
  src/settings.rs     editor settings and shortcut overrides
  src/state.rs        roots and settings persisted to the config file
  src/lib.rs          21 Tauri commands
src/                  React app
  api.ts              the only seam: invoke() calls into Rust
  components/         FileTree, FolderView, MarkdownView, MediaView,
                      ExcalidrawView, Editor, Palette, SettingsView, TrashView,
                      DialogHost, ContextMenu
  lib/                markdown pipeline, path helpers, shortcuts, keyboard,
                      editor keys, settings, vimrc parser
```

Images and video are served through the Tauri asset protocol, because a webview cannot load `file://`.

## Behaviour

One root folder is active at a time. The sidebar tree and folder table browse it, Markdown opens in a reading view or in CodeMirror with Vim keybindings, and search covers file names and file contents. Files can be created, renamed, moved, copied, trashed and restored. Images, SVG and Excalidraw drawings open in place; videos embedded in Markdown play in the reading view. Dropped text files open as temporary files and are not copied into the folder. See [Features](docs/features.md) for each area and its limits.

## Settings

The gear button opens Settings for root folders, editor options and shortcuts. [Features](docs/features.md#settings) covers each option and its default.

## Keyboard

Shortcuts can be changed in Settings → Shortcuts. The table shows the defaults.

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
| `m` | Tree: move the row, or every marked row, to a folder picked from a list |
| `Shift`-click / `⌘`-click | Tree: select a range / toggle one row |
| `⌘A` / `⌃A` / `Esc` | Tree: select all visible rows / clear the selection |
| `x` `y` `p` `u` | Tree: cut, copy, paste, undo the last file operation |
| `j` / `k` | Scroll smoothly in view mode; move the cursor in the folder table |
| `gg` / `G` | View mode: glide to the top / bottom of the note |
| `⌃H` / `⌃L` | Focus the file tree / the main area |
| `⌃⇧V` | Toggle edit / view (also `⌃⇧E`) |
| `⌃S` | Save |
| `⌃D` / `⌃U` | Editor: jump to the bottom / top of the screen and centre |
| `⌃F` / `⌃B` | Editor: page down / up |
| `Enter` | Open the highlighted row, confirm a dialog, or activate the focused button |
| `Esc` | Cancel a dialog, close the finder, or close Settings |

`⌘` means Command on macOS and Ctrl on Windows or Linux. `⌃` means Control on every platform. The default app shortcuts use Control; tree navigation also accepts Command on macOS. Change any binding in Settings → Shortcuts.

Some keys stay fixed: `Enter`, `Esc`, the arrow keys, `Space` (and their Shift variants), `Ctrl`/`Cmd` with `Tab` (or `Shift`+`Tab`), `N`, `P`, `A` or `←`, and `Ctrl`/`Cmd` with `Q` or `W`. `⌃D`/`⌃U` and `⌃F`/`⌃B` work in the editor. With Vim on, Vim handles them. With Vim off on Windows or Linux, `⌃F` stays with CodeMirror search.

## Icons

`src-tauri/icon_base.png` is the source artwork. Run `npm run icons` to rebuild the app icon, the platform icon set and the transparent sidebar logo.

## Notes

The macOS bundle is ad-hoc signed, so a copy taken from the internet opens with right-click → Open once. A Developer ID signature plus notarization is needed for a plain double-click on someone else's Mac.
