# Troubleshooting

Each section names a symptom, then its cause and fix. For product limits and known gaps, see [Features: Limits](features.md#limits).

## The Dock or app window still shows the old icon

**Cause:** macOS caches app icons.

**Fix:** Rebuild first, then refresh Launch Services:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f src-tauri/target/release/bundle/macos/mdlite.app
touch src-tauri/target/release/bundle/macos/mdlite.app
```

Remove the app from the Dock and add it back if the old icon remains.

## `npm run dev` shows a blank window or does not start

**Cause:** The Rust build failed, Vite is not running, the port is taken, or the webview hit a JavaScript error.

**Fix:**

- Read the terminal that ran `npm run dev`. A Rust compile error stops the window from opening.
- The Tauri window loads `http://localhost:5173`. Make sure Vite is running and the port is free.
- Development builds allow the webview devtools. Press `Cmd+Alt+I` on macOS or `Ctrl+Shift+I` on Windows to see JavaScript errors.
- If the window opens but the tree is empty, open Settings and confirm the root folder exists and is readable.

## A file will not open: "file is too large to open"

**Cause:** Files opened from a root are read by `read_file`, which rejects text over 8 MiB. SVG and Excalidraw are text and go through the same cap. Raster images and video open through the asset protocol and are not affected.

Dropped files above 4,000,000 bytes are rejected; the read cap inside a root is 8 MiB. A file in that gap opens from a root but not as a temporary drop.

**Fix:** If a dropped file is under 8 MiB, open it from inside a root instead. Above 8 MiB, open it in another editor or reduce its size. SVG and Excalidraw files hit the 8 MiB cap even when opened from a root.

## The conflict banner appeared

**Cause:** The file changed on disk after you loaded it. The save check compares modification time, size and a content hash, so a rewrite with the same timestamp is still detected.

**Fix:**

- **Reload** discards your edits and takes the disk version. It re-reads the full file with `read_file`, so the 1 MiB conflict preview does not limit the reload.
- **Overwrite** writes your version over the disk file. This sends `force` and skips the check.

Switching files or folders, opening Settings or the trash, changing roots, opening a temporary file, toggling edit to view and closing the window all prompt to save, discard or cancel when the draft is dirty. A conflict cancels the switch and leaves the banner on the current file.

## `.vimrc` mappings or options are not applied

**Cause:** Vim keybindings are off, the vimrc source is not the file you edited, or an option is not supported by CodeMirror's Vim layer.

**Fix:**

- Check Settings → Editor. Vim keybindings must be on, and the vimrc source must be the one you edited: the default `~/.vimrc`, a custom path, or pasted text.
- The app does not read Neovim's `~/.config/nvim/init.vim` unless you point the custom path at it.
- Options are forwarded to CodeMirror's Vim layer. `tabstop` (`ts`), `shiftwidth` (`sw`), `expandtab` (`et`) and `number` (`nu`) are applied directly; other options only work if that layer supports them. Word wrap comes from Settings → Editor, so `set wrap` and `set nowrap` are ignored.
- Removing a mapping from the vimrc removes it from the editor the next time settings are applied.
- Supported map commands are listed in [Features](features.md#viewing-and-editing). The `vim` badge tooltip shows the applied count and the lines that were skipped.
- Changes apply when you leave Settings; the editor is rebuilt from the new vimrc source.

## Content search finds nothing

**Cause:** The query is outside the active root, the file is ignored, or the result hit a cap.

**Fix:**

- Search only covers the active root and skips hidden folders and the app's ignore list.
- `rg` also respects `.gitignore` and `.ignore` files because `--no-ignore` is not passed. A file ignored there is skipped even when it is inside the root. The built-in fallback uses only the app's ignore list, so results can differ.
- Search is case-insensitive by default in both substring and regex modes. The regex toggle does not change case handling.
- The built-in fallback reads files up to 2 MB and skips files that are not valid UTF-8. Install `rg` (ripgrep) for full coverage and speed.
- Results stop at the caps in [Features: Limits](features.md#limits); narrow the query if the result is truncated.
- Long lines are shortened at 240 characters, so the visible match text may be cut.
- An invalid regular expression is rejected before the search starts.

## Folders or files are missing from the tree

**Cause:** The item was trashed, hidden, ignored, a symlink, or past the tree cap.

**Fix:**

- Deleted items live in `<root>/.mdlite-trash`. They keep their original name; `-<timestamp>` is appended only when the name is already taken. Use the Trash button in the sidebar to browse, restore or permanently delete them.
- Names starting with `.` are hidden. These names are also skipped wherever they appear: `.git`, `node_modules`, `.obsidian`, `.trash`, `.cache`, `dist` and `.mdlite-trash`.
- Symlinks are not followed.
- The tree stops at 20,000 entries. See [Features: Limits](features.md#limits).

## Rename, move or restore says "target already exists"

**Cause:** The destination path is already taken. Rename, transfer and restore never overwrite.

**Fix:** Choose another name or destination. For a trash entry, open the Trash browser and restore it. If the original path is unknown, Restore asks for a relative path; if that path is taken, enter a different free path.

## Images or videos in Markdown do not show

**Cause:** The Markdown path does not resolve, or the file is gone.

**Fix:**

- The path must be relative to the note or start with `/`, which is read as relative to the root. Paths that climb above the root are ignored.
- Use the exact case of the file name. Linux is case-sensitive; macOS volumes may ignore case, so do not rely on it.
- Spaces and other URL characters in the path must be valid in the Markdown link.
- The file must still exist; the app does not cache media.

## Upload fails

**Cause:** The file type is not allowed, the payload is too large, the target folder is missing, or no root is open.

**Fix:**

- Images and videos are capped at 60 MB.
- Allowed extensions are `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `avif`, `bmp`, `mp4`, `webm`, `mov`, `m4v` and `ogv`.
- You do not need to save the note before attaching media while a root is open. For a saved note, the file goes to an `images/` folder beside it. For a temporary file, it goes to `<root>/images/`.
- Confirm the target folder can be created: `images/` beside a saved note, or `<root>/images/` for a temporary file.

## A file without an extension does not open in the editor

**Cause:** The file is binary or not valid UTF-8.

**Fix:** The app reads extensionless files as text only when the bytes are valid UTF-8 and contain no NUL bytes. Otherwise it treats the file as binary and shows the card with **Open with default app**. This check happens on read, so the tree cannot know in advance.

## External links do nothing

**Cause:** The app does not open external `http` and `https` links in the system browser yet.

**Fix:** Copy the URL from the Markdown source until link opening is added. This is a known gap, not a setting.

## Reset the root list and settings

**Cause:** The config file holds the roots, editor settings and shortcuts.

**Fix:** Quit the app, then move or delete `~/.config/mdlite/mdlite.json`. On Windows that is `%USERPROFILE%\.config\mdlite\mdlite.json`.

The next start seeds a root from `MDLITE_ROOT`, or opens the folder picker if that variable is unset, and restores the default editor settings and shortcuts. If `MDLITE_CONFIG` is set, the config is at that path instead.

A config from the earlier OS app-support location, or the older `~/.mdlite.json`, is imported once when the new file does not exist. Delete it as well if you want a completely fresh start; otherwise a later reset can import its roots again.

Removing the config file does not touch your notes. It only forgets the roots, editor settings and shortcuts.

## Windows build fails while linking

**Cause:** Tauri needs the MSVC linker and resource compiler, and the Rust MSVC toolchain.

**Fix:** Follow [Build for Windows](development.md#build-for-windows) to install the required tools and choose the MSVC Rust toolchain. WebView2 must also be present; it is preinstalled on Windows 10 and 11.

## DMG build fails

**Cause:** `npm run bundle:dmg` uses AppleScript to arrange the Finder window.

**Fix:** Run it from a signed-in desktop session, not over SSH or from a headless agent. Use `npm run bundle:mac` if you only need the `.app`.

## macOS blocks the app on another machine

**Cause:** The bundle is ad-hoc signed, not signed with a Developer ID.

**Fix:** On a machine that did not build it, right-click the app and choose Open once, or sign and notarize it with a Developer ID certificate. Locally built copies do not carry the quarantine flag and open normally.
