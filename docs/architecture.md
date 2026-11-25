# Architecture

mdlite has two halves in one process:

- A React UI inside the operating system webview.
- A Rust core that owns the filesystem, search, watching and configuration.

They talk over Tauri commands. The UI never touches the filesystem API directly. There is no server and no HTTP API. Media reaches the webview through the Tauri asset protocol. Notes can still reference remote content: raw HTML and plain URLs turned into links can load remote images, so the app is not offline-only.

```
┌────────────────────────────── mdlite window ──────────────────────────────┐
│ React UI                                                                  │
│   App.tsx                                                                 │
│     ├── session.ts    open document, draft, dirty, save and conflict      │
│     ├── fileOperations create, rename, move, trash, paste, undo          │
│     ├── FileTree       sidebar, filters and selection                    │
│     ├── FolderView     table for the current folder                       │
│     ├── MarkdownView   rendered Markdown                                  │
│     ├── HtmlView       sandboxed HTML preview                             │
│     ├── Editor         CodeMirror + Vim                                   │
│     ├── ExcalidrawView lazy-loaded drawing canvas                         │
│     ├── MediaView      images and binary cards                            │
│     ├── Palette        fuzzy file finder and content search               │
│     ├── TrashView      trash browser, restore and purge                   │
│     ├── SettingsView   roots, editor, vim, shortcuts, about               │
│     └── DialogHost     confirm, prompt, save and folder dialogs           │
│                                                                           │
│   src/api.ts  ── invoke(command, args) ──►  Rust core                     │
│        ▲                                        │                         │
│        └───────── fs-change event ◄─────────────┘                         │
│   media: Tauri asset URL ────────────────────────► file on disk           │
└───────────────────────────────────────────────────────────────────────────┘
```

## Process split

**The webview renders.** The session module owns the open document, draft, mode, status, conflict, scratch file, load error and dirty value. The selection module owns the cursor, anchor and marked rows for each list, seeded from the open file. It remaps paths through a function the caller supplies, so it never builds a branded path itself. The row module owns row class names, leading and trailing text, activation and keyboard moves; each view still renders its own element. The view holds the tree, expanded folders, recents, scroll position, overlay flags and keyboard handling. It calls the `Api` interface in `src/api.ts` for every filesystem action. `api.rawUrl` returns an asset URL and `api.subscribeChanges` subscribes to the `fs-change` event.

**Rust owns the disk.** `src-tauri/src` contains the command handlers and the supporting modules. It validates every path inside a root, caps work, serializes payloads with serde and emits change events.

The seam is `src/api.ts`. It exports one `Api` interface of named, typed functions. `createDesktopApi(client)` is the Tauri adapter: the injected client supplies `invoke`, `listen` and `assetUrl`, so a recording client can check command names and argument keys without a Tauri window. `api` is the production instance. `src/lib/fakeApi.ts` implements the same `Api` interface over an in-memory vault for higher-level tests.

Paths cross the seam as one of two branded types: `RelPath` is root-relative and `AbsPath` is absolute. A plain string is assignable to neither. `src/lib/paths.ts` is the only module that creates them through `relPath`, `absPath` and `absolutePathFrom`, and the adapter brands every path it receives from Rust. The three absolute-path exceptions stay outside the jail: `addRoot` takes an `AbsPath` from the folder picker, `saveText` takes an `AbsPath` export target, and `open` builds its absolute path inside the adapter.

If a new operation is needed, add the command in Rust, register it in `generate_handler!`, add one function to `Api` and the Tauri adapter, add it to the fake adapter, and call it from the UI.

`src/lib/session.ts` is the document seam. `createSession({ api, dialogs, lookup })` owns the open document and its editing state. It exposes asynchronous `open`, `openScratch`, `close`, `save`, `discard`, `settle` (the dirty guard), `reload`, `overwrite`, `rename`, `remove`, `reset` and `reconcileDisk`, plus `setDraft` and `setMode`. `rename` remaps the open document when it is at or under the renamed path. `remove` clears the document when it is at or under the removed path. `reset` clears the document, draft, conflict and pending reads after a root change. `reconcileDisk` re-reads one changed path and reloads, adopts or reports a conflict. The `lookup` port returns the size and mtime that image and binary documents need; the `dialogs` port supplies the save prompt and the scratch export path. The session snapshot carries the document, draft, mode, status, conflict, scratch file, load error, dirty value, a saved timestamp and a change tick. `src/lib/useSession.ts` subscribes React to that snapshot, so the view does not mirror the document or draft in refs. It and the selection and file-operations hooks share the single `useSyncExternalStore` adapter in `src/lib/useSnapshot.ts`. Session tests create a session with the fake API, fake dialogs and a lookup stub.

