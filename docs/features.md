# Features

mdlite opens one folder of notes and works on it directly. There is no server, no import step and no copy of your files: every read and write goes to the folder you choose.

## Browsing

- **Folder view.** The main area lists the current folder in a table with Name, Kind, Size and Modified columns. Click a column header to sort, click again to reverse. Breadcrumbs above the table move back up the folder path.
- **Sidebar tree.** The whole vault is loaded once and filtered in the app, so typing in the filter is instant. Folders with matches open automatically, so the tree keeps its shape instead of turning into a flat result list.
- **Tree filters.** Filter by path text in `contains`, `glob` or `regex` mode. Add a modified-date range, kind chips (`md`, `code`, `data`, `image`, `draw`, `other`) and size buckets. Sort by name or modified time.
- **Selection.** Shift-click selects a range of tree rows, `⌘`-click or `Ctrl`-click toggles one row, and a plain click clears the selection and opens the row. `⌘A`/`Ctrl+A` selects every visible row and `Esc` clears it.
- **Hidden and ignored items.** Any name that starts with a dot is hidden, along with `.git`, `node_modules`, `.obsidian`, `.trash`, `.cache`, `dist` and `.mdlite-trash`. Symlinks are not followed.

## Viewing and editing

| File kind | Opens as |
|---|---|
| Markdown (`.md`, `.markdown`, `.mdx`) | Rendered view with Mermaid, syntax highlighting and live links |
| Text and code | CodeMirror editor with syntax highlighting |
| Images and SVG | Image view; SVG can switch to the editor |
| Excalidraw | Full Excalidraw canvas, always editable |
| No extension | Text when the content is valid UTF-8 without NUL bytes; otherwise the binary card |
| Anything else | A card with an **Open with default app** button |

Markdown rendering includes:

- Mermaid diagrams from fenced blocks tagged `mermaid`.
- Code blocks highlighted by Shiki for the languages listed in `src/lib/markdown.ts`.
- Relative links between notes: clicking one opens the target inside the app.
- Relative images and videos resolved through Tauri's `asset://` protocol, so a note can show media stored beside it.
- A drag handle on images. Dragging writes `{width=N}` after the image in the Markdown source.
- Draggable column edges on tables. Widths are remembered per file in the browser's local storage for that machine.
- Search-term highlighting when you jump into a file from content search.

Editing uses CodeMirror 6 with:

- Vim keybindings on by default, and a switch to turn them off in Settings → Editor.
- Word wrap, toggled in Settings → Editor, and line numbers (line numbers can be turned off in `.vimrc`).
- Syntax modes for about 30 languages, loaded on demand.
- Paste or drop of images and videos directly into the editor.
- Auto-save when the editor loses focus. Switching files with unsaved changes asks before discarding.
- A conflict banner if the file changed on disk while you had unsaved edits. You can reload the disk version or overwrite it.
- The header copy button: styled rich text in Markdown view, raw text in edit mode and in text files.

Vimrc support covers mapping commands (`map`, `noremap`, `nmap`, `nnoremap`, `vmap`, `vnoremap`, `xmap`, `xnoremap`, `omap`, `onoremap`, `imap`, `inoremap`), including `<leader>` and `<silent>`. Parsed `set` options are forwarded to CodeMirror's Vim layer; `tabstop`, `shiftwidth`, `expandtab` and `number` are applied directly, and the rest depend on whether that layer supports them. The `vim` badge tooltip shows how many lines were applied, how many mappings were loaded and which lines were skipped.

The vimrc comes from one of three sources, chosen in Settings → Editor:

- **Default:** `~/.vimrc`.
- **Custom path:** any file you pick, using `~` for your home folder.
- **Paste text:** the text is stored with the app settings and no file is read.

## Files and folders

- **Create.** `a` in the tree creates a file. End the name with `/` to create a folder.
- **Rename.** `r` renames the current row.
- **Trash.** `d` moves the current row, or every selected row, to `.mdlite-trash` inside the root. Each item gets a timestamped name.
- **Restore.** Trash operations can be undone with `u` while the app is open. Undo also covers create, rename, paste and move.
- **Cut, copy, paste.** `x`, `y` and `p` work on the current row and show the pending clipboard item in the tree footer.
- **Duplicate.** Paste a copied item into another folder.
- **Selection delete.** With several rows selected, one confirm moves all of them to the trash. Nested selections are collapsed: selecting a folder and a file inside it deletes the folder once.
- **Name rules.** New names cannot contain slashes, cannot start with a dot and are limited to 200 characters. Existing names are left alone until you rename them.

## Search

- `⌃E` opens the fuzzy file finder. It ranks paths and highlights the matched characters.
- `⌃G` searches file contents. It asks the Rust core for matches, with an optional regex toggle.
- Search prefers the `rg` binary when it is installed. If `rg` is missing, a built-in scanner reads text files up to 2 MB.
- Results are capped: 120 files, 6 matches per file and 400 matches total. Long lines are shortened to 240 characters.
- Choosing a match opens the file and highlights the term in rendered Markdown. Code and text files open without a highlight.

## Settings

The gear button opens Settings, with a side menu of four pages:

- **Root folders:** add, switch and remove roots. **Browse…** uses the native folder picker. The last root cannot be removed. The active root is what the tree, search, editor and file operations use.
- **Editor:** turn Vim keybindings and word wrap on or off, and choose the vimrc source (default file, custom path or pasted text). A summary shows the resolved source and the mappings that were loaded.
- **Shortcuts:** click a key and press a new combination. Shortcuts are grouped as Global, Editor and File tree. Backspace clears a key, Esc cancels, and each row can be reset to its default. Duplicate bindings are flagged.
- **About:** the app version, config file path, current root, vimrc source and the keys that cannot be changed.

Changes save automatically after a short delay and apply when you leave Settings. The `⌃Tab`, `Enter`, arrow-key and `Esc` keys are fixed.

Everything is stored in `~/.config/mdlite/mdlite.json` (`%USERPROFILE%\.config\mdlite\mdlite.json` on Windows). An existing `~/.mdlite.json` is imported once and left in place. `MDLITE_CONFIG` moves the file and `MDLITE_ROOT` seeds the first root when no config exists. On first run the default root is `~/git/notes`.

## Temporary files

Drop a supported text or code file from outside the vault onto the window to open it without copying it into the root. The header marks it as `temporary`. `⌃S` opens a native save dialog instead of writing into the vault.

While editing a note, dropping or pasting an image or video instead saves it to an `images/` folder next to that note and inserts the Markdown or `<video>` tag.

## Live updates

A filesystem watcher reports changes on a 250 ms debounce. The tree refreshes without a manual reload. If the open file changes while you are not editing, the view reloads. If you have unsaved edits, the app shows the conflict banner instead of discarding your work.

## Recent files

The last five opened files are remembered for the session. Hold `⌃` and press `Tab` to cycle through them; release `⌃` to open the highlighted file. `⌃⇧Tab` walks the list backwards and `Esc` cancels.

## Limits

| Limit | Value |
|---|---|
| Text file read | 8 MB |
| Media upload | 60 MB |
| Tree entries | 20,000 |
| Content search | 120 files, 6 matches per file, 400 total |
| Fallback search file size | 2 MB |
| `.vimrc` read | 200,000 characters |
| New or renamed name | 200 characters |

The app has a light theme only, runs in a single window, and does not yet open external `http(s)` links in the system browser. Shortcuts only cover the commands listed in Settings; fixed keys such as `Enter` and `Esc` cannot be rebound.

The complete keyboard list lives in the root [README](../README.md#keyboard).
