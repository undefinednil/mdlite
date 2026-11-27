# Features

mdlite works with one or more active root folders. You can keep several folders in the root list and choose which ones appear in the sidebar; every active root gets a normal root row in the tree, and a single root hides that row. There is no server, no import step and no copy of your notes: every read and write goes to the root that owns the file.

`⌃` means Control on every platform. `⌘` means Command on macOS and Ctrl on Windows or Linux. The default app shortcuts use Control; tree navigation also accepts Command on macOS. The full shortcut list is in the root [README](../README.md#keyboard).

## Browsing

- **Folder view.** The main area lists the current folder in a table with Name, Kind, Size and Modified columns. Name, Size and Modified sort when you click their headers; click again to reverse. Name starts A–Z, Size starts smallest first and Modified starts newest first, the same order as the tree. Kind is a label only. Breadcrumbs above the table move back up the folder path. Click a folder to enter it; `j` and `k` move the cursor and Enter opens the row. The cursor starts on the first row when a folder opens.
- **Sidebar tree.** Each active root is loaded once and filtered in the app, so typing in the filter is instant. Root folders are normal tree rows at the top; their contents are indented underneath. With one root the root row is hidden, so the tree looks exactly like a single-folder tree. Folders with matches open automatically, so the tree keeps its shape instead of turning into a flat result list. `Ctrl+←` folds every folder and root row, even while a filter is active. Rows show the same per-kind icon as the folder table.
- **Tree filters.** Filter by path text in `contains`, `glob` or `regex` mode. Add a modified-date range, kind chips (`md`, `code`, `data`, `image`, `draw`, `other`) and size buckets. Sort by name or modified time; folders stay first and the folder table uses the same order.
- **Selection.** Shift-click selects a range of tree rows, `⌘`-click or `Ctrl`-click toggles one row, and a plain click clears the selection and opens the row. `⌘A`/`Ctrl+A` selects every visible row and `Esc` clears it. With several rows selected, `d` moves all of them to the trash. The tree, folder table and command palette share one selection model: the tree cursor follows the open file, and a rename or move carries the cursor and selection to the new path. The folder picker in Move keeps its own active row because it lists folders, not notes.
- **Hidden and ignored items.** Any name that starts with a dot is hidden, along with `.git`, `node_modules`, `.obsidian`, `.trash`, `.cache`, `dist` and `.mdlite-trash`. Symlinks are not followed.

## Viewing and editing

| File kind | Opens as |
|---|---|
| Markdown (`.md`, `.markdown`, `.mdx`) | Rendered view with Mermaid, syntax highlighting and links between notes |
| Text and code | CodeMirror editor with syntax highlighting |
| Images | Image view |
| SVG | Image view; switch to the editor to change the markup |
| HTML (`.html`, `.htm`) | Sandboxed browser preview; switch to the editor to change the markup |
| Excalidraw | Full Excalidraw canvas, always editable |
| No extension | Text when the content is valid UTF-8 without NUL bytes; otherwise the binary card |
| Anything else | A card with an **Open with default app** button |

SVG, HTML and Excalidraw files are read as text for the editor, so they share the 8 MiB text-read limit. Raster images are not read into the editor and do not hit that limit.

HTML opens in a sandboxed iframe with an opaque origin. It fills the main area regardless of the width setting. Relative CSS and classic scripts load; ES modules, `fetch` and storage do not. The preview takes focus when it opens, so the page's own keyboard actions work; the app's shortcuts are forwarded from the iframe. The app's find keys do not reach the page, but `j`, `k`, `gg` and `G` scroll it. The preview renders the saved source, so switching from a dirty draft to view saves or discards first.

One extension table drives the tree icon, the kind filter, the editor language and the drop check, so a file the tree opens as text, such as `.rs`, `.tf` or `.vue`, can also be dropped on the window.

Markdown rendering includes:

- Mermaid diagrams from fenced blocks tagged `mermaid`. Each diagram has a zoom control in its top-right corner: zoom out, the current percentage, and zoom in. The percentage button resets it to 100%.
- Code blocks highlighted by Shiki for the supported languages, including `hcl` for Terraform.
- Relative links between notes: clicking one opens the target inside the app.
- External `http(s)` links open in the system browser.
- Relative images and videos resolved through the Tauri asset protocol, so a note can show media stored beside it.
- A drag handle on images. Dragging writes `{width=N}` after the image in the Markdown source.
- Draggable column edges on tables. Widths are remembered per file on that machine. Both handles also work with the arrow keys when focused.
- Video files embedded in Markdown render with playback controls.
- Search-term highlighting when you jump into a file from content search.

Editing uses CodeMirror 6 with:

- Vim keybindings on by default, and a switch to turn them off in Settings → Vim.
- Word wrap and the main area width, both set in Settings → Editor.
- Syntax modes for about 30 languages, loaded on demand.
- Paste or drop of images and videos directly into the editor, or use the attach button in the header.
- A header copy button: styled rich text in Markdown view, and raw text in edit mode, text files and SVG. HTML has no copy button in the preview.

Save and conflicts:

- There is no auto-save on blur and no save timer. Saves happen from the save shortcut, Vim `:w` (also `:update`, `:wq` and `:wa`), the **Save** choice in the save prompt, and **Overwrite** in the conflict banner.
- The app asks **Save** / **Don't save** / **Cancel** when the draft differs from the document and you switch file or folder, open Settings or the trash, toggle or remove a root, open a temporary file, toggle from edit to view, or close the window. **Cancel** or a failed save keeps the current view.
- Each save sends the modification time, size and content hash it loaded. For an existing file, an explicit **Overwrite** is the only way to skip that check.
- If the file changed on disk while you had unsaved edits, a conflict banner offers **Reload** or **Overwrite**. **Reload** discards the draft and takes the disk version.

Switching between view and edit keeps your place, measured as a fraction of the document height. In view mode, `j` and `k` scroll smoothly by a few lines, `gg` glides to the top and `G` to the bottom. `Ctrl+D` and `Ctrl+U` scroll half a screen in the reading view and in the editor; in the editor the cursor keeps its screen row. In any text input outside the editor, `Ctrl+U` clears the field. Scrolling respects the system reduced-motion setting.

The main area zooms from 50% to 300% with `Ctrl` (or `Cmd`) plus the scroll wheel, and with `Ctrl`/`Cmd` `+`, `-` and `0` (reset). The zoom covers the whole main area, both the reading view and the editor, and keeps the point at the centre of the main area in place. As it grows, the column first widens until it fills the pane, then the main area scrolls sideways. Zoom starts at 100% after a restart and returns to 100% when you switch to another file. Excalidraw drawings use the full main area width and keep their own zoom; the main zoom leaves them alone. HTML view uses the full main width and handles its own zoom inside the preview: `Ctrl` + wheel or `Ctrl` + `+`/`-`/`0` in the page scales the preview, while the app's main zoom leaves it alone. The painting follows the preview's scroll but not that internal zoom. Drag with the middle mouse button to pan the main area, which is handy once it is zoomed in.

`Ctrl+F` finds inside the open note. The reading view shows a find bar in the top-right corner with the match count, previous and next buttons, `Enter` / `Shift+Enter` to step and `Esc` to close; every match is highlighted and the active one scrolls into view. In the editor, the same key opens CodeMirror's search panel, styled as the same floating card. Next and Previous move the cursor to the match instead of selecting the whole match, so a later mouse click does not extend a selection.

The pen button next to the Edit toggle turns the main area into a drawing surface for presentations. It is offered for every file in view mode except Excalidraw. `Ctrl+Shift+W` toggles the pen (change it in Settings → Shortcuts), and Settings → Editor can hide the floating pen and View/Edit buttons; their shortcuts still work. Draw freehand in the picked colour; the 3px stroke suits handwriting. The eraser removes whole strokes instead of pixels, and `Ctrl+Z` / `Ctrl+Shift+Z` (or the Undo and Redo buttons) walk the stroke history. The drawing is anchored to the page, so it scrolls and zooms with the note and follows the editor's internal scroll. In an HTML preview it follows the preview's scroll but not the preview's own zoom. The pen toolbar stays fixed. Closing the pen keeps the drawing; reopen it with the button or `Ctrl+Shift+W`. `Esc` also closes the pen. The drawing is cleared when the open file changes or closes. **Clear** erases the drawing and is undoable. The wheel still scrolls the note, `Ctrl` + wheel still zooms the main area, and the middle mouse button still pans the main area.

Vim keybindings are configured in Settings → Vim. The app does not read `~/.vimrc`. The settings are:

- **Leader key.** One key, default `Space`. Used by `<leader>` in remaps and editor shortcut bindings.
- **Clipboard.** Three targets: yank, delete/change and paste. Each uses the unnamed register, the system clipboard, or (for delete/change) the black hole. The defaults yank and paste through the system clipboard and send deletes to the black hole. `+` and `*` always read and write the system clipboard through the Tauri plugin. A visual yank can keep the selection.
- **Line numbers.** Off, absolute or relative.
- **Scroll offset.** Keep this many lines visible above and below the cursor, like VS Code's `editor.cursorSurroundingLines`. Default 10; 0 turns it off.
- **Indentation.** Tab size, indent width, and spaces versus tabs.
- **Search.** Ignore case and smart case for the reading-view find bar. Vim's `/` search and the editor's search panel keep their own case toggles.
- **Remaps.** A table of mode, left-hand side and right-hand side. `<leader>` is accepted on both sides. Multi-key left-hand sides such as `<leader>ss` work: after a prefix the editor waits up to 600 ms for the next key. Register prefixes such as `"+` are not supported; the clipboard settings choose the register.
- **Save.** `:w`, `:update`, `:wq` and `:wa` call the same save command as `Ctrl+S`.
- **Unsupported.** Vimrc commands, autocommands, functions, `<expr>` mappings, persistent undo, `scrolloff`, `:set` at the ex prompt, and confirm-each replace. Word wrap comes from the Settings toggle.

These settings apply only while Vim keybindings are on. Turning Vim off disables the controls and restores the editor defaults: no line-number gutter, 4-space tabs with a 2-space indent, no scroll offset, and ignore-case search without smart case.

## Files and folders

- **Create.** `a` creates a file in the tree. The name accepts a relative path, so `notes/today.md` creates nested folders. End the name with `/` to create a folder.
- **Rename.** `r` renames the current row. It rejects an empty name, a name with a slash or backslash, a name that starts with a dot and a name longer than 200 bytes.
- **Move.** `m` opens a folder list and moves the current row, or every marked row, into the chosen folder. The list starts at the item's current parent, filters as you type, and accepts Enter to move or Esc to cancel. You can also drag a tree row onto a folder, or onto the empty tree background to move it to the root. Dragging always moves; it never copies. The row is saved first, and the move can be undone with `u`.
- **Trash.** `d` moves the current row, or every selected row, to `.mdlite-trash` inside the root. The trash is flat: an entry keeps its name, and a `-<timestamp>` suffix is added only when that name already exists. A hidden `.mdlite-meta-<hash>.json` beside the entry stores the original path and deletion time.
- **Restore.** The Trash button in the sidebar opens the trash browser. Restore uses the stored original path; if the original path is unknown, the browser asks for a relative path. Entries can also be deleted permanently.
- **Existing targets.** Restore, rename and move refuse a target that already exists with "target already exists".
- **Cut, copy, paste.** `x`, `y` and `p` work on the current row and show the pending clipboard item in the tree footer. Paste a copied item into another folder to duplicate it.
- **Context menu.** Right-click a tree row or a folder-table row for New file, Copy, Paste, Rename, Move to trash, Move, Reveal (Finder on macOS, File Explorer on Windows, the file manager on Linux) and Copy path. New file creates the entry inside a folder, or beside a file; a name ending in `/` creates a folder. Paste puts the copied item beside a file or inside a folder. Copy path writes the absolute path to the system clipboard. Right-clicking the empty space below the rows offers New file and Paste in the folder you are viewing.
- **Selection delete.** With several rows selected, one confirm moves all of them to the trash. Nested selections are collapsed: selecting a folder and a file inside it deletes the folder once.
- **Undo.** `u` covers create, rename, move, paste and trash through the same pipeline. It lasts for the current session and is kept per root. Every file operation checks its root after its dialog; if that root was removed, the operation is cancelled and nothing is written.
- **Close.** The close button in the header, or `Ctrl+W`, closes the open file after the save prompt if it has unsaved changes. The folder view for that file's folder is shown. A temporary file closed this way asks where to save it, unless it has no changes. The same shortcut closes Settings and Trash.
- **Missing or unreadable files.** If a file cannot be opened, the main area shows a card with an icon, the reason, the path, **Try again** and **Close**. A file that is gone reads "File not found". The close button in the header and `Ctrl+W` work here too, so a failed open never traps the view.

## Search

- `⌃E` opens the fuzzy file finder. It ranks paths and highlights the matched characters.
- `⌃G` searches file contents, with an optional regex toggle.
- Search is case-insensitive by default and covers every active root. Hidden folders and the ignore list are skipped.
- Search prefers the `rg` binary when it is installed. `rg` also respects `.gitignore` and `.ignore` files in the root and its subfolders. If `rg` is missing, a built-in scanner reads text files up to 2 MB.
- Results are capped at 120 files, 6 matches per file and 400 matches total. Long lines are shortened to 240 characters.
- Choosing a match opens the file and highlights the term in rendered Markdown. Code and text files open without a highlight.

## Settings

The gear button opens Settings, with a side menu of five pages:

- **Root folders:** add and remove roots, and toggle which roots are active. Every active root appears as a normal root row in the file tree; all of them are editable and search covers all of them. With one root the root row is hidden. **Browse…** uses the native folder picker. The last root can be removed, and an empty root list is valid. When no root is configured, the app shows the Open a folder screen; choose a folder there or open Settings.
- **Editor:** turn word wrap on or off, set the main area width, set the sidebar width and choose whether the floating View/Edit and pen buttons appear. The main width is clamped to 50–100% of the main pane and applied as horizontal padding on the whole main body, so it affects the folder view, editor, Markdown view, trash and Settings. Excalidraw drawings and HTML view mode ignore the setting and use the full main area width. The sidebar width is in pixels (0 hides it; drag the left edge or click the resize handle to bring it back). Dragging the sidebar edge updates and saves the same setting. The View/Edit and pen shortcuts keep working when their buttons are hidden.
- **Vim:** turn Vim keybindings on or off and configure the leader key, clipboard targets, line numbers, scroll offset, indentation, search and remaps. The controls below the switch are disabled while Vim is off, and none of them takes effect: the editor uses fixed defaults (no gutter, 4-space tabs with a 2-space indent, no scroll offset, ignore-case search).
- **Shortcuts:** click a key and press a new combination. Shortcuts are grouped as Global, Editor and File tree. Backspace clears a key, Esc cancels, and each row can be reset to its default. A binding that is already used is rejected; a duplicate that comes from a hand-edited config is flagged.
- **About:** the app version, config file path, current root, Vim state, the fixed keys, and a button that opens the Shortcuts page.

Defaults are Vim on, leader `Space`, yank and paste through the system clipboard, deletes to the black hole, relative line numbers, scroll offset 10, 2-space indentation, ignore case with smart case, word wrap on, main width 100, sidebar width 296, both floating view buttons shown and no shortcut overrides. Changes save automatically after 450 ms.

These keys stay fixed: `Enter`, `Esc`, the arrow keys, `Space` (and their Shift variants), `Ctrl`/`Cmd` with `N`, `P`, `A` or `←`, and `Ctrl`/`Cmd` with `Q`. `Cmd` with `W` stays reserved for the window, and `Cmd`+`Tab` stays with the system. `Ctrl`+`Tab` is the default recent-file shortcut and can be changed in Settings. `⌃D`/`⌃U` are half-page scroll commands outside inputs, `⌥↓`/`⌥↑` move a full page, and `⌥⇧↓`/`⌥⇧↑` move the cursor to the visible edge without scrolling. They work with Vim on or off. The app also keeps `⌃S`, `⌃W`, `⌃E`, `⌃H`, `⌃L` and `⌃F` as defaults.

Roots, editor settings and shortcut overrides live in one config file. [Architecture → Storage](architecture.md#storage) covers the path, the one-time import of older configs, the environment variables and what stays in memory.

## Temporary files

Drop a file the tree opens as text from outside the app onto the window to open it without copying it into the root. The header marks it as `temporary`. `⌃S` opens a native save dialog instead of writing into the folder. Files above 4,000,000 bytes are rejected with "File is too large to open"; the normal text read cap is 8 MiB.

While editing a note, dropping or pasting an image or video saves it to an `images/` folder beside the note and inserts the Markdown or `<video>` tag. While editing a temporary file, the media goes to the focused root's `images/` folder, because the temporary file has no folder inside a root.

## Live updates

A filesystem watcher reports changes on a 250 ms debounce. The tree refreshes without a manual reload. If the open file changes while you are not editing, the view reloads. If you have unsaved edits, the app shows the conflict banner instead of discarding your work.

## Recent files

The last five opened files are remembered for the session. Hold `⌃` and press `Tab` (the default; change it in Settings → Shortcuts) to cycle through them, then press `Enter` to open the highlighted file; `⌃⇧Tab` walks the list backwards and `Esc` cancels. Releasing `⌃` leaves the menu open. While the menu is open, `⌃N` and `⌃P` move the highlight down and up, the same keys that move through the tree, the folder table and the finder. The history button in the sidebar opens the same list; click a row to open it. Each file keeps the scroll position it had when you left it.

## Limits

| Limit | Value |
|---|---|
| Text read | 8 MiB |
| Conflict preview | 1 MiB |
| Media upload | 60 MB |
| Tree entries | 20,000 |
| Content search | 120 files, 6 matches per file, 400 total |
| Fallback search file | 2 MB |
| Vim remaps | 200 |
| Scroll offset | 0–50 lines |
| Name after rename | 200 bytes |
| Temporary file drop | 4,000,000 bytes |

## Known limitations

- Light theme only.
- One window at a time.
- There is no sync, no database and no conflict history. Undo lasts only for the current session.
- Only the commands listed in Settings → Shortcuts can be rebound. The fixed keys listed under Settings stay fixed.
- Markdown raw HTML is sanitized with DOMPurify, but notes can still load remote images. Treat notes from other people as content you chose to open.
