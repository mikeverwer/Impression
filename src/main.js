// Application entry point: wires the editor, preview, tabs, menus, file
// operations and keyboard shortcuts together.

import "./styles/variables.css";
import "./styles/app.css";
import "./styles/markdown.css";
import "./styles/hljs.css";
import "./styles/print.css";
import "katex/dist/katex.min.css";

import { initTheme, currentTheme, themePreference, setThemePreference, onThemeChange } from "./theme.js";
import { renderMarkdown, enhance } from "./render.js";
import { createEditor, toggleBold, toggleItalic } from "./editor.js";
import { ScrollSync } from "./sync.js";
import { TabBar } from "./tabs.js";
import { exportPdf } from "./print.js";
import sampleText from "./sample.md?raw";

const isTauri = Boolean(window.__TAURI_INTERNALS__);

// Tauri-only modules are loaded lazily so the page also runs in a plain
// browser (handy for working on the frontend with `npm run dev`).
let files = null;
let tauriWindow = null;
let openUrl = null;
if (isTauri) {
  files = await import("./files.js");
  tauriWindow = (await import("@tauri-apps/api/window")).getCurrentWindow();
  openUrl = (await import("@tauri-apps/plugin-opener")).openUrl;
}

// ---------------------------------------------------------------------------
// DOM

const $ = (id) => document.getElementById(id);
const editorPane = $("editor-pane");
const previewPane = $("preview-pane");
const preview = $("preview");
const workspace = $("workspace");
const resizer = $("resizer");
const statusPath = $("status-path");
const statusCursor = $("status-cursor");
const statusWords = $("status-words");

// ---------------------------------------------------------------------------
// Documents

let docSeq = 0;
let untitledSeq = 0;

class Doc {
  constructor({ path = null, text = "", eol = "\n" } = {}) {
    this.id = ++docSeq;
    this.path = path;
    this.eol = eol;
    this.untitled = path ? 0 : ++untitledSeq;
    this.state = editor.newState(text);
    this.savedDoc = path ? this.state.doc : null;
    this.dirty = false;
    this.editorScroll = 0;
    this.previewScroll = 0;
  }

  get name() {
    if (this.path) return files ? files.baseName(this.path) : this.path.split(/[\\/]/).pop();
    return this.untitled > 1 ? `Untitled ${this.untitled}` : "Untitled";
  }

  updateDirty() {
    this.dirty = this.savedDoc ? !this.state.doc.eq(this.savedDoc) : this.state.doc.length > 0;
  }

  text() {
    return this.state.doc.toString();
  }
}

const docs = [];
let active = null;

// ---------------------------------------------------------------------------
// Editor

initTheme();

const editor = createEditor({
  parent: editorPane,
  theme: currentTheme(),
  keys: [
    { key: "Mod-b", run: (v) => (runAction("bold", "key"), true) },
    { key: "Mod-i", run: (v) => (runAction("italic", "key"), true) },
  ],
  onUpdate(update) {
    if (!active) return;
    active.state = update.state;
    if (update.docChanged) {
      active.updateDirty();
      scheduleRender();
      refreshChrome();
    }
    if (update.docChanged || update.selectionSet) updateCursorStatus();
  },
});
const view = editor.view;

const sync = new ScrollSync({ view, editorPane, previewPane, preview });
const tabBar = new TabBar($("tabs"), {
  onSelect: (doc) => activate(doc),
  onClose: (doc) => closeDoc(doc),
});

// ---------------------------------------------------------------------------
// Rendering

let renderTimer = null;
let renderGeneration = 0;
const RENDER_DELAY = 200;

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderNow(), RENDER_DELAY);
}

/** Render the active document into the preview. Resolves when Mermaid/KaTeX are done. */
async function renderNow(theme = currentTheme()) {
  clearTimeout(renderTimer);
  if (!active) return;
  const generation = ++renderGeneration;
  const isStale = () => generation !== renderGeneration;

  preview.innerHTML = renderMarkdown(active.text());
  updateWordCount();
  sync.refresh();
  if (sync.master === "editor") sync.editorToPreview();

  try {
    await enhance(preview, theme, isStale);
  } catch (err) {
    console.error("enhance failed", err);
  }
  if (isStale()) return;
  sync.refresh();
  if (sync.master === "editor") sync.editorToPreview();
}

onThemeChange((theme) => {
  editor.setTheme(theme);
  renderNow(theme);
});

// ---------------------------------------------------------------------------
// Tabs

