# Features

mdlite works with one active folder of notes at a time. You can keep several folders in the root list and switch between them. There is no server, no import step and no copy of your notes: every read and write goes to the active folder.

`⌃` means Control on every platform. `⌘` means Command on macOS and Ctrl on Windows or Linux. The default app shortcuts use Control; tree navigation also accepts Command on macOS. The full shortcut list is in the root [README](../README.md#keyboard).

## Browsing

- **Folder view.** The main area lists the current folder in a table with Name, Kind, Size and Modified columns. Name, Size and Modified sort when you click their headers; click again to reverse. Kind is a label only. Breadcrumbs above the table move back up the folder path. Click a folder to enter it; `j` and `k` move the cursor and Enter opens the row.
- **Sidebar tree.** The whole active folder is loaded once and filtered in the app, so typing in the filter is instant. Folders with matches open automatically, so the tree keeps its shape instead of turning into a flat result list.
- **Tree filters.** Filter by path text in `contains`, `glob` or `regex` mode. Add a modified-date range, kind chips (`md`, `code`, `data`, `image`, `draw`, `other`) and size buckets. Sort by name or modified time.
- **Selection.** Shift-click selects a range of tree rows, `⌘`-click or `Ctrl`-click toggles one row, and a plain click clears the selection and opens the row. `⌘A`/`Ctrl+A` selects every visible row and `Esc` clears it. With several rows selected, `d` moves all of them to the trash.
- **Hidden and ignored items.** Any name that starts with a dot is hidden, along with `.git`, `node_modules`, `.obsidian`, `.trash`, `.cache`, `dist` and `.mdlite-trash`. Symlinks are not followed.

## Viewing and editing

| File kind | Opens as |
|---|---|
| Markdown (`.md`, `.markdown`, `.mdx`) | Rendered view with Mermaid, syntax highlighting and links between notes |
| Text and code | CodeMirror editor with syntax highlighting |
| Images | Image view |
| SVG | Image view; switch to the editor to change the markup |
| Excalidraw | Full Excalidraw canvas, always editable |
| No extension | Text when the content is valid UTF-8 without NUL bytes; otherwise the binary card |
| Anything else | A card with an **Open with default app** button |

SVG and Excalidraw files are read as text, so they share the 8 MiB text-read limit. Raster images are not read into the editor and do not hit that limit.

Markdown rendering includes:

- Mermaid diagrams from fenced blocks tagged `mermaid`.
- Code blocks highlighted by Shiki for the supported languages.
- Relative links between notes: clicking one opens the target inside the app.
- Relative images and videos resolved through the Tauri asset protocol, so a note can show media stored beside it.
- A drag handle on images. Dragging writes `{width=N}` after the image in the Markdown source.
- Draggable column edges on tables. Widths are remembered per file on that machine. Both handles also work with the arrow keys when focused.
- Video files embedded in Markdown render with playback controls.
- Search-term highlighting when you jump into a file from content search.

Editing uses CodeMirror 6 with:

- Vim keybindings on by default, and a switch to turn them off in Settings → Editor.
- Word wrap and the main area width, both set in Settings → Editor.
- Syntax modes for about 30 languages, loaded on demand.
- Paste or drop of images and videos directly into the editor, or use the attach button in the header.
- A header copy button: styled rich text in Markdown view, and raw text in edit mode, text files and SVG.

Save and conflicts:

- There is no auto-save on blur and no save timer. Saves happen from the save shortcut, Vim `:w` (also `:update`, `:wq` and `:wa`), the **Save** choice in the save prompt, and **Overwrite** in the conflict banner.
- The app asks **Save** / **Don't save** / **Cancel** when the draft differs from the document and you switch file or folder, open Settings or the trash, switch or remove a root, open a temporary file, toggle from edit to view, or close the window. **Cancel** or a failed save keeps the current view.
- Each save sends the modification time, size and content hash it loaded. For an existing file, an explicit **Overwrite** is the only way to skip that check.
- If the file changed on disk while you had unsaved edits, a conflict banner offers **Reload** or **Overwrite**. **Reload** discards the draft and takes the disk version.

Switching between view and edit keeps your place, measured as a fraction of the document height. In Markdown view, `j` and `k` scroll smoothly by a few lines, `gg` glides to the top and `G` to the bottom. Scrolling respects the system reduced-motion setting.

The vimrc source is `~/.vimrc`, a custom path or pasted text, chosen in Settings → Editor. Pasted text is stored with the app settings and no file is read. Vimrc support covers:

- Mapping commands (`map`, `noremap`, `nmap`, `nnoremap`, `vmap`, `vnoremap`, `xmap`, `xnoremap`, `smap`, `snoremap`, `omap`, `onoremap`, `imap`, `inoremap`), including `<leader>` and `<silent>`.
- `set` options for tab size, indentation, line numbers and `clipboard=unnamed`/`unnamedplus`. Other options depend on the Vim layer.
- With a clipboard option set, unnamed yanks, deletes and changes write to the system clipboard, and returning to the window refreshes the Vim registers from it.
- Changing the vimrc removes mappings that are no longer present. Word wrap comes from the Settings toggle, so `set wrap` and `set nowrap` do not change it.
- The `vim` badge tooltip shows how many lines were parsed, how many mappings were loaded and which lines were skipped.

## Files and folders

- **Create.** `a` creates a file in the tree. The name accepts a relative path, so `notes/today.md` creates nested folders. End the name with `/` to create a folder.
- **Rename.** `r` renames the current row. It rejects an empty name, a name with a slash or backslash, a name that starts with a dot and a name longer than 200 bytes.
- **Move.** `m` opens a folder list and moves the current row, or every marked row, into the chosen folder. The list starts at the item's current parent, filters as you type, and accepts Enter to move or Esc to cancel. The row is saved first, and the move can be undone with `u`.
- **Trash.** `d` moves the current row, or every selected row, to `.mdlite-trash` inside the root. The trash is flat: an entry keeps its name, and a `-<timestamp>` suffix is added only when that name already exists. A hidden `.mdlite-meta-<hash>.json` beside the entry stores the original path and deletion time.
- **Restore.** The Trash button in the sidebar opens the trash browser. Restore uses the stored original path; if the original path is unknown, the browser asks for a relative path. Entries can also be deleted permanently.
- **Existing targets.** Restore, rename and move refuse a target that already exists with "target already exists".
- **Cut, copy, paste.** `x`, `y` and `p` work on the current row and show the pending clipboard item in the tree footer. Paste a copied item into another folder to duplicate it.
- **Context menu.** Right-click a tree row or a folder-table row for New file, Copy, Paste, Rename, Move to trash, Move and Copy path. New file creates the entry inside a folder, or beside a file; a name ending in `/` creates a folder. Paste puts the copied item beside a file or inside a folder. Copy path writes the absolute path to the system clipboard. Right-clicking the empty space below the rows offers New file and Paste in the folder you are viewing.
- **Selection delete.** With several rows selected, one confirm moves all of them to the trash. Nested selections are collapsed: selecting a folder and a file inside it deletes the folder once.
- **Undo.** `u` covers create, rename, move, paste and trash. It lasts for the current session.

## Search

- `⌃E` opens the fuzzy file finder. It ranks paths and highlights the matched characters.
- `⌃G` searches file contents, with an optional regex toggle.
- Search is case-insensitive by default and covers only the active root. Hidden folders and the ignore list are skipped.
- Search prefers the `rg` binary when it is installed. `rg` also respects `.gitignore` and `.ignore` files in the root and its subfolders. If `rg` is missing, a built-in scanner reads text files up to 2 MB.
- Results are capped at 120 files, 6 matches per file and 400 matches total. Long lines are shortened to 240 characters.
- Choosing a match opens the file and highlights the term in rendered Markdown. Code and text files open without a highlight.

## Settings

The gear button opens Settings, with a side menu of four pages:

- **Root folders:** add, switch and remove roots. **Browse…** uses the native folder picker. The last root cannot be removed. The active root is what the tree, search, editor and file operations use. On first run, the app opens the folder picker when no root is configured.
- **Editor:** turn Vim keybindings and word wrap on or off, set the main area width, and choose the vimrc source. The width is clamped to 50–100% of the main pane and applied as horizontal padding on the whole main body, so it affects the folder view, editor, Markdown view, trash and Settings. The sidebar keeps its width. A summary shows the resolved source, the loaded mappings, parsed lines and indentation.
- **Shortcuts:** click a key and press a new combination. Shortcuts are grouped as Global, Editor and File tree. Backspace clears a key, Esc cancels, and each row can be reset to its default. A binding that is already used is rejected; a duplicate that comes from a hand-edited config is flagged.
- **About:** the app version, config file path, current root, vimrc source and the keys that cannot be changed.

Defaults are Vim on, word wrap on, main width 100, vimrc source `~/.vimrc` (automatic) and no shortcut overrides. Changes save automatically after 450 ms.

These keys stay fixed: `Enter`, `Esc`, the arrow keys, `Space` (and their Shift variants), `Ctrl`/`Cmd` with `Tab` (or `Shift`+`Tab`), `N`, `P`, `A` or `←`, and `Ctrl`/`Cmd` with `Q` or `W`. `⌃D`/`⌃U` and `⌃F`/`⌃B` are editor shortcuts. With Vim on, Vim handles them. With Vim off on Windows or Linux, `⌃F` opens CodeMirror's search.

Roots, editor settings and shortcut overrides live in one config file. [Architecture → Storage](architecture.md#storage) covers the path, the one-time import of older configs, the environment variables and what stays in memory.

## Temporary files

Drop a supported text or code file from outside the app onto the window to open it without copying it into the root. The header marks it as `temporary`. `⌃S` opens a native save dialog instead of writing into the folder. Files above 4,000,000 bytes are rejected with "File is too large to open"; the normal text read cap is 8 MiB.

While editing a note in the active folder, dropping or pasting an image or video saves it to an `images/` folder beside the note and inserts the Markdown or `<video>` tag. While editing a temporary file, the media goes to `<root>/images/`, because the temporary file has no folder inside the active folder.

## Live updates

A filesystem watcher reports changes on a 250 ms debounce. The tree refreshes without a manual reload. If the open file changes while you are not editing, the view reloads. If you have unsaved edits, the app shows the conflict banner instead of discarding your work.

## Recent files

The last five opened files are remembered for the session. Hold `⌃` and press `Tab` to cycle through them; release `⌃` to open the highlighted file. `⌃⇧Tab` walks the list backwards and `Esc` cancels.

## Limits

| Limit | Value |
|---|---|
| Text read | 8 MiB |
| Conflict preview | 1 MiB |
| Media upload | 60 MB |
| Tree entries | 20,000 |
| Content search | 120 files, 6 matches per file, 400 total |
| Fallback search file | 2 MB |
| Vimrc text | 200,000 characters |
| Name after rename | 200 bytes |
| Temporary file drop | 4,000,000 bytes |

## Known limitations

- Light theme only.
- One window at a time.
- External `http(s)` links do not open in the system browser. Copy the URL from the Markdown source until this is added.
- There is no sync, no database and no conflict history. Undo lasts only for the current session.
- Only the commands listed in Settings → Shortcuts can be rebound. The fixed keys listed under Settings stay fixed.
- Markdown raw HTML is sanitized with DOMPurify, but notes can still load remote images. Treat notes from other people as content you chose to open.
