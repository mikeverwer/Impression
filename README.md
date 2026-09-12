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
| `src/styles/variables.css` | Light/dark tokens and theme transitions |
| `src/styles/markdown.css` | Preview stylesheet (trimmed from the site's `markdown-styles.css`) |
| `src/styles/hljs.css` | Dedicated `--hl-*` syntax token colours |
| `src/styles/print.css` | `@media print` rules |
| `src-tauri/` | Rust side: plugin registration only |
| `styles/markdown-styles.css` | Original reference stylesheet from the site (not loaded by the app) |

## Shortcuts

| Keys | Action |
|------|--------|
| Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | New / Open / Save / Save As |
| Ctrl+P | Export to PDF (native print dialog) |
| Ctrl+Shift+P | Show / hide the preview pane |
| Ctrl+W | Close tab |
| Ctrl+Tab, Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+B / Ctrl+I | Toggle bold / italic |
| Ctrl+F | Find in editor |
| Right-click in preview | Copy, Select All, Jump to Source |
