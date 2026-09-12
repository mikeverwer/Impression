// File dialogs and disk I/O through the Tauri dialog and fs plugins.

import { open, save, message } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] },
  { name: "All files", extensions: ["*"] },
];

export function baseName(path) {
  return path.split(/[\\/]/).pop();
}

/** Show the Open dialog; resolves to an array of paths (possibly empty). */
export async function pickFilesToOpen() {
  const result = await open({ title: "Open", multiple: true, filters: FILTERS });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

/** Show the Save As dialog; resolves to a path or null. */
export async function pickSavePath(defaultPath) {
  return save({ title: "Save As", defaultPath, filters: FILTERS });
}

export async function readFile(path) {
  return readTextFile(path);
}

export async function writeFile(path, text) {
  await writeTextFile(path, text);
}

/**
 * Ask whether to save a modified document.
 * Resolves to "save" | "discard" | "cancel".
 */
export async function askSaveChanges(name) {
  const result = await message(`Save changes to "${name}"?`, {
    title: "Impression",
    kind: "warning",
    buttons: "YesNoCancel",
  });
  if (result === "Yes") return "save";
  if (result === "No") return "discard";
  return "cancel";
}

export async function showError(text) {
  await message(text, { title: "Impression", kind: "error" });
}
