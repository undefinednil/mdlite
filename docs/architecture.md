# Architecture

mdlite has two halves in one process:

- A React UI inside the operating system webview.
- A Rust core that owns the filesystem, search, watching and configuration.

They talk over Tauri commands. The UI never touches the filesystem API directly. There is no server and no HTTP API. Media reaches the webview through the Tauri asset protocol. Notes can still reference remote content: raw HTML and plain URLs turned into links can load remote images, so the app is not offline-only.

```
┌────────────────────────────── mdlite window ──────────────────────────────┐
│ React UI                                                                  │
│   App.tsx                                                                 │
│     ├── FileTree       sidebar, filters, selection, file operations       │
│     ├── FolderView     table for the current folder                       │
│     ├── MarkdownView   rendered Markdown                                  │
│     ├── Editor         CodeMirror + Vim                                   │
│     ├── ExcalidrawView lazy-loaded drawing canvas                         │
│     ├── MediaView      images and binary cards                            │
│     ├── Palette        fuzzy file finder and content search               │
│     ├── TrashView      trash browser, restore and purge                   │
│     ├── SettingsView   roots, editor, shortcuts, about                    │
│     └── DialogHost     confirm, prompt, save and folder dialogs           │
│                                                                           │
│   src/api.ts  ── invoke(command, args) ──►  Rust core                     │
│        ▲                                        │                         │
│        └───────── fs-change event ◄─────────────┘                         │
│   media: Tauri asset URL ────────────────────────► file on disk           │
└───────────────────────────────────────────────────────────────────────────┘
```

## Process split

**The webview renders.** It holds the open document, the tree, expanded folders, selection, editor mode and keyboard handling. It calls wrappers in `src/api.ts` for every filesystem action. `api.rawUrl` wraps `convertFileSrc` for media URLs, and `api.subscribeChanges` wraps the `fs-change` event.

**Rust owns the disk.** `src-tauri/src` contains the command handlers and the supporting modules. It validates every path inside a root, caps work, serializes payloads with serde and emits change events.

The seam is `src/api.ts`. If a new operation is needed, add a command in Rust, register it in `generate_handler!`, expose one function in `src/api.ts`, and call that function from the UI.

## Commands

There are 21 commands:

| Group | Commands |
|---|---|
| Root folders | `info`, `root_add`, `root_set`, `root_remove` |
| Tree and reading | `tree`, `read_file` |
| Writing | `write_file`, `save_text_file` |
| File operations | `create_entry`, `rename_entry`, `transfer_entry`, `trash_entry`, `trash_list`, `trash_purge`, `restore_entry` |
| Search | `search_grep` |
| Media | `upload` |
| Editor support | `vimrc` |
| Settings | `settings_get`, `settings_set` |
| System | `open_path` |

`tree` returns the whole root at once as nested nodes. The UI filters and sorts this snapshot in memory, which is why typing in the tree filter does not touch the disk.

`tree`, `read_file`, `write_file`, `open_path`, `search_grep`, `upload` and the seven file operations are `#[tauri::command(async)]`. `save_text_file` is synchronous. The config-only commands (`info`, `root_add`, `root_set`, `root_remove`, `vimrc`, `settings_get`, `settings_set`) are also synchronous.

Only four places accept an absolute path: `root_add` (folder from the native picker), `save_text_file` (export target), `open_path` (hand a file to the operating system) and the vimrc path setting. Every other operation that touches a file takes a root-relative path and resolves it with `paths::safe_join`. A leading slash means the root on purpose.

## Common flows

**Open a file.** A tree click calls `selectFile`. The UI calls `api.read(path)`, which invokes `read_file`. Rust resolves the path inside the root, checks the 8 MiB limit and returns the text plus mtime and size. A file without an extension is read like text; if the bytes are not valid UTF-8 or contain a NUL byte, Rust returns `kind: "binary"` and the UI shows the media card. Each read carries a generation number, so a late read from an earlier selection or root is ignored. On failure the UI clears the old document instead of leaving it editable.

**Save.** The editor sends the text, the mtime, the size and a content hash it loaded. Rust compares all three with the file on disk. A match writes through a temporary file, calls `sync_all` and renames it into place. A mismatch returns `kind: "conflict"` with a preview capped at 1 MiB. The UI reloads the full file with `read_file` before showing it, so the capped payload cannot truncate a reload. `force` skips the check only for an explicit overwrite.