function activate(doc) {
  if (active === doc) return;
  if (active) {
    active.editorScroll = view.scrollDOM.scrollTop;
    active.previewScroll = previewPane.scrollTop;
  }
  active = doc;
  view.setState(doc.state);
  editor.setTheme(currentTheme());
  renderNow().then(() => {
    previewPane.scrollTop = doc.previewScroll;
  });
  view.scrollDOM.scrollTop = doc.editorScroll;
  previewPane.scrollTop = doc.previewScroll;
  refreshChrome();
  updateCursorStatus();
  view.focus();
}

function addDoc(opts) {
  const doc = new Doc(opts);
  // Opening a file into a pristine, lone Untitled tab replaces that tab.
  if (opts && opts.path && docs.length === 1 && !docs[0].path && !docs[0].dirty) {
    docs.length = 0;
    active = null;
  }
  docs.push(doc);
  activate(doc);
  return doc;
}

function newDoc() {
  addDoc();
}

async function closeDoc(doc) {
  if (doc.dirty) {
    activate(doc);
    if (!files) {
      if (!window.confirm(`Discard unsaved changes to "${doc.name}"?`)) return false;
    } else {
      const answer = await files.askSaveChanges(doc.name);
      if (answer === "cancel") return false;
      if (answer === "save" && !(await saveDoc(doc))) return false;
    }
  }
  const index = docs.indexOf(doc);
  if (index < 0) return true;
  docs.splice(index, 1);
  if (active === doc) {
    active = null;
    if (docs.length === 0) newDoc();
    else activate(docs[Math.min(index, docs.length - 1)]);
  } else {
    refreshChrome();
  }
  return true;
}

/** Close every tab, prompting for unsaved ones. Resolves false if cancelled. */
async function closeAll() {
  for (const doc of [...docs]) {
    if (!doc.dirty) continue;
    if (!(await closeDoc(doc))) return false;
  }
  return true;
}

function cycleTab(delta) {
  if (docs.length < 2) return;
  const index = docs.indexOf(active);
  activate(docs[(index + delta + docs.length) % docs.length]);
}

// ---------------------------------------------------------------------------
// Files

async function openFiles() {
  if (!files) return console.warn("File dialogs need the Tauri runtime.");
  const paths = await files.pickFilesToOpen();
  for (const path of paths) await openPath(path);
}

async function openPath(path) {
  const existing = docs.find((d) => d.path === path);
  if (existing) return activate(existing);
  try {
    const raw = await files.readFile(path);
    addDoc({ path, text: raw, eol: raw.includes("\r\n") ? "\r\n" : "\n" });
  } catch (err) {
    console.error(err);
    await files.showError(`Could not open ${path}\n\n${err}`);
  }
}

async function saveDoc(doc, forceDialog = false) {
  if (!files) return console.warn("Saving needs the Tauri runtime."), false;
  let path = doc.path;
  if (!path || forceDialog) {
    path = await files.pickSavePath(doc.path || `${doc.name}.md`);
    if (!path) return false;
  }
  let text = doc.text();
  if (doc.eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  try {
    await files.writeFile(path, text);
  } catch (err) {
    console.error(err);
    await files.showError(`Could not save ${path}\n\n${err}`);
    return false;
  }
  doc.path = path;
  doc.savedDoc = doc.state.doc;
  doc.updateDirty();
  refreshChrome();
  return true;
}

// ---------------------------------------------------------------------------
// Chrome: tabs, title, status bar

function refreshChrome() {
  tabBar.render(docs, active);
  const title = active ? `${active.dirty ? "• " : ""}${active.name} — Markdown Editor` : "Markdown Editor";
  if (tauriWindow) tauriWindow.setTitle(title).catch(() => {});
  document.title = title;
  statusPath.textContent = active ? active.path || active.name : "";
}

function updateCursorStatus() {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  statusCursor.textContent = `Ln ${line.number}, Col ${pos - line.from + 1}`;
}

function updateWordCount() {
  const words = active ? (active.text().match(/\S+/g) || []).length : 0;
  statusWords.textContent = `${words} word${words === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Actions (shared by menu, keyboard shortcuts and buttons)

const actions = {
  new: () => newDoc(),
  open: () => openFiles(),
  save: () => active && saveDoc(active),
  "save-as": () => active && saveDoc(active, true),
  "export-pdf": () => exportPdf({ preview, rerender: renderNow, currentTheme }),
  "close-tab": () => active && closeDoc(active),
  quit: () => (tauriWindow ? tauriWindow.close() : window.close()),
  bold: () => toggleBold(view),
  italic: () => toggleItalic(view),
  "next-tab": () => cycleTab(1),
  "prev-tab": () => cycleTab(-1),
  "theme-system": () => applyThemePreference("system"),
  "theme-light": () => applyThemePreference("light"),
  "theme-dark": () => applyThemePreference("dark"),
  "reset-split": () => setSplit(50),
};

// A native accelerator and the in-page key handler can both fire for one
// keypress; ignore the second arrival of the same action from a different
// source within a short window.
const lastRun = new Map();
function runAction(id, source = "key") {
  const fn = actions[id];
  if (!fn) return;
  const now = performance.now();
  const last = lastRun.get(id);
  if (last && last.source !== source && now - last.time < 400) return;
  lastRun.set(id, { source, time: now });
  Promise.resolve(fn()).catch((err) => console.error(`action ${id} failed`, err));
}

let appMenu = null;
function applyThemePreference(pref) {
  setThemePreference(pref);
  if (appMenu) appMenu.setThemeChecked(pref).catch(() => {});
}

const SHORTCUTS = {
  "ctrl+n": "new",
  "ctrl+o": "open",
  "ctrl+s": "save",
  "ctrl+shift+s": "save-as",
  "ctrl+p": "export-pdf",
  "ctrl+w": "close-tab",
  "ctrl+tab": "next-tab",
  "ctrl+shift+tab": "prev-tab",
  "ctrl+pagedown": "next-tab",
  "ctrl+pageup": "prev-tab",
};

window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const combo = `ctrl+${e.shiftKey ? "shift+" : ""}${key}`;
  const id = SHORTCUTS[combo];
  if (!id) return;
  e.preventDefault();
  if (!e.repeat) runAction(id, "key");
});

$("tab-new").addEventListener("click", () => runAction("new", "button"));

// ---------------------------------------------------------------------------
// Preview interactions: links and the context menu

preview.addEventListener("click", (e) => {
  const link = e.target.closest("a[href]");
  if (!link) return;
  const href = link.getAttribute("href");
  if (href.startsWith("#")) {
    e.preventDefault();
    let target = null;
    try {
      target = preview.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`);
    } catch {
      /* invalid selector */
    }
    if (target) {
      sync.master = "preview";
      target.scrollIntoView({ block: "start" });
    }
    return;
  }
  e.preventDefault();
  if (openUrl) openUrl(href).catch((err) => console.warn("openUrl failed", err));
});

