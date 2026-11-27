# mdlite

mdlite is a Tauri 2 desktop app for browsing, searching and editing a folder of Markdown notes. React 19 and TypeScript render the UI in the webview. Rust owns the disk. There is no server, no HTTP API and no database; media reaches the webview through the Tauri asset protocol.

- `src/`: React UI. Session state lives in `src/App.tsx`, views in `src/components/`, pure helpers and their tests in `src/lib/`.
- `src-tauri/src/`: Rust core. Command handlers are in `lib.rs`; logic lives in `files.rs`, `paths.rs`, `tree.rs`, `search.rs`, `watch.rs`, `settings.rs`, `state.rs` and `error.rs`.
- `shared/`: types and helpers used by both halves (`types.ts`, `fuzzy.ts`).
- `docs/`: detail docs. `README.md` is the landing page.
- Do not add a fetch client, a database, or a second process. The only UI-to-disk route is a Tauri command through `src/api.ts`.
- Use the npm scripts in `package.json`; do not call the underlying Vite, Tauri or test commands directly when a script exists.
- Do not commit, push, or change any remote system unless the user asks and confirms immediately before the action.
- When the user asks for an analysis or a feasibility answer first, answer and wait; do not edit files.
- When a product decision is ambiguous, ask before implementing instead of guessing at behaviour that is hard to reverse.
- Never hand-edit generated output: `dist/`, `src-tauri/target/`, `src-tauri/gen/`, or the icon files written by `npm run icons`.

## The one seam

`src/api.ts` is the only Tauri IPC boundary.

- Every disk operation goes through a Rust command and a named function on the `Api` interface in `src/api.ts`. Components must never call `invoke` directly.
- Command strings and raw `invoke`/`listen` calls stay inside `createDesktopApi`, which takes an injectable client. `api` is the production instance; `src/lib/fakeApi.ts` implements the same `Api` interface for tests.
- To add an operation: write the command in Rust, register it in `generate_handler!` in `src-tauri/src/lib.rs`, add one function to `Api` and the desktop adapter in `src/api.ts`, add it to the fake adapter, call the function from the UI.
- One `ApiError` shape crosses the seam. `kind` is a known value or the `unknown` escape hatch; the UI branches on `kind`, never on `message`.
- Paths cross the seam as `RelPath` (root-relative) or `AbsPath` (absolute). `src/lib/paths.ts` is the only module that creates either; do not cast a plain string to one anywhere else.
- `convertFileSrc` is wrapped as `api.rawUrl` for a root-relative path and `api.assetUrl` for an absolute OS path, such as a file dropped from outside the app. Do not build asset URLs anywhere else.
- The `fs-change` subscription is `api.subscribeChanges`. Do not call `listen` directly.
- The window API (`getCurrentWindow`) and the dialog plugin (`open`, `save`) are used directly where they act on the window or a native picker: title, close, choosing a folder, exporting a temporary file.
- Payload types in `shared/types.ts` must match the serde output of the Rust structs field for field.

## Frontend

Read `docs/mdlite-frontend-styling/SKILL.md` before any UI change. It is the style source of truth. This is not a Colorkrew MUI app: there is no theme provider, no `sx`, no translation file and no dark mode.

- Function components only. No class components.
- No global state library. `App.tsx` owns session state (tree, selection, document, draft, mode, settings) and passes props down. A new leaf component takes props and callbacks, not a store.
- All CSS goes in `src/styles.css`. No CSS framework, no CSS-in-JS, no second global stylesheet. The CodeMirror theme in `src/lib/editorTheme.ts` is the only style defined in TypeScript.
- Use the `:root` tokens for surfaces, borders and text. Do not add a hex color when a token fits. Light theme only; do not add dark-mode branches.
- Inline `style` is for dynamic values only: row offsets, indentation, generated widths. Static styling belongs in the stylesheet. `--main-width` is the exception that sets the main content width from the `mainWidth` setting.
- A new setting updates `shared/types.ts`, `src/lib/settings.ts`, the Rust `AppSettings` default and validation, the Settings UI, the docs and the legacy config tests in the same change. Old configs get the default. Clamp layout values in both TypeScript and Rust, and never commit an empty input string.
- Settings page controls save after the 450 ms debounce. A live drag updates local state and persists once on release.
- A setting that hides a control hides only the control. The command and its shortcut stay active; do not use the visibility flag as the feature gate.
- Use `<button type="button">`. Icon-only buttons get a `title`; inputs and unlabeled controls get an `aria-label`.
- Class names are kebab-case. Put state in a second class: `active`, `selected`, `marked`, `cut`, `recording`, `empty`.
- Reuse the existing primitives before inventing one: `.btn`, `.icon-btn`, `.chip`, `.text-input`, `.segmented`, `.switch`, `.dialog`, `.settings-*`.
- Icons are Material Symbols via the `material-symbols-rounded` class, 18px by default.
- Reuse `src/lib/paths.ts`, `shortcuts.ts`, `dialogs.ts` and `settings.ts` before writing a helper.
- New dependencies need a clear reason and a check that an existing one does not cover the case. Use npm; the lockfile is `package-lock.json`. Keep components in their own file under `src/components/`.
- Match the surrounding style: two-space indent, single quotes, no semicolons.

