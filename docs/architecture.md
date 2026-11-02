# Architecture

mdlite has two halves in one process:

- A React UI inside the operating system webview.
- A Rust core that owns the filesystem, search, watching and configuration.

They talk over Tauri commands. The UI never touches the filesystem API directly, and there is no HTTP layer. Media is served to the webview by the Tauri asset protocol.

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
│     └── SettingsView   roots, editor, shortcuts, about                    │
│                                                                           │
│   src/api.ts  ── invoke(command, args) ──►  Rust core                     │
│        ▲                                        │                         │
│        └───────── fs-change event ◄─────────────┘                         │
│   media: asset://localhost/<absolute path> ─────► file on disk            │
└───────────────────────────────────────────────────────────────────────────┘
```

## Process split

**The webview renders.** It holds the open document, the tree, expanded folders, selection, editor mode and keyboard handling. It uses `invoke` for every filesystem action and `convertFileSrc` for media URLs.

**Rust owns the disk.** `src-tauri/src` contains the command handlers and the supporting modules. It validates every path, caps work, serializes payloads with serde and emits change events.

The seam is `src/api.ts`. If a new operation is needed, add a command in Rust, register it in `generate_handler!`, expose one function in `src/api.ts`, and call that function from the UI.

## Commands

There are 19 commands:

| Group | Commands |
|---|---|
| Root folders | `info`, `root_add`, `root_set`, `root_remove` |
| Tree and reading | `tree`, `read_file` |
| Writing | `write_file`, `save_text_file` |
| File operations | `create_entry`, `rename_entry`, `transfer_entry`, `trash_entry`, `restore_entry` |
| Search | `search_grep` |
| Media | `upload` |
| Editor support | `vimrc` |
| Settings | `settings_get`, `settings_set` |
| System | `open_path` |

`tree` returns the whole root at once as nested nodes. The UI filters and sorts this snapshot in memory, which is why typing in the tree filter does not touch the disk.

## Common flows

**Open a file.** A tree click calls `selectFile`. The UI calls `api.read(path)`, which invokes `read_file`. Rust resolves the path inside the root, checks the 8 MB limit and returns the text plus mtime. A file without an extension is read like text; if the bytes are not valid UTF-8 or contain a NUL byte, Rust returns `kind: "binary"` and the UI shows the media card. The view then renders Markdown, the editor or a media card.

**Save.** The editor sends the text and the mtime it loaded. Rust compares the mtime with the file on disk. A match writes the file; a mismatch returns an error with `kind: "conflict"`, the current disk mtime and the disk content. The UI shows the conflict banner with reload and overwrite actions. `force` skips the check for overwrite.

**Show an image.** Markdown contains a relative path. The renderer resolves it against the note path and calls `convertFileSrc` to produce an `asset://localhost/...` URL. The Tauri asset protocol reads the file. Video files use the same path. Uploaded media is written by the `upload` command to an `images/` folder beside the note.

**React to outside changes.** `watch.rs` watches the active root recursively with `notify`. Events are collected on a channel and flushed after 250 ms of quiet, so one editor save does not produce several refreshes. The payload is a deduplicated list of relative paths. The UI refreshes the tree; if the changed path is the open file, it reloads when clean or shows the conflict banner when dirty.

## Error model

Most commands return `Result<T, ApiError>`; `vimrc` returns a plain response. Errors serialize as:

```json
{
  "kind": "conflict",
  "message": "file changed on disk",
  "mtime": 1730000000000,
  "content": "..."
}
```

`kind` is the stable part; `message` is for display. Current kinds include `bad_request`, `not_found`, `forbidden`, `conflict`, `too_large`, `exists`, `binary`, `io`, `state` and `rg`. The front end wraps them in `ApiError` and switches on `kind`, not on an HTTP status code.

## Security model