**Dirty state.** `App.tsx` computes `dirty` by comparing the draft with `doc.content`. `confirmSave` calls `askSave`, which returns `save`, `discard` or `cancel`. It runs before switching file or folder, opening Settings or the trash, switching or removing a root, opening a temporary file, toggling edit to view and closing the window. `discard` resets the draft and closes the dialog. `cancel` or a failed save keeps the current view. There is no save on blur and no save timer.

**Show an image.** Markdown contains a relative path. The renderer resolves it against the note path and calls `convertFileSrc` to produce a Tauri asset URL. The URL shape is platform-specific: `asset://localhost/...` on macOS and Linux, `http://asset.localhost/...` on Windows. The Tauri asset protocol reads the file. Video files use the same path. Uploaded media is written by the `upload` command to an `images/` folder beside the note. For a temporary file, that folder is `<root>/images/`.

**Search.** `search_grep` first runs `rg --json --no-config` in the root. Because `--no-ignore` is not passed, `.gitignore` and `.ignore` rules apply. If `rg` cannot start or returns an error, the pure-Rust fallback walks with `walkdir`, applies `is_ignored`, reads files up to 2 MB and matches case-insensitively by default. Both paths shorten lines at 240 characters and stop at 120 files, 6 matches per file and 400 matches.

**React to outside changes.** `watch.rs` watches the active root recursively with `notify`. Events are collected on a channel and flushed after 250 ms of quiet, so one editor save does not produce several refreshes. The payload is a deduplicated list of relative paths. The UI refreshes the tree; if the changed path is the open file, it re-reads the file, ignores its own save when the disk content matches the draft, reloads when clean or shows the conflict banner when dirty.

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

`kind` is the stable part; `message` is for display. Current kinds include `bad_request`, `not_found`, `forbidden`, `conflict`, `too_large`, `exists`, `binary`, `io`, `state` and `rg`. The front end wraps them in `ApiError` and switches on `kind`, not on an HTTP status code. `rename_entry`, `transfer_entry` and `restore_entry` return `exists` when the destination is taken; they do not overwrite.

## Security model

- **Path jail.** `paths::safe_join` joins the requested path to the root, removes `.` and `..` lexically, then canonicalizes the deepest existing ancestor and requires the result to stay under the root. This also rejects a new file written through a symlink that points outside. Leading slashes are treated as root-relative, so `/etc/passwd` means `<root>/etc/passwd`.
- **Name rules.** `rename_entry` calls `assert_name`, which rejects an empty name, `.`, `..`, a slash or backslash, a leading dot and a name longer than 200 bytes. `create_entry` does not call `assert_name`; it accepts a root-relative path, creates missing parent folders and therefore supports nested creation.
- **Ignored paths.** Dot-prefixed components and the entries in `IGNORED_DIRS` are skipped by the tree, the fallback search and the watcher. Symlinks are not followed in the tree.
- **Uploads.** Only listed image and video extensions are accepted, the decoded payload is capped at 60 MB and the file name is reduced to a safe stem.
- **Markdown sanitizing.** Markdown is rendered with raw HTML enabled (`markdown-it` `html: true`), then passed through DOMPurify before insertion with `dangerouslySetInnerHTML`. Scripts, event handlers and dangerous URLs are removed, while images, video, audio, tables and Mermaid markup are kept. Mermaid runs with `securityLevel: "strict"`.
- **Remote content.** The app has no server and no HTTP API, but raw HTML and plain URLs turned into links in a note can load remote images. The window uses `csp: null` and the asset protocol scope is `**`, because roots can be anywhere on disk and notes can point at media beside them. The sanitizer is the content boundary; revisit CSP and asset scope before changing the Markdown pipeline.

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
| Vim settings | one source chosen in Settings: `~/.vimrc`, a custom path, or pasted text; read up to 200,000 characters |
| Scroll position | in memory, one ratio per open file |
| Recents and undo | in memory, for the current session |

`trash_list` reads the metadata. When metadata is missing, the entry shows `original path unknown` and the trash browser asks for a relative restore path. Restoring, renaming or moving onto an existing path returns `exists`; choose another name or destination.

Editor settings are `vimEnabled`, `wordWrap`, `mainWidth` and the vimrc source. `mainWidth` defaults to 100 and is clamped to 50–100. `App.tsx` applies it as horizontal padding on `.main-body` through `--main-width`, so it affects the folder view, editor, Markdown view, trash and Settings.

## Front-end layout