## Commands

There are 22 commands:

| Group | Commands |
|---|---|
| Root folders | `info`, `root_add`, `root_set`, `root_remove` |
| Tree and reading | `tree`, `read_file` |
| Writing | `write_file`, `save_text_file` |
| File operations | `create_entry`, `rename_entry`, `transfer_entry`, `trash_entry`, `trash_list`, `trash_purge`, `restore_entry` |
| Search | `search_grep` |
| Media | `upload` |
| Settings | `settings_get`, `settings_set` |
| System | `open_path`, `reveal_path`, `open_url` |

`tree` returns the whole root at once as nested nodes. The UI filters and sorts this snapshot in memory, which is why typing in the tree filter does not touch the disk.

`tree`, `read_file`, `write_file`, `open_path`, `reveal_path`, `open_url`, `search_grep`, `upload` and the seven file operations are `#[tauri::command(async)]`. `save_text_file` is synchronous. The config-only commands (`info`, `root_add`, `root_set`, `root_remove`, `settings_get`, `settings_set`) are also synchronous.

Only three places accept an absolute path: `root_add` (folder from the native picker), `save_text_file` (export target) and `open_path` (hand a file to the operating system). Every other operation that touches a file takes a root-relative path and resolves it with `paths::safe_join`. A leading slash means the root on purpose.

`read_file`, `write_file`, `create_entry`, `rename_entry`, `transfer_entry`, `trash_entry` and `restore_entry` return the canonical root-relative path of the file they touched. The UI uses that returned path for selection and remapping, so a renamed or moved file keeps one identity even when the request was written with a leading slash or a `.` segment. The command list and payload field names do not change.

## Common flows

**Open a file.** A tree click calls `selectFile` and then `session.open(path)`. The session calls `api.read`, which invokes `read_file`. Rust resolves the path inside the root, checks the 8 MiB limit and returns the text plus the canonical relative path, mtime and size. A file without an extension is read like text; if the bytes are not valid UTF-8 or contain a NUL byte, Rust returns `kind: "binary"` and the session builds a binary document from the `lookup` metadata instead. Image documents take the same route and also use `lookup` for their size and mtime. Each open has a request generation, so a late read from an earlier selection or root is ignored. On failure the session clears the old document instead of leaving it editable.

**Save.** The session sends the draft, the mtime, the size and a content hash of the document it loaded. Rust compares all three with the file on disk. A match writes through a temporary file, calls `sync_all` and renames it into place. A mismatch returns `kind: "conflict"` with a preview capped at 1 MiB. The session exposes `reload`, which re-reads the full file with `read_file` before showing it, so the capped payload cannot truncate a reload. `force` skips the check only for an explicit overwrite. A scratch file is exported through the dialogs port; its document content is updated after the write so dirty clears.

**Dirty state.** `src/lib/session.ts` derives dirty once by comparing the draft with the document content, and the snapshot, the `settle` guard and the save check all read that value. `settle` calls `askSave`, which returns `save`, `discard` or `cancel`. The view runs it before switching file or folder, opening Settings or the trash, switching or removing a root, opening a temporary file, toggling edit to view and closing the window. `discard` resets the draft and closes the dialog. `cancel` or a failed save keeps the current view. There is no save on blur and no save timer.

**Switch root.** The view runs the dirty guard, asks Rust to set the active root, then calls `session.reset()`. The reset clears the document, draft, conflict and any pending read, so a late read from the previous root cannot appear. The tree, selection, recents, scroll ratios, expanded folders and overlay flags are view state and are cleared there.

