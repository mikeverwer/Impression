// Light/dark theme handling.
//
// The OS theme is read at launch and followed live unless the user picks an
// explicit theme from the View menu; that choice is remembered across runs.
// The resolved theme is always written to <html data-theme="..."> so the CSS
// only has two explicit blocks to keep in sync.

const STORAGE_KEY = "theme-preference";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set();

let preference = readPreference();

function readPreference() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* storage unavailable: fall through */
  }
  return "system";
}

/** "system" | "light" | "dark" */
export function themePreference() {
  return preference;
}

/** The theme actually in effect: "light" | "dark". */
export function currentTheme() {
  if (preference === "system") return media.matches ? "dark" : "light";
  return preference;
}

export function setThemePreference(next) {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  apply();
}

/** Register a callback for when the effective theme changes. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply() {
  const theme = currentTheme();
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  for (const fn of listeners) fn(theme);
}

export function initTheme() {
  apply();
  media.addEventListener("change", () => {
    if (preference === "system") apply();
  });
}