let contextMenu = null;
let jumpTarget = null;
previewPane.addEventListener("contextmenu", (e) => {
  jumpTarget = sync.locate(e.clientX, e.clientY);
  if (!contextMenu) return; // plain browser: keep the native menu
  e.preventDefault();
  contextMenu.popup(jumpTarget !== null).catch((err) => console.warn("popup failed", err));
});

// ---------------------------------------------------------------------------
// Split-pane resizer

const SPLIT_KEY = "split-percent";

function setSplit(percent, persist = true) {
  const value = Math.max(20, Math.min(80, percent));
  workspace.style.setProperty("--split", `${value}%`);
  if (persist) {
    try {
      localStorage.setItem(SPLIT_KEY, String(value));
    } catch {
      /* ignore */
    }
  }
  view.requestMeasure();
  sync.refresh();
}

try {
  const saved = Number(localStorage.getItem(SPLIT_KEY));
  if (saved) setSplit(saved, false);
} catch {
  /* ignore */
}

resizer.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
  const rect = workspace.getBoundingClientRect();
  const move = (ev) => setSplit(((ev.clientX - rect.left) / rect.width) * 100, false);
  const up = () => {
    resizer.removeEventListener("pointermove", move);
    resizer.removeEventListener("pointerup", up);
    resizer.removeEventListener("pointercancel", up);
    document.body.classList.remove("resizing");
    setSplit(parseFloat(workspace.style.getPropertyValue("--split")) || 50);
  };
  resizer.addEventListener("pointermove", move);
  resizer.addEventListener("pointerup", up);
  resizer.addEventListener("pointercancel", up);
});
resizer.addEventListener("dblclick", () => setSplit(50));

window.addEventListener("resize", () => sync.refresh());

// ---------------------------------------------------------------------------
// Tauri integration: menus, close handling

if (isTauri) {
  try {
    const menu = await import("./menu.js");
    appMenu = await menu.installAppMenu(runAction, themePreference());
    contextMenu = await menu.createPreviewContextMenu(() => {
      if (jumpTarget !== null) sync.jumpTo(jumpTarget);
    });
  } catch (err) {
    console.error("Menu setup failed", err);
  }

  tauriWindow.onCloseRequested(async (event) => {
    if (!(await closeAll())) event.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Start

if (new URLSearchParams(location.search).has("sample")) addDoc({ text: sampleText });
else newDoc();

// Dev-only console hook for poking at the running app.
if (import.meta.env.DEV) {
  window.__app = { view, sync, docs: () => docs, active: () => active, runAction, renderNow, toggleBold, toggleItalic };
}
