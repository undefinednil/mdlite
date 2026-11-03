---
name: mdlite-frontend-styling
description: Visual and CSS conventions for the mdlite React frontend. Use when adding or changing screens, settings pages, dialogs, forms, tables, trees, or any styling in this repository.
---

# mdlite frontend styling

mdlite has one visual language: a light, calm, document-first desktop app. The React layer holds no styling library. All CSS lives in `src/styles.css`, and every component reuses the same tokens and primitives. Match an existing screen before inventing a new pattern.

## Ground rules

- Put app styles in `src/styles.css`. There is no CSS framework and no CSS-in-JS. The CodeMirror theme is the one exception: it is an object in `src/components/Editor.tsx`. Third-party widgets such as CodeMirror, Excalidraw, Mermaid, and Shiki handle their own styling.
- Read tokens from `:root` and prefer them for every surface, border, and text color. A few legacy rules still use literal whites; do not add more.
- The app is light theme only. Do not add dark-mode branches.
- Use `material-symbols-rounded` for icons. The default size is 18px; adjust it only for a specific component.
- Use real `<button>` elements. Give icon-only buttons a `title` and unlabeled controls an `aria-label`.
- Keep class names kebab-case. Put state in a second class: `active`, `selected`, `marked`, `cut`, `recording`, `empty`.
- Use inline styles only for dynamic geometry, such as tree row position, picker indentation, or generated widths.
- Add new selectors next to the block they belong to. The stylesheet follows the screen order: tokens, reset, sidebar, tree, main, buttons, overlays, palette, folder view, media, Markdown, editor, drop zone, settings, dialogs, recent-file cycle, trash.

## Tokens

| Variable | Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | Main canvas |
| `--panel` | `#f7f8fa` | Sidebar, headers, inset panels |
| `--panel-alt` | `#f1f3f6` | Muted surfaces, segmented controls |
| `--border` | `#e3e6ea` | Dividers and quiet borders |
| `--border-strong` | `#d3d8df` | Inputs, dialogs, controls |
| `--fg` | `#1f2328` | Primary text |
| `--fg-dim` | `#4b5563` | Body and secondary text |
| `--fg-muted` | `#6b7280` | Metadata, labels, placeholders |
| `--accent` | `#2563eb` | Action, focus, selection |
| `--accent-soft` | `#2563eb12` | Selected rows, active chips, focus rings |
| `--accent-strong` | `#1d4ed8` | Primary hover and pressed states |
| `--danger` | `#dc2626` | Destructive actions and errors |
| `--mark` | `#f59e0b` | Dirty marker |
| `--mono` | system monospace stack | Paths, code, key bindings |
| `--sidebar-width` | `296px` | App sidebar |
| `--main-width` | `100%` default | Content width; `.main-body` uses it for horizontal padding. Set in Settings → Editor, 50–100%. |

Status colors use the same families already in the file: green `#15803d` / `#ecfdf5`, amber `#92400e` / `#fef3c7`, red `#b91c1c` / `#fef2f2`.

## Type and spacing

- Base font is Inter with the system stack, 14px.
- Settings page titles are 23px with a tight tracking. Markdown body is 15px with `line-height: 1.7`.
- Metadata and helpers are 11–13px in `--fg-muted`.
- Uppercase labels are 9.5–11px with 0.06–0.09em letter spacing.
- Paths, code, shortcuts, and tabular values use `--mono`.
- Radii: 4px badges, 6px buttons and inputs, 7–8px fields and pickers, 10–12px cards and dialogs, 999px chips and pills.
- Spacing uses a small rhythm: 6, 8, 10, 12, 14, 16px. Page padding is 24–48px; settings sections leave 30px below.
- Most text fields get a 3px `var(--accent-soft)` ring plus an accent border; compact number and date fields use an accent border only. Buttons and other controls get a 2px accent outline with a 2px offset. Do not leave a focused control without a visible cue.
- Hover is restrained: white on tree rows, accent on interactive text, a slightly stronger border on controls. Transitions are 0.12–0.15s ease.