## Interaction rules

- Shortcuts are commands, not hardcoded keys. Add the command to `SHORTCUT_COMMANDS`, remove the binding from `RESERVED_BINDINGS`, match with `matchesCommand`, and let Settings list it. A key that stays fixed must not be presented as a configurable shortcut.
- One close-page command closes the current page: the open file, Settings or the trash. Route every page through the same branch and allow it while a page input has focus. Do not add per-page close shortcuts.
- Escape closes the active transient surface: dialog first, then the finder or palette, then the pen, then the page. Guard transient handlers with `isDialogOpen()`.
- Plain keys belong to a focused text field. `Ctrl+U` clears writable inputs outside the editor; the editor keeps its own `Ctrl+U`. When focus is inside the HTML iframe, forward app keys through the bridge, but leave plain page keys with the page.
- A shortcut that opens a dialog must also make the dialog usable with the mouse: rows are buttons, outside click closes, and the same overlay look is used.
- `Ctrl+N` / `Ctrl+P` are fixed list-navigation keys: the tree, the folder table, the finder and the open recent-file menu. The recent-file menu keeps them while open through `cycleNavAction`; do not turn them into a configurable recent-file command.
- `dragDropEnabled` stays `true` in `src-tauri/tauri.conf.json`. Tauri's native handler is the only source of OS paths for files dragged in from outside the app; `App.tsx` turns those paths into `File` objects through the asset protocol. The tree drag-move uses pointer events and `document.elementFromPoint`, not HTML5 drag events, because the two cannot run together in the webview. `src/lib/tauriConfig.test.ts` guards the setting.
- All modal surfaces use the shared `.overlay` (dimmed, blurred backdrop) and add only spacing or stacking modifiers. Do not create a second overlay style.
- Buttons and chips are inline flex with centered content. Size icons in the shared primitive, not per instance.
- A page whose content height changes between tabs or modes reserves the scrollbar gutter (`scrollbar-gutter: stable`, and a stable `overflow-y` where needed) so a centered layout does not shift.

## Editor and Markdown

- CodeMirror 6 lives in `src/components/Editor.tsx`. The view is created once per editor instance; the language, gutter, indentation and wrap are swapped through `Compartment`s. The React key is only the Vim switch, so toggling Vim rebuilds the editor. Do not recreate the view on every keystroke.
- The editor reports changes through `onChange` only. There is no save on blur and no save timer. Saves come from the save shortcut, Vim `:w`, the `save` choice in `askSave`, and the explicit Overwrite in the conflict banner.
- `App.tsx` computes `dirty` by comparing the draft with `doc.content`. Before leaving a file, a folder, Settings, the trash, a root or the window, use `confirmSave`, which calls `askSave` and honours `save` / `discard` / `cancel`. A cancelled or failed save keeps the current view.
- Saving sends mtime, size and `contentHash`, and passes `force` only for an explicit overwrite. Do not weaken this conflict check.
- Markdown is rendered by `src/lib/markdown.ts` with `markdown-it` (`html: true`) and must pass through `DOMPurify.sanitize` before `dangerouslySetInnerHTML`. Keep the video and audio entries in `SANITIZE_OPTIONS` in step with what the renderer emits.
- Mermaid runs with `securityLevel: 'strict'`. Do not change it.
- The window uses `csp: null` and asset protocol scope `**` because roots can be anywhere on disk and notes reference media beside them. That makes the sanitizer the content boundary. Keep it in place; revisit CSP and asset scope in `src-tauri/tauri.conf.json` before expanding what Markdown can load.
- HTML preview runs in a sandboxed iframe with an opaque origin (`sandbox` without `allow-same-origin`). Do not add `allow-same-origin`, and do not expose Tauri commands or the app DOM to the iframe.
- HTML zoom belongs to the iframe's injected script, not the app's main zoom. HTML view is full width and the main zoom leaves it alone; the preview handles `Ctrl`/`Cmd` + wheel and `Ctrl`/`Cmd` + `+`, `-`, `0` locally and consumes those keys. Do not reintroduce app-level HTML zoom.
- The iframe bridge is the only way to reach the preview. It forwards scroll and app keys, handles preview-local zoom, and keeps the sandbox opaque.
- Pen strokes live in content coordinates. Use the real scrolling element: `.main-body` for the reading view, `.cm-scroller` for the editor, and the reported iframe scroll for HTML. Compose the canvas transform as translate to the content origin, scale by the app zoom, then translate by `-scrollTop`; the pointer mapping is the inverse.
- Keep the pen mounted while the document is open and toggle it with an `active` prop. Key it by the document path so a file change clears it; do not lift stroke history unless drawings must survive across documents.
- Pen Close and Escape keep the drawing; the pen's Clear is undoable; a file change or close clears it. Keep the canvas viewport-sized; never build a document-sized canvas.
- The painting follows the preview's scroll but not the iframe's own zoom. Do not mix the app's main zoom with iframe zoom.

