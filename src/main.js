// Application entry point: wires the editor, preview, tabs, menus, file
// operations, stylesheets and keyboard shortcuts together.

import "./styles/variables.css";
import "./styles/app.css";
import "./styles/print.css";
import "katex/dist/katex.min.css";

import { initTheme, currentTheme, themePreference, setThemePreference, onThemeChange } from "./theme.js";
import { renderMarkdown, enhance } from "./render.js";
import { createEditor, toggleBold, toggleItalic } from "./editor.js";
import { ScrollSync } from "./sync.js";
import { TabBar } from "./tabs.js";
import { exportPdf } from "./print.js";
import * as styles from "./styles.js";
import sampleText from "./sample.md?raw";

const isTauri = Boolean(window.__TAURI_INTERNALS__);

// Tauri-only modules are loaded lazily so the page also runs in a plain
// browser (handy for working on the frontend with `npm run dev`).
let files = null;
let tauriWindow = null;
let opener = null;
if (isTauri) {
  files = await import("./files.js");
  tauriWindow = (await import("@tauri-apps/api/window")).getCurrentWindow();
  opener = await import("@tauri-apps/plugin-opener");
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
const statusFont = $("status-font");
const statusZoom = $("status-zoom");

function readNumber(key) {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function storeNumber(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Documents

let docSeq = 0;
let untitledSeq = 0;

function kindOf(path) {
  return /\.css$/i.test(path || "") ? "css" : "markdown";
}

class Doc {
  constructor({ path = null, text = "", eol = "\n", kind = kindOf(path) } = {}) {
    this.id = ++docSeq;
    this.path = path;
    this.eol = eol;
    this.kind = kind;
    this.untitled = path ? 0 : ++untitledSeq;
    this.state = editor.newState(text, kind);
    this.savedDoc = path ? this.state.doc : null;
    this.dirty = false;
    this.editorScroll = 0;
    this.previewScroll = 0;
  }

  get name() {
    if (this.path) return this.path.split(/[\\/]/).pop();
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
let lastMarkdownDoc = null; // what the preview shows while a CSS tab is active

// ---------------------------------------------------------------------------
// Editor

initTheme();

const editor = createEditor({
  parent: editorPane,
  theme: currentTheme(),
  keys: [
    { key: "Mod-b", run: () => (runAction("bold", "key"), true) },
    { key: "Mod-i", run: () => (runAction("italic", "key"), true) },
  ],
  onUpdate(update) {
    if (!active) return;
    active.state = update.state;
    if (update.docChanged) {
      active.updateDirty();
      if (active.kind === "css") scheduleStyleApply();
      else scheduleRender();
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

/** The document the preview should show. */
function previewDoc() {
  if (active && active.kind === "markdown") return active;
  return lastMarkdownDoc;
}

// ---- preview visibility ---------------------------------------------------

const PREVIEW_KEY = "preview-visible";
let previewVisible = true;
let previewStale = false; // edits happened while the preview was hidden

function setPreviewVisible(visible, persist = true) {
  previewVisible = visible;
  document.body.classList.toggle("preview-hidden", !visible);
  $("toggle-preview").setAttribute("aria-pressed", String(visible));
  if (persist) {
    try {
      localStorage.setItem(PREVIEW_KEY, visible ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  view.requestMeasure();
  if (visible && previewStale) renderNow();
  else if (visible) sync.refresh();
}

try {
  if (localStorage.getItem(PREVIEW_KEY) === "0") setPreviewVisible(false, false);
} catch {
  /* ignore */
}

// ---- editor font size and preview zoom ------------------------------------

const FONT_KEY = "editor-font-size";
const FONT_DEFAULT = 14;
const FONT_MIN = 9;
const FONT_MAX = 32;
let fontSize = FONT_DEFAULT;

function setFontSize(px, persist = true) {
  fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(px)));
  editor.setFontSize(fontSize);
  statusFont.textContent = `${fontSize} px`;
  if (persist) storeNumber(FONT_KEY, fontSize);
  sync.refresh();
}

const ZOOM_KEY = "preview-zoom";
const ZOOM_DEFAULT = 100;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
let zoom = ZOOM_DEFAULT;

function setZoom(percent, persist = true) {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(percent / ZOOM_STEP) * ZOOM_STEP));
  preview.style.zoom = `${zoom}%`;
  statusZoom.textContent = `${zoom}%`;
  if (persist) storeNumber(ZOOM_KEY, zoom);
  sync.refresh();
  if (sync.master === "editor") sync.editorToPreview();
}

setFontSize(readNumber(FONT_KEY) || FONT_DEFAULT, false);
setZoom(readNumber(ZOOM_KEY) || ZOOM_DEFAULT, false);

// ---- writing mode -----------------------------------------------------------
// Inline rendering in the editor; turning it on collapses the preview and
// turning it off brings the preview back to how it was.

const WRITING_KEY = "writing-mode";
let writing = false;
let previewBeforeWriting = true;

function setWritingMode(on, persist = true) {
  if (on === writing) return;
  writing = on;
  document.body.classList.toggle("writing-mode", on);
  editor.setWritingMode(on, active ? active.kind : "markdown");
  if (on) {
    previewBeforeWriting = previewVisible;
    if (previewVisible) setPreviewVisible(false, false);
  } else if (previewBeforeWriting && !previewVisible) {
    setPreviewVisible(true, false);
  }
  if (persist) {
    try {
      localStorage.setItem(WRITING_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  if (appMenu) appMenu.setWritingChecked(on).catch(() => {});
}

// Ctrl+wheel: font size over the editor, zoom over the preview. Both stop
// the webview's own page zoom.
editorPane.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setFontSize(fontSize + (e.deltaY < 0 ? 1 : -1));
  },
  { passive: false }
);
previewPane.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    sync.master = "preview";
    setZoom(zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  },
  { passive: false }
);

/** Render into the preview. Resolves when Mermaid/KaTeX are done. */
async function renderNow(theme = currentTheme()) {
  clearTimeout(renderTimer);
  if (!active) return;
  if (!previewVisible) {
    // Skip the work while hidden; catch up when the pane is shown again.
    previewStale = true;
    updateWordCount();
    return;
  }
  previewStale = false;
  const generation = ++renderGeneration;
  const isStale = () => generation !== renderGeneration;

  const source = previewDoc();
  preview.innerHTML = renderMarkdown(source ? source.text() : sampleText);
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
  if (doc.kind === "markdown") lastMarkdownDoc = doc;
  sync.enabled = doc.kind === "markdown";
  view.setState(doc.state);
  editor.setTheme(currentTheme());
  editor.setFontSize(fontSize);
  editor.setWritingMode(writing, doc.kind);
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
    if (lastMarkdownDoc === docs[0]) lastMarkdownDoc = null;
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
  if (lastMarkdownDoc === doc) {
    lastMarkdownDoc = docs.filter((d) => d.kind === "markdown").pop() || null;
  }
  if (active === doc) {
    active = null;
    if (docs.length === 0) newDoc();
    else activate(docs[Math.min(index, docs.length - 1)]);
  } else {
    refreshChrome();
    if (active && active.kind === "css") renderNow();
  }
  // A closed stylesheet tab may have left unsaved changes applied to the preview.
  if (doc.kind === "css" && styles.isActivePath(doc.path)) styles.reload();
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
  const existing = docs.find((d) => d.path && d.path.toLowerCase() === path.toLowerCase());
  if (existing) return activate(existing);
  try {
    const raw = await files.readFile(path);
    return addDoc({ path, text: raw, eol: raw.includes("\r\n") ? "\r\n" : "\n" });
  } catch (err) {
    console.error(err);
    await files.showError(`Could not open ${path}\n\n${err}`);
    return null;
  }
}

async function saveDoc(doc, forceDialog = false) {
  if (!files) return console.warn("Saving needs the Tauri runtime."), false;
  let path = doc.path;
  if (!path || forceDialog) {
    const ext = doc.kind === "css" ? ".css" : ".md";
    path = await files.pickSavePath(doc.path || `${doc.name}${ext}`, doc.kind);
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
  doc.kind = kindOf(path);
  doc.savedDoc = doc.state.doc;
  doc.updateDirty();
  refreshChrome();
  if (doc.kind === "css" && styles.nameFor(path)) refreshStyleList();
  return true;
}

// ---------------------------------------------------------------------------
// Preview stylesheets

let styleTimer = null;

/** Apply the CSS being edited to the preview, if it is the active stylesheet. */
function scheduleStyleApply() {
  clearTimeout(styleTimer);
  styleTimer = setTimeout(() => {
    if (active && active.kind === "css" && styles.isActivePath(active.path)) styles.apply(active.text());
  }, RENDER_DELAY);
}

async function selectStyle(name) {
  const applied = await styles.select(name);
  // If the newly selected sheet is open in a tab with edits, show those edits.
  const openTab = docs.find((d) => d.kind === "css" && styles.isActivePath(d.path));
  if (openTab && openTab.dirty) styles.apply(openTab.text());
  if (appMenu) appMenu.setStyleChecked(applied).catch(() => {});
}

async function refreshStyleList() {
  if (!appMenu || !isTauri) return;
  try {
    await appMenu.setStyleList(await styles.list(), styles.activeStyleName());
  } catch (err) {
    console.warn("Could not refresh style list", err);
  }
}

/**
 * Edit Preview Styles: opens user_styles.css (creating it from the default
 * if needed). With one other stylesheet in the folder that one is opened;
 * with several, a picker asks which.
 */
async function editStyles() {
  if (!files) return console.warn("Stylesheet editing needs the Tauri runtime.");
  const candidates = (await styles.list()).filter((n) => n !== styles.DEFAULT_NAME);
  let path;
  if (candidates.length === 0) path = await styles.ensureUserSheet();
  else if (candidates.length === 1) path = styles.pathFor(candidates[0]);
  else {
    path = await files.pickStylesheet(styles.stylesDir());
    if (!path) return;
  }
  const doc = await openPath(path);
  if (!doc) return;
  const name = styles.nameFor(path);
  if (name && name.toLowerCase() !== styles.activeStyleName().toLowerCase()) await selectStyle(name);
  refreshStyleList();
}

function openStylesFolder() {
  if (!opener || !styles.stylesDir()) return;
  opener.revealItemInDir(styles.pathFor(styles.DEFAULT_NAME)).catch((err) => console.warn("reveal failed", err));
}

// ---------------------------------------------------------------------------
// Chrome: tabs, title, status bar

function refreshChrome() {
  tabBar.render(docs, active);
  const title = active ? `${active.dirty ? "• " : ""}${active.name} — Impression` : "Impression";
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
  const source = previewDoc();
  if (!source) {
    statusWords.textContent = "";
    return;
  }
  const words = (source.text().match(/\S+/g) || []).length;
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
  "toggle-preview": () => setPreviewVisible(!previewVisible),
  "toggle-writing": () => setWritingMode(!writing),
  "font-increase": () => setFontSize(fontSize + 1),
  "font-decrease": () => setFontSize(fontSize - 1),
  "font-reset": () => setFontSize(FONT_DEFAULT),
  "zoom-in": () => setZoom(zoom + ZOOM_STEP),
  "zoom-out": () => setZoom(zoom - ZOOM_STEP),
  "zoom-reset": () => setZoom(ZOOM_DEFAULT),
  "edit-styles": () => editStyles(),
  "refresh-styles": () => refreshStyleList(),
  "open-styles-folder": () => openStylesFolder(),
};

// A native accelerator and the in-page key handler can both fire for one
// keypress; ignore the second arrival of the same action from a different
// source within a short window.
const lastRun = new Map();
function runAction(id, source = "key") {
  const fn = id.startsWith("style:") ? () => selectStyle(id.slice("style:".length)) : actions[id];
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
  "ctrl+shift+p": "toggle-preview",
  "ctrl+shift+w": "toggle-writing",
  "ctrl+shift+e": "edit-styles",
  "ctrl+w": "close-tab",
  "ctrl+tab": "next-tab",
  "ctrl+shift+tab": "prev-tab",
  "ctrl+pagedown": "next-tab",
  "ctrl+pageup": "prev-tab",
};

// Size keys are matched by physical key because Shift changes e.key
// (. becomes >, [ becomes {). Ctrl with = - 0 cannot be used: the webview
// consumes those as browser zoom keys before the page sees them.
const SIZE_KEYS = {
  Period: "font-increase",
  Comma: "font-decrease",
  BracketRight: "zoom-in",
  BracketLeft: "zoom-out",
};

window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  let id = null;
  if (e.shiftKey && SIZE_KEYS[e.code]) id = SIZE_KEYS[e.code];
  else id = SHORTCUTS[`ctrl+${e.shiftKey ? "shift+" : ""}${e.key.toLowerCase()}`];
  if (!id) return;
  e.preventDefault();
  if (!e.repeat) runAction(id, "key");
});

$("tab-new").addEventListener("click", () => runAction("new", "button"));
$("toggle-preview").addEventListener("click", () => runAction("toggle-preview", "button"));

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
  if (opener) opener.openUrl(href).catch((err) => console.warn("openUrl failed", err));
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
// Tauri integration: stylesheets, menus, close handling

if (isTauri) {
  try {
    await styles.init();
  } catch (err) {
    console.error("Stylesheet setup failed", err);
  }

  try {
    const menu = await import("./menu.js");
    appMenu = await menu.installAppMenu(runAction, themePreference());
    await refreshStyleList();
    await appMenu.setWritingChecked(writing);
    contextMenu = await menu.createPreviewContextMenu(() => {
      if (jumpTarget !== null) sync.jumpTo(jumpTarget);
    });
  } catch (err) {
    console.error("Menu setup failed", err);
  }

  tauriWindow.onCloseRequested(async (event) => {
    if (!(await closeAll())) event.preventDefault();
  });

  // Pick up stylesheets added or removed outside the app.
  tauriWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) refreshStyleList();
  });
}

// ---------------------------------------------------------------------------
// Start

if (new URLSearchParams(location.search).has("sample")) addDoc({ text: sampleText });
else newDoc();

try {
  if (localStorage.getItem(WRITING_KEY) === "1") setWritingMode(true, false);
} catch {
  /* ignore */
}

// Dev-only console hook for poking at the running app.
if (import.meta.env.DEV) {
  window.__app = { view, sync, styles, docs: () => docs, active: () => active, runAction, renderNow, toggleBold, toggleItalic };
}