## Layout

- `.app` is a full-height grid: `var(--sidebar-width) minmax(0, 1fr)`. The page itself never scrolls.
- `.sidebar` is a flex column: 46px header, filter area, scrolling tree, footer.
- `.main` is a flex column: 46px header on `--panel`, then a body that scrolls in view mode and clips in edit mode.
- `.main-body` has left and right padding of `calc((100% - var(--main-width)) / 2)`. The Main area width setting therefore changes the content width in the folder view, editor, Markdown, trash and Settings.
- Tree rows are 26px tall and virtualized. Folder-table rows are 38px.
- Markdown, media, settings and trash views are centered with a maximum width of about 1000–1100px.
- Overlays for the palette, dialogs, recent-file cycle, and drop zone are fixed and sit above the app.
- The settings page is a 186px sticky side menu plus a panel. Below 1200px the menu stacks above the panel.

## Primitives

Reuse these instead of new controls:

- `.btn`, `.btn.primary`, `.btn.danger` for actions.
- `.icon-btn` for a single Material icon in a 28px square.
- `.chip`, `.chip.small`, `.chip.active` for filters and segmented tags.
- `.text-input`, `.text-input.mono`, `.text-input.narrow` for text fields.
- `.segmented` for two or three mutually exclusive choices.
- `.switch` with an input and `.switch-track` for booleans.
- `.key-button` for recorded shortcuts.
- `.dialog`, `.overlay`, `.dialog-actions`, `.dialog-message` for modal work.
- `.context-menu` for right-click file actions; fixed, icon plus label, with disabled and danger states.
- `.toast` for errors and `.toast.info` for neutral confirmations.
- `.settings-section`, `.settings-section-title`, `.setting-list`, `.setting-row`, `.setting-copy`, `.setting-title`, `.setting-help` for settings pages.
- `.setting-number` for a number input with a `%` suffix, used by the Main area width setting.

## Component notes

- **Dialogs.** A 440px card on a dimmed, blurred overlay, capped to the viewport height and scrollable; a folder picker may widen to 560px. Messages are 13.5px. Actions sit right aligned. The save prompt has three actions: Save (primary), Don't save (danger), and Cancel.
- **Folder picker.** A bordered list capped at 320px tall. Rows show an icon, a name, and a right-aligned muted monospace path for folders. The active row uses `--accent-soft`.
- **Palette.** A 760px card capped at 70vh, a 15px search field with a bottom border only, accent-soft on the active row, and monospace content matches.
- **Recent files.** A centered card 380–560px wide, 14vh from the top, with icon, file name, and muted directory per row.
- **Settings.** Use section titles in uppercase muted text. A setting row is a white bordered card with a title, one-line help, and a control. Group related rows with `.setting-list`. Number inputs use `type="number"` with min/max and an `aria-label`; they keep a text draft, and blur or Enter commits the clamped value.
- **Trees and tables.** Hover uses white or `--panel`. Active selection uses `--accent-soft`; a marked multi-selection uses solid `--accent` with white text. Metadata is muted and right aligned.
- **Markdown.** Headings are dark blue; links use the accent; inline code is a soft pink; blockquotes are pale blue; tables have quiet borders and zebra rows. Table cells and inline code use `overflow-wrap: anywhere` so long code tokens wrap instead of breaking the table. Code blocks keep the `github-light` Shiki theme.
- **Editor.** CodeMirror uses a white canvas, 14.5px monospace text, 1.75 line height, centered content up to 1100px, an accent caret, and a light blue selection. Fenced and indented code blocks get a full-line `#f6f8fa` background; inline code uses teal text without a background.
- **Empty states.** Centered or padded muted text, usually 12.5px. Keep them short and literal.

## Do not

- Add a UI library, a CSS framework, or a second global stylesheet.
- Introduce a new color, shadow, radius, or spacing scale when a token or existing value fits.
- Style by tag where a class exists.
- Use decorative animation. Motion should only confirm state changes.
- Write clever or branded copy. Labels are short and literal.