## Rust core

- Command handlers in `lib.rs` stay thin: validate input, take the root id, call a module, return. Filesystem logic belongs in `files.rs`, `tree.rs`, `search.rs`, `watch.rs`, `paths.rs`, `settings.rs` or `state.rs`.
- Commands return `ApiResult<T>`. Use `ApiError::bad_request`, `forbidden`, `not_found`, `conflict` and `io`; add a new `kind` only when the UI must branch on it. `kind` is the stable contract, `message` is display text.
- Mark a command `#[tauri::command(async)]` when it touches the filesystem or runs a process: tree, reads and writes, search, upload, file operations. Config-only commands stay sync. `save_text_file` is the existing exception because it writes an export target chosen in a native dialog.
- Every response struct uses `#[serde(rename_all = "camelCase")]` when a field has more than one word. Update `shared/types.ts` in the same change.
- Commands that work inside a root take a `rootId` and a root-relative path, look up that root, and resolve the path with `paths::safe_join`. Never join user input to the root by hand. A leading slash means the root, on purpose. Never rely on an ambient active root: the open document and every root row carry their own root id.
- Only three places accept an absolute path: `root_add` (folder from the native picker), `save_text_file` (export target) and `open_path` (hand a file to the OS). Do not add a fourth.
- Config writes stay atomic: temp file, `sync_all`, rename, owner-only permissions on Unix (`Config::persist`). Never write `mdlite.json` in place.
- Old config files must keep loading. Every settings field has a serde default, missing fields fall back to `AppSettings::default()`, and a config must never be rejected just because it predates a newer key. The config `active` field is an array of root ids; an old single string is read as a one-root active set, and a missing field activates every configured root. Extend the legacy config tests (`reads_legacy_config_shape`, `reads_settings_with_missing_fields` and `reads_multiple_active_roots_and_defaults_missing_active_to_all`) when the config shape changes.
- The config may have zero roots and zero active roots. Both are valid UI states; do not assume `roots[0]` or one active root in Rust or the frontend.
- Keep the existing caps and debounce unless the change is about them: 8 MiB file read, 4,000,000-byte temporary drop, 1 MiB conflict preview, 60 MB upload, 20,000 tree entries, 120 files / 6 matches per file / 400 total for search, 2 MB fallback search file, 200 Vim remaps, 250 ms watcher debounce.
- Rename-like operations must use `assert_name`: no empty name, `.` or `..`, no slash or backslash, no leading dot, at most 200 bytes. `create_entry` is the exception: it takes a root-relative path and creates missing parent folders, so nested creation works.
- A new file operation must stay inside the root, including through symlinks, and must handle a missing parent the same way its neighbours do.

## Tests and verification

Run this after a change:

```bash
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run check` runs `npm run typecheck`, `npm test` and `npm run build` in that order. `npm run build` does not typecheck, so run the whole script instead of one part.

- `npm test` runs every file matching the `src/**/*.test.ts` glob in the `test` script. A new test file runs without editing the script.
- Rust tests are `#[cfg(test)] mod tests` inside the module they cover and use a fresh temp directory per test. Add one for a new path rule, file operation or config rule.
- Run the packaged self-test after changing Tauri commands, the asset protocol, the dialogs or the first screen. Build with `VITE_MDLITE_SELFTEST=1 npx tauri build --bundles app`, run it with `MDLITE_CONFIG` and `MDLITE_ROOT` pointing at a throwaway folder, check `temp/__selftest.json`, then quit and delete the folder. Never point it at a real vault. `npm run e2e` automates that loop and fails when a keyboard-shortcut check fails.
- Run `npm run e2e` when a shortcut, overlay, page lifecycle, root folder, pen or first-screen interaction changes. It covers the shortcut catalogue, two active roots as normal root rows with per-root file creation, root visibility toggles, recent files, drag-move, page close, sidebar width, view-button toggles, pen persistence and zoom, `Ctrl+U` and Escape.
- For a UI lifecycle, assert what proves it: the same element across a toggle, a new element after a file change, or the layer active/inactive.
- For canvas or pen transforms, add a pixel check with a synthetic pointer stroke and patch pointer capture in the test. Cover the editor and iframe scrollers, not only Markdown.
- If a packaged check is flaky and unrelated, report it separately; do not delete or weaken it.
- CI (`.github/workflows/desktop.yml`) runs typecheck, `npm test` and `cargo test` on macOS and Windows on a `v*` tag or manual dispatch, then builds the bundles. There is no lint step; typecheck and tests are the gate.