| Path | Responsibility |
|---|---|
| `src/main.tsx` | Mounts the React app and imports the self-test when `VITE_MDLITE_SELFTEST=1` |
| `src/App.tsx` | Session state, routing between views, global shortcuts, save and conflict handling, temporary files |
| `src/api.ts` | The only Tauri seam; command wrappers and error normalization |
| `src/styles.css` | All application CSS, `:root` tokens and layout |
| `src/assets/logo.png` | Sidebar logo generated by `npm run icons` |
| `src/components/ContextMenu.tsx` | Right-click menu for tree and folder rows |
| `src/components/DialogHost.tsx` | Confirm, prompt, save and folder dialogs |
| `src/components/Editor.tsx` | CodeMirror editor, theme, media drop and Vim wiring |
| `src/components/ExcalidrawView.tsx` | Lazy-loaded Excalidraw canvas |
| `src/components/FileTree.tsx` | Sidebar tree, filters, selection, file operations and context menu |
| `src/components/FolderView.tsx` | Table for the current folder |
| `src/components/MarkdownView.tsx` | Rendered Markdown view |
| `src/components/MediaView.tsx` | Image view and binary card |
| `src/components/Palette.tsx` | Fuzzy file finder and content search |
| `src/components/SettingsView.tsx` | Roots, editor, shortcuts and about pages |
| `src/components/TrashView.tsx` | Trash browser, restore and permanent delete |
| `src/lib/dialogs.ts` | Promise-based confirm, prompt, save and folder dialogs |
| `src/lib/editorKeys.ts` | Tab, page and screen-edge key handling inside CodeMirror |
| `src/lib/keyboard.ts` | App-level shortcut guard |
| `src/lib/languages.ts` | Lazy CodeMirror language loaders |
| `src/lib/markdown.ts` | Markdown rendering and sanitizing, Shiki, Mermaid, image and table resizing, search highlights |
| `src/lib/paths.ts` | Path helpers, file kinds, icons, language names, glob matching, content hashing |
| `src/lib/scroll.ts` | Smooth scrolling with reduced-motion support |
| `src/lib/selftest.ts` | Packaged self-test and JSON report |
| `src/lib/settings.ts` | Default application settings |
| `src/lib/shortcuts.ts` | Shortcut catalog, binding parser, matcher and formatter |
| `src/lib/vim.ts` | Vim `:w` and save bridge |
| `src/lib/vimrc.ts` | `.vimrc` parser and applied settings |
| `src/lib/*.test.ts` | TypeScript unit tests; the list lives in the `test` script in `package.json` |
| `shared/types.ts` | Types shared by the UI and tooling |
| `shared/fuzzy.ts` | Fuzzy ranking for the file finder |

## Rust layout

| Path | Responsibility |
|---|---|
| `src-tauri/src/main.rs` | Binary entry point; calls `mdlite_lib::run()` |
| `src-tauri/src/lib.rs` | Command handlers and app setup |
| `src-tauri/src/error.rs` | `ApiError` and `ApiResult` |
| `src-tauri/src/files.rs` | Read, write, conflict check, create, rename, transfer, trash, restore, upload |
| `src-tauri/src/paths.rs` | Path jail, ignore rules, media name checks |
| `src-tauri/src/search.rs` | `rg` JSON stream and the pure-Rust fallback |
| `src-tauri/src/settings.rs` | App settings model, validation and vimrc resolution |
| `src-tauri/src/state.rs` | Combined config, active root, config path, home directory helpers |
| `src-tauri/src/tree.rs` | Recursive tree build with a 20,000-entry budget |
| `src-tauri/src/watch.rs` | Recursive watcher, debounce and `fs-change` event |
| `src-tauri/build.rs` | Tauri build script |
| `src-tauri/tauri.conf.json` | Window, CSP, asset protocol scope and bundle configuration |
| `src-tauri/capabilities/default.json` | Window capabilities for core window actions and dialogs |

## Concurrency and limits

- Filesystem and process work run as async Tauri commands on worker threads. `save_text_file` is synchronous because it only writes the export file chosen in a native save dialog. Config-only commands are synchronous. The UI still shows loading state around slow commands.
- The watcher runs on its own thread and only emits after the 250 ms debounce.
- The tree is a snapshot. There is no database and no cache on disk beyond the config file and the webview's local storage.
- Large folders are capped at 20,000 entries; search is capped at 120 files, 6 matches per file and 400 matches total. These caps keep the UI responsive and the watcher quiet. The full user-facing list is in [Features: Limits](features.md#limits).

## Verification

See [Development: Checks](development.md#checks) for the command list and test inventory.