**File operations.** `src/lib/fileOperations.ts` owns create, rename, move, trash, paste, cut, copy, undo, the clipboard, the root guard and rollback. The tree passes explicit target paths; the module never reads the selection or the marked rows. Each call captures the active root id before its dialog, runs the dirty guard, checks the root id again, and checks it once more before every mutation. Completed steps of a multi-file operation are recorded and reversed in reverse order on failure. The result carries the changed paths (`from`/`to`), the failed paths and a typed `ApiError` or null, so the view can branch on the error kind while it remaps the selection, refreshes the tree and shows the status or error message. A root change during a dialog or between steps rejects the operation with `kind: "conflict"`. Every undo entry has the same shape (a label and the steps), and the module calls `session.rename` or `session.remove` after each mutation so the open document follows the canonical path.

**Rename or remove the open file.** The file operations module calls `session.rename(from, to)` with the canonical paths after a rename, move or cut-paste, and the session remaps the open document when it is at or under `from`. A trash or a removed paste copy calls `session.remove(path)`, which clears the document when it is at or under the removed path. The view then remaps or clears its selection and shows the folder fallback or the empty state.

**Show an image.** Markdown contains a relative path. The renderer resolves it against the note path and calls `convertFileSrc` to produce a Tauri asset URL. The URL shape is platform-specific: `asset://localhost/...` on macOS and Linux, `http://asset.localhost/...` on Windows. The Tauri asset protocol reads the file. Video files use the same path. Uploaded media is written by the `upload` command to an `images/` folder beside the note. For a temporary file, that folder is `<root>/images/`.

**Search.** `search_grep` first runs `rg --json --no-config` in the root. Because `--no-ignore` is not passed, `.gitignore` and `.ignore` rules apply. If `rg` cannot start or returns an error, the pure-Rust fallback walks with `walkdir`, applies `is_ignored`, reads files up to 2 MB and matches case-insensitively by default. Both paths shorten lines at 240 characters and stop at 120 files, 6 matches per file and 400 matches.

**React to outside changes.** `watch.rs` watches the active root recursively with `notify`. Events are collected on a channel and flushed after 250 ms of quiet, so one editor save does not produce several refreshes. The payload is a deduplicated list of relative paths. The view refreshes the tree and calls `session.reconcileDisk(paths)`. The session ignores paths that do not include the open document, and it ignores media and binary documents. One change batch is reconciled once: a disk copy that matches the draft is adopted, a clean document reloads, and a dirty document shows the conflict banner.

## Error model

Commands return `ApiResult<T>`, which is `Result<T, ApiError>`. Errors serialize as:

```json
{
  "kind": "conflict",
  "message": "file changed on disk",
  "mtime": 1730000000000,
  "content": "..."
}
```

The seam normalises every rejection into one `ApiError` with `kind`, `message` and optional `mtime` and `content`. The known kinds are `bad_request`, `forbidden`, `not_found`, `conflict`, `io`, `too_large`, `exists`, `binary`, `state` and `rg`. Any other kind, and any rejection that is not a command payload, becomes `unknown`. `kind` is the stable part; `message` is for display. The front end switches on `kind`, not on an HTTP status code. `rename_entry`, `transfer_entry` and `restore_entry` return `exists` when the destination is taken; they do not overwrite.

## Security model

