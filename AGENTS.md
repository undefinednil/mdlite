# mdlite

mdlite is a Tauri 2 desktop app for browsing, searching and editing a folder of Markdown notes. React 19 and TypeScript render the UI in the webview. Rust owns the disk. There is no server, no HTTP API and no database; media reaches the webview through the Tauri asset protocol.

- `src/`: React UI. Session state lives in `src/App.tsx`, views in `src/components/`, pure helpers and their tests in `src/lib/`.
- `src-tauri/src/`: Rust core. Command handlers are in `lib.rs`; logic lives in `files.rs`, `paths.rs`, `tree.rs`, `search.rs`, `watch.rs`, `settings.rs`, `state.rs` and `error.rs`.
- `shared/`: types and helpers used by both halves (`types.ts`, `fuzzy.ts`).
- `docs/`: detail docs. `README.md` is the landing page.
- Do not add a fetch client, a database, or a second process. The only UI-to-disk route is a Tauri command through `src/api.ts`.
- Use the npm scripts in `package.json`; do not call the underlying Vite, Tauri or test commands directly when a script exists.
- Do not commit, push, or change any remote system unless the user asks and confirms immediately before the action.
- Never hand-edit generated output: `dist/`, `src-tauri/target/`, `src-tauri/gen/`, or the icon files written by `npm run icons`.

## The one seam

`src/api.ts` is the only Tauri IPC boundary.

- Every disk operation goes through a Rust command and a wrapper in `src/api.ts`. Components must never call `invoke` directly.
- To add an operation: write the command in Rust, register it in `generate_handler!` in `src-tauri/src/lib.rs`, add one wrapper in `src/api.ts`, call the wrapper from the UI.
- `convertFileSrc` is wrapped as `api.rawUrl`. Do not build asset URLs anywhere else.
- The `fs-change` subscription is `api.subscribeChanges`. Do not call `listen` directly.
- The window API (`getCurrentWindow`) and the dialog plugin (`open`, `save`) are used directly where they act on the window or a native picker: title, close, choosing a folder, exporting a temporary file.
- Payload types in `shared/types.ts` must match the serde output of the Rust structs field for field.

## Frontend

Read `docs/mdlite-frontend-styling/SKILL.md` before any UI change. It is the style source of truth. This is not a Colorkrew MUI app: there is no theme provider, no `sx`, no translation file and no dark mode.

- Function components only. No class components.
- No global state library. `App.tsx` owns session state (tree, selection, document, draft, mode, settings) and passes props down. A new leaf component takes props and callbacks, not a store.
- All CSS goes in `src/styles.css`. No CSS framework, no CSS-in-JS, no second global stylesheet. The CodeMirror theme object in `src/components/Editor.tsx` is the only style defined in TSX.
- Use the `:root` tokens for surfaces, borders and text. Do not add a hex color when a token fits. Light theme only; do not add dark-mode branches.
- Inline `style` is for dynamic values only: row offsets, indentation, generated widths. Static styling belongs in the stylesheet. `--main-width` is the exception that sets the main content width from the `mainWidth` setting.
- A new setting updates `shared/types.ts`, `src/lib/settings.ts`, the Rust `AppSettings` default and validation, and the Settings UI in the same change.
- Use `<button type="button">`. Icon-only buttons get a `title`; inputs and unlabeled controls get an `aria-label`.
- Class names are kebab-case. Put state in a second class: `active`, `selected`, `marked`, `cut`, `recording`, `empty`.
- Reuse the existing primitives before inventing one: `.btn`, `.icon-btn`, `.chip`, `.text-input`, `.segmented`, `.switch`, `.dialog`, `.settings-*`.
- Icons are Material Symbols via the `material-symbols-rounded` class, 18px by default.
- Reuse `src/lib/paths.ts`, `shortcuts.ts`, `dialogs.ts` and `settings.ts` before writing a helper.
- New dependencies need a clear reason and a check that an existing one does not cover the case. Use npm; the lockfile is `package-lock.json`. Keep components in their own file under `src/components/`.
- Match the surrounding style: two-space indent, single quotes, no semicolons.

## Editor and Markdown

- CodeMirror 6 lives in `src/components/Editor.tsx`. The view is created once per editor instance; the language is swapped through the `Compartment`. The React `key` is the vimrc source plus the Vim switch, so those changes rebuild the editor. Do not recreate the view on every keystroke.
- The editor reports changes through `onChange` only. There is no save on blur and no save timer. Saves come from the save shortcut, Vim `:w`, the `save` choice in `askSave`, and the explicit Overwrite in the conflict banner.
- `App.tsx` computes `dirty` by comparing the draft with `doc.content`. Before leaving a file, a folder, Settings, the trash, a root or the window, use `confirmSave`, which calls `askSave` and honours `save` / `discard` / `cancel`. A cancelled or failed save keeps the current view.
- Saving sends mtime, size and `contentHash`, and passes `force` only for an explicit overwrite. Do not weaken this conflict check.
- Markdown is rendered by `src/lib/markdown.ts` with `markdown-it` (`html: true`) and must pass through `DOMPurify.sanitize` before `dangerouslySetInnerHTML`. Keep the video and audio entries in `SANITIZE_OPTIONS` in step with what the renderer emits.
- Mermaid runs with `securityLevel: 'strict'`. Do not change it.
- The window uses `csp: null` and asset protocol scope `**` because roots can be anywhere on disk and notes reference media beside them. That makes the sanitizer the content boundary. Keep it in place; revisit CSP and asset scope in `src-tauri/tauri.conf.json` before expanding what Markdown can load.

