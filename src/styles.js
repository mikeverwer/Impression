// Preview stylesheet management.
//
// The preview (and therefore the PDF) is styled by exactly one stylesheet,
// injected into a <style> element. The built-in default ships inside the
// app and is also written to <app config>/styles/default.css on every launch
// so it stays pristine. Any other .css file in that folder can be selected;
// user_styles.css is the one the "Edit Preview Styles" command creates.

import defaultCss from "./styles/preview.css?raw";

export const DEFAULT_NAME = "default.css";
export const USER_NAME = "user_styles.css";
const STORAGE_KEY = "preview-style";

const styleEl = document.createElement("style");
styleEl.id = "preview-style";
document.head.appendChild(styleEl);

let pathApi = null;
let fs = null;
let dir = null;
let activeName = DEFAULT_NAME;

try {
  activeName = localStorage.getItem(STORAGE_KEY) || DEFAULT_NAME;
} catch {
  /* ignore */
}

apply(defaultCss);

/** Put stylesheet text into effect immediately. */
export function apply(text) {
  styleEl.textContent = text;
}

export function defaultText() {
  return defaultCss;
}

/** The stylesheet text currently in effect. */
export function activeText() {
  return styleEl.textContent || defaultCss;
}

export function activeStyleName() {
  return activeName;
}

export function stylesDir() {
  return dir;
}

function normalize(p) {
  return String(p).replace(/\//g, "\\").toLowerCase();
}

/** Full path for a stylesheet name, or null outside Tauri. */
export function pathFor(name) {
  return dir ? `${dir}\\${name}` : null;
}

/** Stylesheet name for a path inside the styles folder, else null. */
export function nameFor(path) {
  if (!dir || !path) return null;
  const n = normalize(path);
  const d = normalize(dir) + "\\";
  if (!n.startsWith(d)) return null;
  const rest = n.slice(d.length);
  if (rest.includes("\\")) return null;
  return path.split(/[\\/]/).pop();
}

export function isActivePath(path) {
  const name = nameFor(path);
  return name !== null && name.toLowerCase() === activeName.toLowerCase();
}

/** Set up the styles folder and load the remembered stylesheet. Tauri only. */
export async function init() {
  pathApi = await import("@tauri-apps/api/path");
  fs = await import("@tauri-apps/plugin-fs");
  dir = await pathApi.join(await pathApi.appConfigDir(), "styles");
  await ensureDefault();
  await select(activeName, false);
}

async function ensureDefault() {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeTextFile(pathFor(DEFAULT_NAME), defaultCss);
}

/** Names of all stylesheets: default first, then user_styles, then the rest. */
export async function list() {
  if (!fs) return [DEFAULT_NAME];
  let names = [];
  try {
    const entries = await fs.readDir(dir);
    names = entries
      .filter((e) => e.isFile && /\.css$/i.test(e.name) && e.name.toLowerCase() !== DEFAULT_NAME)
      .map((e) => e.name)
      .sort((a, b) => {
        const ua = a.toLowerCase() === USER_NAME;
        const ub = b.toLowerCase() === USER_NAME;
        if (ua !== ub) return ua ? -1 : 1;
        return a.localeCompare(b);
      });
  } catch (err) {
    console.warn("Could not list styles folder", err);
  }
  return [DEFAULT_NAME, ...names];
}

/**
 * Make `name` the active stylesheet. Falls back to the default if the file
 * cannot be read. Resolves to the name actually applied.
 */
export async function select(name, persist = true) {
  let text = defaultCss;
  let applied = DEFAULT_NAME;
  if (name.toLowerCase() !== DEFAULT_NAME && fs) {
    try {
      text = await fs.readTextFile(pathFor(name));
      applied = name;
    } catch (err) {
      console.warn(`Stylesheet ${name} unavailable, using default`, err);
    }
  }
  activeName = applied;
  apply(text);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, applied);
    } catch {
      /* ignore */
    }
  }
  return applied;
}

/** Re-read the active stylesheet from disk (after a save or external edit). */
export async function reload() {
  return select(activeName, false);
}

/** Create user_styles.css from the default if it does not exist; returns its path. */
export async function ensureUserSheet() {
  const path = pathFor(USER_NAME);
  if (!(await fs.exists(path))) await fs.writeTextFile(path, defaultCss);
  return path;
}