- **Path jail.** `paths::safe_join` joins the requested path to the root, removes `.` and `..` lexically, then canonicalizes the deepest existing ancestor and requires the result to stay under the root. This also rejects a new file written through a symlink that points outside. Leading slashes are treated as root-relative, so `/etc/passwd` means `<root>/etc/passwd`.
- **Name rules.** `rename_entry` calls `assert_name`, which rejects an empty name, `.`, `..`, a slash or backslash, a leading dot and a name longer than 200 bytes. `create_entry` does not call `assert_name`; it accepts a root-relative path, creates missing parent folders and therefore supports nested creation.
- **Ignored paths.** Dot-prefixed components and the entries in `IGNORED_DIRS` are skipped by the tree, the fallback search and the watcher. Symlinks are not followed in the tree.
- **Uploads.** Only listed image and video extensions are accepted, the decoded payload is capped at 60 MB and the file name is reduced to a safe stem.
- **Markdown sanitizing.** Markdown is rendered with raw HTML enabled (`markdown-it` `html: true`), then passed through DOMPurify before insertion with `dangerouslySetInnerHTML`. Scripts, event handlers and dangerous URLs are removed, while images, video, audio, tables and Mermaid markup are kept. Mermaid runs with `securityLevel: "strict"`.
- **Remote content.** The app has no server and no HTTP API, but raw HTML and plain URLs turned into links in a note can load remote images. The window uses `csp: null` and the asset protocol scope is `**`, because roots can be anywhere on disk and notes can point at media beside them. The sanitizer is the content boundary; revisit CSP and asset scope before changing the Markdown pipeline.
- **HTML preview.** `.html` and `.htm` open in a sandboxed iframe with an opaque origin. The app renders the saved source with `srcdoc`, adds a `<base>` for the asset directory so relative CSS and classic scripts still load, and injects a small bridge. The sandbox omits `allow-same-origin`, so the page cannot read other files through the asset protocol or call Tauri commands. ES modules, `fetch` and storage do not work; the bridge forwards the app's scroll keys and shortcuts, and reports the scroll ratio back to the app. The preview takes focus on open so the page's own keys keep working.

## Storage

| What | Where |
|---|---|
| Roots, active root, editor settings, shortcut overrides | `~/.config/mdlite/mdlite.json` (`%USERPROFILE%\.config\mdlite\mdlite.json` on Windows) |
| Config override | `MDLITE_CONFIG` environment variable; it also skips the one-time import |
| Imported once when the new file does not exist | the earlier OS app-support config if present, then `~/.mdlite.json` |
| Corrupt config | Renamed to `mdlite.json.corrupt-<timestamp>`; the app then starts from a fresh config (seeded by `MDLITE_ROOT` if set) instead of overwriting the file silently |
| Permissions | The config file is written with owner-only permissions on Unix and replaced atomically: temporary file, `sync_all`, rename |
| Path choice | `~/.config/mdlite/mdlite.json` is used on every platform on purpose, so the file is easy to find; it is not the OS-specific app config folder |
| First-run root seed | `MDLITE_ROOT` environment variable; otherwise no root is stored and the app asks for a folder |
| Trash | Flat entries at `<root>/.mdlite-trash/<name>`, with `-<timestamp>` appended only when the name is already taken. A hidden `.mdlite-meta-<hash>.json` beside each entry stores the original path and deletion time. |
| Uploaded media | `<note folder>/images/`; `<root>/images/` for a temporary file |
| Table column widths | webview `localStorage`, key `mdlite:table:<file>:<index>` |
| Vim settings | stored in the app config: leader key, clipboard targets, line numbers, indentation, search and up to 200 remaps |
| Scroll position | in memory, one ratio per open file |
| Recents and undo | in memory, for the current session |

`trash_list` reads the metadata. When metadata is missing, the entry shows `original path unknown` and the trash browser asks for a relative restore path. Restoring, renaming or moving onto an existing path returns `exists`; choose another name or destination.

Editor settings are `vimEnabled`, `vimLeader`, the three clipboard targets, `vimKeepSelection`, `vimRemaps`, `scrollOff`, `lineNumbers`, `tabSize`, `indentWidth`, `insertSpaces`, `ignoreCase`, `smartCase`, `wordWrap`, `mainWidth` and `sidebarWidth`. The Vim-derived settings (`lineNumbers`, `scrollOff`, `tabSize`, `indentWidth`, `insertSpaces`, `ignoreCase`, `smartCase`, the clipboard targets and the remaps) apply only while `vimEnabled` is true; `vimConfig.ts` returns fixed defaults otherwise. `mainWidth` defaults to 100 and is clamped to 50–100. `sidebarWidth` defaults to 296, is 0 (hidden) or clamped to 230–600, and 0 hides the sidebar; `App.tsx` writes it to the `--sidebar-width` CSS variable and the drag handle saves the same setting. `App.tsx` measures the main pane and reads the current view's cap from the stylesheet (the view root's `max-width`, or the CodeMirror content's when the view is the editor), then sets the `.main-zoom` wrapper to the smaller of the two in px and sets matching horizontal padding on `.main-body` to centre it, so the setting affects the folder view, editor, Markdown view, trash and Settings. The cap is only ever read from a CSS value, never from a live element width, because the element is sized from the cap. The same wrapper carries the main-area zoom: `src/lib/mainZoom.ts` holds the limits and the layout math, and when the zoomed page outgrows the pane the padding reaches `0` and `.main-body` scrolls sideways from the page's left edge. An open Excalidraw drawing or an HTML preview in view mode adds the `full` class to `.main-body` and renders at 100% zoom across the whole main area width.

