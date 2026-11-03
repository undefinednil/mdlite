# Tech stack

mdlite is a Tauri 2 desktop app. The window hosts a React single-page bundle. File access, search and watching run in Rust in the same process. The app has no server and no HTTP API of its own. Notes can still reference remote content through raw HTML and links.

The versions below are the ranges declared in `package.json` and `src-tauri/Cargo.toml` at the time this page was written. `package-lock.json` and `Cargo.lock` pin the exact builds.

## At a glance

| Area | Choice | Declared version | Role |
|---|---|---|---|
| App shell | Tauri | 2 | Native window, IPC, asset protocol, bundling |
| Front end | React | 19.3 | UI components and screen state |
| Language | TypeScript | 7.0 | Type checking for the front end |
| Dev server and bundler | Vite | 8.3 | Fast development server and production bundle |
| Code editor | CodeMirror | 6 | Editing with syntax modes and history |
| Vim layer | `@replit/codemirror-vim` | 6.4 | Vim keybindings in CodeMirror |
| Markdown parser | markdown-it | 15.0 | Markdown to HTML |
| Markdown sanitizer | dompurify | 3.4 | Removes scripts and event handlers before rendering |
| Code highlighting | Shiki | 4.5 | Rendered code blocks |
| Diagrams | Mermaid | 12.2 | Flowcharts and other diagrams in Markdown |
| Drawing | Excalidraw | 0.18 | Editing `.excalidraw` scenes |
| Icons | material-symbols | 0.48 | Interface icons |
| Native dialogs | `@tauri-apps/plugin-dialog` | 2.8 | Folder picker and save dialog |
| Backend | Rust | 2021 edition, 1.77+ | Files, search, watching, config |
| File watching | notify | 8 | Cross-platform filesystem events |
| Directory walking | walkdir | 2 | Built-in search fallback |
| Regex | regex | 1 | Regex search without an external process |
| Serialization | serde / serde_json | 1 | IPC payloads and the roots config |
| Encoding | base64 | 0.22 | Upload payloads from the webview |
| IDs | uuid | 1 | Root folder identifiers |
| Icon pipeline | sharp | 0.35 | Build-time image composition |
| TypeScript runner | tsx | 4 | Runs the TypeScript test files and the icon script |
| Test DOM | jsdom | 29 | DOM used by the editor-key tests |
| Tauri CLI | `@tauri-apps/cli` | 2.12 | `dev` and `build` commands |

## Front end

- **React and TypeScript.** One `App` owns the open file, tree, roots, editor mode and keyboard handling. Components are plain function components with props; there is no global state library.
- **Vite.** Development mode serves the UI on port 5173 and Tauri loads that URL. Release builds write static files to `dist/`, which Tauri embeds.
- **CodeMirror 6.** Language support is split into small packages and loaded on demand per file extension. The editor is created once and reused across files. It is rebuilt when the vimrc source, the Vim switch, word wrap or the file's language extension changes; typing never recreates the view. The React key is the vimrc source plus the Vim switch.
- **markdown-it.** Renders Markdown with raw HTML enabled, automatic links and line breaks. The HTML then passes through DOMPurify. A post-processing step adds Shiki highlighting and Mermaid rendering with strict security.
- **Shiki.** Uses the `github-light` theme so rendered code matches the app's light interface.
- **Mermaid.** Loaded only when a document contains a `mermaid` code block.
- **Excalidraw.** Loaded with a dynamic import, so the large drawing bundle is not part of the first screen.
- **material-symbols.** Icon font shipped through npm and bundled locally; no icon CDN at runtime.
- **Tauri APIs.** `@tauri-apps/api/core` for `invoke` and `convertFileSrc`, `@tauri-apps/api/event` for change events, `@tauri-apps/api/window` for the title and close guard, and the dialog plugin for native pickers.
- **Tests.** `tsx` runs the TypeScript test files listed in the `test` script. `jsdom` supplies the DOM for `editorKeys.test.ts`; the other test files run in Node.

## Back end

The Rust side exposes 21 commands. Most filesystem work runs as async commands on worker threads instead of the native main thread. Config-only commands and `save_text_file` are synchronous. It owns:

- The combined config: roots, active root, editor settings and shortcut overrides.
- Reading and writing text, with an mtime, size and content-hash check before overwrite.
- File operations: create, rename, move, copy, trash and restore.
- Media upload validation and storage.
- Content search with `rg` when available and a built-in fallback.
- Recursive watching with debounce.
- Resolving the vimrc from `~/.vimrc`, a custom path or pasted settings text.
- Opening a file in the operating system's default app and saving a temporary file wherever the user chooses.

The heavy dependencies are deliberate: `notify` gives one watcher across macOS and Windows, `walkdir` keeps the fallback search simple, and `regex` validates and runs patterns without spawning another process. `serde` keeps the IPC payloads typed on both sides.

## Build and release

Setup, checks and release steps are in [Development](development.md).

## Not in the stack

Earlier versions ran a Bun or Node server, shipped a PWA manifest and service worker, and had a browser-only build. Those paths are gone. There is no HTTP API, no database and no remote service run by the app. Do not add a fetch layer: the only seam between UI and disk is `src/api.ts`, which calls Tauri commands. Notes can still load remote images through raw HTML or links; that is note content, not an app API.