## Rust core

- Command handlers in `lib.rs` stay thin: validate input, take the root, call a module, return. Filesystem logic belongs in `files.rs`, `tree.rs`, `search.rs`, `watch.rs`, `paths.rs`, `settings.rs` or `state.rs`.
- Commands return `ApiResult<T>`. Use `ApiError::bad_request`, `forbidden`, `not_found`, `conflict` and `io`; add a new `kind` only when the UI must branch on it. `kind` is the stable contract, `message` is display text.
- Mark a command `#[tauri::command(async)]` when it touches the filesystem or runs a process: tree, reads and writes, search, upload, file operations. Config-only commands stay sync. `save_text_file` is the existing exception because it writes an export target chosen in a native dialog.
- Every response struct uses `#[serde(rename_all = "camelCase")]` when a field has more than one word. Update `shared/types.ts` in the same change.
- Commands that work inside a root take a root-relative path and resolve it with `paths::safe_join`. Never join user input to the root by hand. A leading slash means the root, on purpose.
- Only four places accept an absolute path: `root_add` (folder from the native picker), `save_text_file` (export target), `open_path` (hand a file to the OS) and the vimrc path setting. Do not add a fifth.
- Config writes stay atomic: temp file, `sync_all`, rename, owner-only permissions on Unix (`Config::persist`). Never write `mdlite.json` in place.
- Keep the existing caps and debounce unless the change is about them: 8 MiB file read, 4,000,000-byte temporary drop, 1 MiB conflict preview, 60 MB upload, 20,000 tree entries, 120 files / 6 matches per file / 400 total for search, 2 MB fallback search file, 200,000 vimrc characters, 250 ms watcher debounce.
- Rename-like operations must use `assert_name`: no empty name, `.` or `..`, no slash or backslash, no leading dot, at most 200 bytes. `create_entry` is the exception: it takes a root-relative path and creates missing parent folders, so nested creation works.
- A new file operation must stay inside the root, including through symlinks, and must handle a missing parent the same way its neighbours do.

## Tests and verification

Run these after a change:

```bash
npm run typecheck
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

- `npm run build` does not typecheck. Run `npm run typecheck` as well.
- `npm test` runs a fixed file list from `package.json`. A new `src/lib/*.test.ts` only runs if you add it to the `test` script.
- Rust tests are `#[cfg(test)] mod tests` inside the module they cover and use a fresh temp directory per test. Add one for a new path rule, file operation or config rule.
- Run the packaged self-test after changing Tauri commands, the asset protocol, the dialogs or the first screen. Build with `VITE_MDLITE_SELFTEST=1 npx tauri build --bundles app`, run it with `MDLITE_CONFIG` and `MDLITE_ROOT` pointing at a throwaway folder, check `temp/__selftest.json`, then quit and delete the folder. Never point it at a real vault.
- CI (`.github/workflows/desktop.yml`) runs typecheck, `npm test` and `cargo test` on macOS and Windows on a `v*` tag or manual dispatch, then builds the bundles. There is no lint step; typecheck and tests are the gate.

## Docs

- `README.md` is the landing page: what the app does, how to run it, keyboard, behaviour. Keep it short; detail goes to `docs/`.
- `docs/architecture.md` owns the process split, command list, error model, security model, storage and limits.
- `docs/development.md` owns setup, scripts, checks, self-test, icons and release.
- `docs/features.md`, `docs/tech-stack.md` and `docs/troubleshooting.md` hold feature, library and failure detail.
- `docs/mdlite-frontend-styling/SKILL.md` owns visual rules.
- One source of truth per fact. Do not copy a block between README and `docs/`; link to the doc that owns it.
- Change behaviour and update the doc that owns it in the same change. Add or remove a command and update the command list in `docs/architecture.md`, the handler list in `lib.rs` and the wrapper in `src/api.ts` together.

## Definition of done

- The change does what was asked and nothing else.
- `npm run typecheck`, `npm run build`, `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml` pass. Report unrelated existing failures separately.
- The packaged self-test ran if commands, the asset protocol, dialogs or the first screen changed.
- The docs that own the changed behaviour are updated.
- No new dependency without a stated reason.

## Review checklist

- Is disk access behind a Rust command and a `src/api.ts` wrapper?
- Is every path root-relative and resolved through `safe_join`?
- Do the Rust payloads and `shared/types.ts` still match?
- Does a new error give the UI a `kind` it can branch on?
- Is new CSS in `src/styles.css`, using `:root` tokens, with state in its own class?
- Are icon-only buttons labelled, and are controls real buttons or labelled inputs?
- If Markdown changed, does it still pass through DOMPurify, and is Mermaid still strict?
- Is a dirty file still handled through `confirmSave` before the view changes?
- If a cap or debounce changed, is that the point of the change?
- Is a new test file listed in the `npm test` script?