## Front-end layout

| Path | Responsibility |
|---|---|
| `src/main.tsx` | Mounts the React app and imports the self-test when `VITE_MDLITE_SELFTEST=1` |
| `src/App.tsx` | View state (tree, recents, overlays), routing between views, global shortcuts and temporary-file drops |
| `src/api.ts` | The only Tauri seam; the `Api` interface, the desktop adapter and error normalization |
| `src/styles.css` | All application CSS, `:root` tokens and layout |
| `src/assets/logo.png` | Sidebar logo generated by `npm run icons` |
| `src/components/ContextMenu.tsx` | Right-click menu for tree and folder rows |
| `src/components/DialogHost.tsx` | Confirm, prompt, save and folder dialogs |
| `src/components/Editor.tsx` | CodeMirror editor, media drop and Vim wiring |
| `src/components/ExcalidrawView.tsx` | Lazy-loaded Excalidraw canvas |
| `src/components/HtmlView.tsx` | Sandboxed HTML preview |
| `src/components/FileTree.tsx` | Sidebar tree, filters, selection and context menu |
| `src/components/FindBar.tsx` | Find bar for the reading view: input, match count, previous/next and close |
| `src/components/FolderView.tsx` | Table for the current folder |
| `src/components/MarkdownView.tsx` | Rendered Markdown view |
| `src/components/MediaView.tsx` | Image view and binary card |
| `src/components/Palette.tsx` | Fuzzy file finder and content search |
| `src/components/PenOverlay.tsx` | Presentation pen: a canvas over the main area, pen and whole-stroke eraser, colour picker, undo, redo, clear and close |
| `src/components/SettingsView.tsx` | Roots, editor, shortcuts and about pages |
| `src/components/TrashView.tsx` | Trash browser, restore and permanent delete |
| `src/lib/dialogs.ts` | Promise-based confirm, prompt, save and folder dialogs |
| `src/lib/editorKeys.ts` | Tab handling, half-page scroll, page and screen-edge commands, and the per-view mapping router inside CodeMirror |
| `src/lib/editorTheme.ts` | CodeMirror theme, including the focused-editor outline |
| `src/lib/fakeApi.ts` | In-memory adapter that implements `Api` for tests |
| `src/lib/fileType.ts` | One extension table: kind, editability, language, filter group, media, drop safety, icons and icon tones |
| `src/lib/fileOperations.ts` | Create, rename, move, trash, paste, cut, copy, undo, clipboard, root guard and rollback |
| `src/lib/findInView.ts` | Reading-view find: marks matches in the rendered DOM, clears them and scrolls the active one into view |
| `src/lib/format.ts` | Shared size, date, deleted-at and recent-time text |
| `src/lib/keyboard.ts` | App-level shortcut guard |
| `src/lib/languages.ts` | Lazy CodeMirror language loaders |
| `src/lib/mainZoom.ts` | Main-area zoom limits, key and wheel steps, and the centred page layout math. `App.tsx` resets the zoom when the open file changes and leaves Excalidraw's own zoom alone. |
| `src/lib/markdown.ts` | Markdown rendering and sanitizing, Shiki, Mermaid, diagram zoom, image and table resizing, search highlights |
| `src/lib/pageWidth.ts` | Reads the page cap for the main-area zoom from a stylesheet `max-width` (the view root or the CodeMirror content), never from a live element width |
| `src/lib/pen.ts` | Pen availability rule, stroke and eraser settings, stroke history with undo and redo, whole-stroke hit testing, and client-to-canvas point mapping |
| `src/lib/platform.ts` | Platform label for the Reveal action (Finder, File Explorer, file manager) |
| `src/lib/paths.ts` | The only creator of branded relative and absolute paths, plus path arithmetic, glob matching and content hashing |
| `src/lib/row.ts` | Row state classes, leading slots (with `rowLeading`, because only folder rows have a twisty slot), trailing text, activation and keyboard moves |
| `src/lib/scroll.ts` | Smooth scrolling with reduced-motion support, and the half-page step |
| `src/lib/selection.ts` | Cursor, anchor and marked rows for the tree, folder table and palette |
| `src/lib/selftest.ts` | Packaged self-test and JSON report |
| `src/lib/shortcutE2e.ts` | Packaged self-test suite for every keyboard shortcut |
| `src/lib/session.ts` | Open document session: open, save, discard, dirty guard, conflict, scratch and the snapshot |
| `src/lib/settings.ts` | Default application settings |
| `src/lib/shortcuts.ts` | Shortcut catalog, binding parser, matcher and formatter |
| `src/lib/tree.ts` | Node search, tree walks, pruning, flattening and sorting |
| `src/lib/useFileOperations.ts` | File operations snapshot bridge to React |
| `src/lib/useSelection.ts` | Selection snapshot bridge to React |
| `src/lib/useSession.ts` | Session snapshot bridge to React |
| `src/lib/useSnapshot.ts` | The single `useSyncExternalStore` adapter the three snapshot hooks share |
| `src/lib/vim.ts` | Vim `:w`, save and system clipboard bridge, engine options and mapping registration || `src/lib/vimConfig.ts` | Derives the editor settings the Vim layer reads from the app settings |
| `src/lib/vimKeys.ts` | Normalizes key notation and compiles the remap table |
| `src/lib/vimKeymap.ts` | Converts key events and decides when a multi-key mapping buffers, dispatches or flushes |
| `src/lib/documentUrl.ts` | Builds the asset URL an HTML preview iframe loads |
| `src/lib/htmlDocument.ts` | Builds the HTML preview srcdoc with its base URL and scroll bridge |
| `src/lib/vimScroll.ts` | Vim half-page coordinate fallback for unrendered target lines |
| `src/**/*.test.ts` | TypeScript unit tests; the glob in the `test` script discovers every file |
| `shared/types.ts` | Types shared by the UI and tooling |
| `shared/fuzzy.ts` | Fuzzy ranking for the file finder |

