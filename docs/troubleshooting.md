# Troubleshooting

## The Dock or app window still shows the old icon

macOS caches app icons. Rebuild first, then refresh Launch Services:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f src-tauri/target/release/bundle/macos/mdlite.app
touch src-tauri/target/release/bundle/macos/mdlite.app
```

Remove the app from the Dock and add it back if the old icon remains.

## `npm run dev` shows a blank window or does not start

- Check the terminal that ran `npm run dev`. A Rust compile error stops the window from opening.
- The Tauri window loads `http://localhost:5173`. Make sure Vite is running and the port is free.
- Development builds allow the webview devtools. Press `Cmd+Alt+I` on macOS or `Ctrl+Shift+I` on Windows to see JavaScript errors.
- If the window opens but the tree is empty, open Settings and confirm the root folder exists and is readable.

## A file will not open: "file is too large to open"

Text reads are capped at 8 MB. Open large files in another editor. Media files are not loaded into the editor and are not affected by this limit.

## The conflict banner appeared

The file changed on disk after you loaded it. Choose:

- **Reload** to discard your edits and take the disk version.
- **Overwrite** to write your version over the disk file.

The save check compares modification times. If another program rewrites the file without changing its mtime, the app cannot detect the change.

## `.vimrc` mappings or options are not applied

- Check Settings → Editor. Vim keybindings must be on, and the vimrc source must be the one you edited: the default `~/.vimrc`, a custom path, or pasted text.
- The app does not read Neovim's `~/.config/nvim/init.vim` unless you point the custom path at it.
- Options are forwarded to CodeMirror's Vim layer. `tabstop` (`ts`), `shiftwidth` (`sw`), `expandtab` (`et`) and `number` (`nu`) are applied directly; other options only work if that layer supports them.
- Supported map commands are listed in [Features](features.md#viewing-and-editing). The `vim` badge tooltip shows the applied count and the lines that were skipped.
- Changes apply after you leave Settings and open the editor again.

## Content search finds nothing

- Search only covers the active root and skips hidden folders and the ignore list.
- The built-in fallback reads files up to 2 MB and skips files that are not valid UTF-8. Install `rg` (ripgrep) for full coverage and speed.
- Results stop at 120 files, 6 matches per file and 400 matches total. Narrow the query if the result is truncated.
- An invalid regular expression is rejected before the search starts.

## Folders or files are missing from the tree

- Names starting with `.` are hidden. These names are also skipped wherever they appear: `.git`, `node_modules`, `.obsidian`, `.trash`, `.cache`, `dist` and `.mdlite-trash`.
- Symlinks are not followed.
- The tree stops at 20,000 entries. A very large root will be incomplete by design.

## Images or videos in Markdown do not show

- The path must be relative to the note or start with `/`, which is read as relative to the root. Paths that climb above the root are ignored.
- Use the exact case of the file name. Linux is case-sensitive; macOS volumes may ignore case, so do not rely on it.
- Spaces and other URL characters in the path must be valid in the Markdown link.
- The file must still exist; the app does not cache media.

## Upload fails

- Images and videos are capped at 60 MB.
- Allowed extensions are `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `avif`, `bmp`, `mp4`, `webm`, `mov`, `m4v` and `ogv`.
- The note must be saved somewhere inside the root before media can be attached, because uploads go to an `images/` folder beside it.

## A file without an extension does not open in the editor

The app reads extensionless files as text only when the bytes are valid UTF-8 and contain no NUL bytes. Otherwise it treats the file as binary and shows the card with **Open with default app**. This check happens on read, so the tree cannot know in advance.

## External links do nothing

Links to `http` and `https` pages are marked for a new window, but the app does not open the system browser yet. This is a known gap, not a setting. Copy the URL from the Markdown source until link opening is added.

## Reset the root list and settings

Quit the app, then move or delete `~/.config/mdlite/mdlite.json`. On Windows that is `%USERPROFILE%\.config\mdlite\mdlite.json`.

The next start seeds a root from `MDLITE_ROOT`, or `~/git/notes` if that variable is unset, and restores the default editor settings and shortcuts. If `MDLITE_CONFIG` is set, the config is at that path instead.

A config from the earlier OS app-support location, or the older `~/.mdlite.json`, is imported once when the new file does not exist. Delete it as well if you want a completely fresh start; otherwise a later reset can import its roots again.

Removing the config file does not touch your notes. It only forgets the roots, editor settings and shortcuts.

## Windows build fails while linking

Install the Visual Studio Build Tools with the **Desktop development with C++** workload. Tauri needs the MSVC linker and resource compiler. Also install the Rust MSVC toolchain. On a normal x64 Windows machine:

```bash
rustup default stable-msvc
```

or choose the MSVC option when installing Rust.

WebView2 must be present; it is preinstalled on Windows 10 and 11.

## DMG build fails

`npm run bundle:dmg` uses AppleScript to arrange the Finder window. Run it from a signed-in desktop session, not over SSH or from a headless agent. Use `npm run bundle:mac` if you only need the `.app`.

## macOS blocks the app on another machine

The bundle is unsigned. On a machine that did not build it, right-click the app and choose Open, or sign and notarize it with a Developer ID certificate. Locally built copies do not carry the quarantine flag and open normally.

## Known limitations

- Light theme only.
- Single window.
- External links are not opened in the system browser.
- No sync, no database and no conflict history: undo exists only for the current session.
- Shortcuts cover the commands listed in Settings. `Ctrl+Tab`, `Enter`, the arrow keys and `Esc` stay fixed.
- Markdown is rendered with raw HTML enabled, so notes are treated as trusted content.