## Regression rules

Each of these covers a bug this app has already had. Check them before reporting a change.

- Put a decision in a pure function under `src/lib/` and test it. Views, effects and event handlers should only apply the result.
- Never derive a size from an element that the same value sizes. Page caps are read from CSS in `src/lib/pageWidth.ts`; do not replace that with `offsetWidth`, `clientWidth` or `getBoundingClientRect`.
- Read row leading slots with `rowLeading`. Only folder rows carry a twisty slot, so `leading[1]` is not the icon on a file row.
- When an effect writes state, check that the value cannot flow back into the same effect through a measured DOM size. CSS constants are safe; live sizes are not.
- Check handler wiring explicitly: capture versus bubble order, `preventDefault`/`stopPropagation`, and stale closures in `useCallback` and `useEffect` dependencies.
- A UI behaviour change ships with a test for its decision function in the same change.
- Any modal surface must use the shared `.overlay`; a new modal without the dim and blur is a bug.
- A centered page must not move when a submenu or tab changes height; reserve the scrollbar gutter.
- A customizable shortcut must not also be reserved or hardcoded. A fixed key must not be listed as a shortcut.
- A close-page shortcut must close every page, not only the file view.
- Pen and zoom transforms must use the real scroll container. `.main-zoom` alone misses `.cm-scroller` and the HTML iframe.
- Do not change visual constants such as `PEN_STROKE_WIDTH` without updating the test and docs; restore accidental drift.
- When moving behaviour to a lower layer, remove the app-level duplicate and its tests; keep only the general transform or math fixes.

## Docs

- `README.md` is the landing page: what the app does, how to run it, keyboard, behaviour. Keep it short; detail goes to `docs/`.
- `docs/architecture.md` owns the process split, command list, error model, security model, storage and limits.
- `docs/development.md` owns setup, scripts, checks, self-test, icons and release.
- `docs/features.md`, `docs/tech-stack.md` and `docs/troubleshooting.md` hold feature, library and failure detail.
- `docs/mdlite-frontend-styling/SKILL.md` owns visual rules.
- One source of truth per fact. Do not copy a block between README and `docs/`; link to the doc that owns it.
- Change behaviour and update the doc that owns it in the same change. Add or remove a command and update the command list in `docs/architecture.md`, the handler list in `lib.rs` and the wrapper in `src/api.ts` together.
- A shortcut change updates `SHORTCUT_COMMANDS`, the reserved list, the handlers, the Settings list and the README/docs together. Do not call a configurable shortcut fixed.
- A new modal uses the shared overlay; a new page uses the stable scrollbar rule; a new file view uses the real content scroller for the pen.

## Definition of done

- The change does what was asked and nothing else.
- `npm run typecheck`, `npm run build`, `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml` pass. Report unrelated existing failures separately.
- The packaged self-test ran if commands, the asset protocol, dialogs, shortcuts, overlays, page lifecycles, the pen or the first screen changed.
- A shortcut change updates the command table, reserved list, handlers, Settings list and docs together.
- The docs that own the changed behaviour are updated.
- No new dependency without a stated reason.

## Review checklist

- Is disk access behind a Rust command and a `src/api.ts` wrapper?
- Is every path root-relative and resolved through `safe_join` under an explicit root id? The one exception is an OS-dropped file: read it through `api.assetUrl` and the existing `File` path, not a new absolute-path command.
- Does every root row and open document carry its root id, and does the UI handle zero roots and zero active roots?
- Do the Rust payloads and `shared/types.ts` still match?
- Does a new error give the UI a `kind` it can branch on?
- Is new CSS in `src/styles.css`, using `:root` tokens, with state in its own class?
- Are icon-only buttons labelled, and are controls real buttons or labelled inputs?
- If Markdown changed, does it still pass through DOMPurify, and is Mermaid still strict?
- Is the HTML iframe still sandboxed without `allow-same-origin`?
- Is a dirty file still handled through `confirmSave` before the view changes?
- If a cap or debounce changed, is that the point of the change?
- Does a new test file match `src/**/*.test.ts`, so `npm test` discovers it?
- Does a changed shortcut go through `SHORTCUT_COMMANDS` and `matchesCommand`, and is it absent from the reserved list?
- Does a new modal use the shared `.overlay`, and does a page with changing height reserve the scrollbar gutter?
- Does a new pen or zoom path use the real content scroller and content coordinates?
- Does hiding a control leave its command and shortcut active?
- Is HTML zoom still owned by the iframe, with the app's main zoom leaving it alone?