## Rust layout

| Path | Responsibility |
|---|---|
| `src-tauri/src/main.rs` | Binary entry point; calls `mdlite_lib::run()` |
| `src-tauri/src/lib.rs` | Command handlers and app setup |
| `src-tauri/src/error.rs` | `ApiError` and `ApiResult` |
| `src-tauri/src/files.rs` | Read, write, conflict check, create, rename, transfer, trash, restore, upload |
| `src-tauri/src/paths.rs` | Path jail, canonical relative paths, ignore rules, media name checks |
| `src-tauri/src/search.rs` | `rg` JSON stream and the pure-Rust fallback |
| `src-tauri/src/settings.rs` | App settings model and validation |
| `src-tauri/src/state.rs` | Combined config, active root, config path, home directory helpers |
| `src-tauri/src/tree.rs` | Recursive tree build with a 20,000-entry budget |
| `src-tauri/src/watch.rs` | Recursive watcher, debounce and `fs-change` event |
| `src-tauri/build.rs` | Tauri build script |
| `src-tauri/tauri.conf.json` | Window, CSP, asset protocol scope and bundle configuration |
| `src-tauri/capabilities/default.json` | Window capabilities for core window actions, dialogs and clipboard text |

## Concurrency and limits

- Filesystem and process work run as async Tauri commands on worker threads. `save_text_file` is synchronous because it only writes the export file chosen in a native save dialog. Config-only commands are synchronous. The UI still shows loading state around slow commands.
- The watcher runs on its own thread and only emits after the 250 ms debounce.
- The tree is a snapshot. There is no database and no cache on disk beyond the config file and the webview's local storage.
- Large folders are capped at 20,000 entries; search is capped at 120 files, 6 matches per file and 400 matches total. These caps keep the UI responsive and the watcher quiet. The full user-facing list is in [Features: Limits](features.md#limits).

## Verification

See [Development: Checks](development.md#checks) for the command list and test inventory.