- **Path jail.** `paths::safe_join` joins the requested path to the root, removes `.` and `..` lexically, then compares the canonical paths when they exist. A path that escapes the root is rejected. Leading slashes are treated as root-relative, so `/etc/passwd` means `<root>/etc/passwd`.
- **Name rules.** New and renamed entries cannot contain slashes, cannot start with a dot and are capped at 200 characters.
- **Ignored paths.** Dot-prefixed components and the entries in `IGNORED_DIRS` are skipped by the tree, the fallback search and the watcher. Symlinks are not followed in the tree.
- **Uploads.** Only listed image and video extensions are accepted, the decoded payload is capped at 60 MB and the file name is reduced to a safe stem.
- **Trusted content warning.** Markdown is rendered with raw HTML enabled (`markdown-it` `html: true`) and inserted with `dangerouslySetInnerHTML`. Inline event handlers in a note can therefore run JavaScript in the app window. Open notes you trust, and add sanitizing before opening untrusted Markdown from other people.
- **Tauri settings.** The window uses `csp: null` and the asset protocol scope is `**`, because roots can be anywhere on disk and notes can point at media beside them. Revisit both if the app ever loads remote content.

## Storage

| What | Where |
|---|---|
| Roots, active root, editor settings, shortcut overrides | `~/.config/mdlite/mdlite.json` (`%USERPROFILE%\.config\mdlite\mdlite.json` on Windows) |
| Config override | `MDLITE_CONFIG` environment variable |
| Imported once when the new file does not exist | the earlier OS app-support config if present, then `~/.mdlite.json` |
| First-run root seed | `MDLITE_ROOT` environment variable; default `~/git/notes` |
| Trash | `<root>/.mdlite-trash/<timestamp>-<name>` |
| Uploaded media | `<note folder>/images/` |
| Table column widths | webview `localStorage`, key `mdlite:table:<file>:<index>` |
| Vim settings | one source chosen in Settings: `~/.vimrc`, a custom path, or pasted text; read up to 200,000 characters |
| Scroll position | in memory, one ratio per open file |
| Recents and undo | in memory, for the current session |

## Front-end layout

| Path | Responsibility |
|---|---|
| `src/App.tsx` | Session state, routing between views, global shortcuts, save and conflict handling, temporary files |
| `src/api.ts` | The only Tauri seam; command wrappers and error normalization |
| `src/components/` | File tree, folder table, Markdown view, editor, Excalidraw, media, palette, settings, dialogs |
| `src/lib/markdown.ts` | Markdown rendering, Shiki, Mermaid, image and table resizing, search highlights |
| `src/lib/paths.ts` | Path helpers, file kinds, icons, language names, glob matching |
| `src/lib/settings.ts` | Default application settings |
| `src/lib/shortcuts.ts` | Shortcut catalog, binding parser, matcher and formatter |
| `src/lib/vimrc.ts` | `.vimrc` parser and applied settings |
| `src/lib/vim.ts` | Vim `:w` and save bridge |
| `src/lib/languages.ts` | Lazy CodeMirror language loaders |
| `src/lib/dialogs.ts` | Promise-based confirm and prompt dialogs |
| `shared/types.ts` | Types shared by the UI and tooling |
| `shared/fuzzy.ts` | Fuzzy ranking for the file finder |

## Rust layout

| Path | Responsibility |
|---|---|
| `lib.rs` | Command handlers and app setup |
| `paths.rs` | Path jail, ignore rules, media name checks |
| `tree.rs` | Recursive tree build with a 20,000-entry budget |
| `files.rs` | Read, write, conflict check, create, rename, transfer, trash, restore, upload |
| `search.rs` | `rg` JSON stream and the pure-Rust fallback |
| `watch.rs` | Recursive watcher, debounce and `fs-change` event |
| `settings.rs` | App settings model, validation and vimrc resolution |
| `state.rs` | Combined config, active root, config path, home directory helpers |
| `error.rs` | `ApiError` and `ApiResult` |

## Concurrency and limits

- Commands are synchronous. The UI shows loading state around the slow ones (tree load, file read, grep).
- The watcher runs on its own thread and only emits after the debounce window.
- The tree is a snapshot. There is no database and no cache on disk beyond the config file and the webview's local storage.
- Large folders are capped at 20,000 entries; search is capped at 120 files and 400 matches. These caps keep the UI responsive and the watcher quiet.

## Verification

- Rust unit tests cover the path jail, tree walking, file write conflicts, rename/transfer/trash, uploads and the search fallback.
- `npm run typecheck` and `npm run build` check the front end.
- `src/lib/selftest.ts` runs inside a packaged build. It exercises `info`, `tree`, `read`, grep, the asset URL, `settings`, `vimrc`, a write, the dialog layer and a few DOM assertions, then writes a JSON report. See [Development](development.md#self-test).
