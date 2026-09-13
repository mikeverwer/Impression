# Impression

Impression is a lightweight desktop markdown editor with a live print-style preview, built with Tauri v2 and vanilla JS.

## Toolchain

- Rust (stable, MSVC) at `D:\Languages\Rust`
- Node.js LTS (portable) at `D:\Languages\Node`
- Visual Studio C++ build tools and the WebView2 runtime

Both `D:\Languages\Rust\cargo\bin` and `D:\Languages\Node` are on the user PATH; open a fresh terminal after install so it picks them up.

## Run

```bash
npm install
npm run tauri dev
```

The first Rust build takes a minute or two; later builds are incremental.

Frontend-only work: `npm run dev` then open `http://localhost:1420/?sample` in a browser. File dialogs, native menus and the context menu need the Tauri runtime, everything else works in a plain browser.

## Build an installer

```bash
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/`.

## Layout

| Path | Purpose |
|------|---------|
| `src/main.js` | Wires everything: documents/tabs, actions, shortcuts, resizer, close handling |
| `src/editor.js` | CodeMirror 6 setup, theme, markdown highlighting, bold/italic toggles |
| `src/render.js` | markdown-it pipeline, highlight.js, source-line stamping, KaTeX + Mermaid pass |
| `src/sync.js` | Scroll sync and jump-to-source over the shared `data-source-line` map |
| `src/menu.js` | Native app menu and preview context menu (Tauri menu API) |
| `src/files.js` | Open/save dialogs and file I/O (Tauri dialog + fs plugins) |
| `src/print.js` | PDF export: light theme, force `<details>` open, `window.print()` |
| `src/theme.js` | OS theme detection, live updates, saved preference |
| `src/styles.js` | Preview stylesheet manager: styles folder, default/user sheets, live apply |
| `src/styles/variables.css` | Light/dark tokens and theme transitions |
| `src/styles/preview.css` | Built-in preview stylesheet: document styles, `--hl-*` token colours, page setup (user-editable copy) |
| `src/styles/print.css` | `@media print` rules that hide the app chrome |
| `src-tauri/` | Rust side: plugin registration only |

## Preview stylesheets

The preview (and the PDF) is styled by one stylesheet at a time. View > Preview Style lists what's available:

- **Default** is built into the app and also written to `%APPDATA%\com.mikeverwer.impression\styles\default.css` on every launch, so it is always pristine.
- **Edit Preview Styles** (Ctrl+Shift+E) opens `user_styles.css` in a tab, creating it from the default the first time. If other `.css` files exist in the folder it opens the only one, or asks which to edit when there are several.
- Any `.css` file you drop into the styles folder appears in the list after Refresh List (or the next time the window gets focus).
- Edits to the active stylesheet apply to the preview live; Ctrl+S saves them. While a stylesheet tab is active the preview keeps showing your most recent markdown document.

## Outline

The button at the left end of the tab bar, View > Outline, or Ctrl+Shift+O slides in a heading outline to the left of the editor. Headings nest by level with collapsible subtrees (collapse state is kept per tab), the heading containing the cursor is highlighted, and clicking one scrolls the editor (and the preview through scroll sync) to it without moving the cursor.

## Writing mode

View > Writing Mode (Ctrl+Shift+W) collapses the preview and renders markdown inline in the editor, Obsidian-style: heading, emphasis, code, link and strikethrough markers are hidden, `>` becomes a quote bar, bullets become •, task markers become clickable checkboxes and `---` becomes a rule. The line under the cursor always shows its raw source. Fenced code, tables, math, images, footnotes and definition lists stay as source (the preview and PDF still render them). Turning the mode off restores the preview.

Writing mode is drawn by the editor, not by the preview stylesheet, so it can't pick up arbitrary rules from `user_styles.css`. It does use the same design tokens (`--font-markdown`, `--color-accent`, `--color-body-text`, `--color-inline-code-text`), so overriding those in a user stylesheet changes both. Export to PDF works from writing mode; it renders the hidden preview for the print.

Chromium's print dialog adds date/title headers and footers by default. Untick "Headers and footers" under More settings once; the app's WebView2 profile remembers the choice. There is no API to preset it.

## Shortcuts

| Keys | Action |
|------|--------|
| Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | New / Open / Save / Save As |
| Ctrl+P | Export to PDF (native print dialog) |
| Ctrl+Shift+P | Show / hide the preview pane |
| Ctrl+Shift+W | Writing mode (inline rendering, preview collapsed) |
| Ctrl+Shift+O | Show / hide the outline |
| Ctrl+Shift+E | Edit preview styles |
| Ctrl+Shift+. / Ctrl+Shift+, | Editor font size up / down (also Ctrl+wheel over the editor; reset via View menu) |
| Ctrl+Shift+] / Ctrl+Shift+[ | Preview zoom in / out (also Ctrl+wheel over the preview; reset via View menu) |

Ctrl with `=`, `-` or `0` can't be used for these: the webview reserves those combinations as browser zoom keys and never passes them to the app.
| Ctrl+W | Close tab |
| Ctrl+Tab, Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+B / Ctrl+I | Toggle bold / italic |
| Ctrl+F | Find in editor |
| Right-click in preview | Copy, Select All, Jump to Source |
