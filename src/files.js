// File dialogs and disk I/O through the Tauri dialog and fs plugins.

import { open, save, message } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const MARKDOWN_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] },
  { name: "Stylesheet", extensions: ["css"] },
  { name: "All files", extensions: ["*"] },
];

const CSS_FILTERS = [
  { name: "Stylesheet", extensions: ["css"] },
  { name: "All files", extensions: ["*"] },
];

export function baseName(path) {
  return path.split(/[\\/]/).pop();
}

/** "css" for .css paths, otherwise "markdown". */
export function kindOf(path) {
  return /\.css$/i.test(path || "") ? "css" : "markdown";
}

/** Show the Open dialog; resolves to an array of paths (possibly empty). */
export async function pickFilesToOpen() {
  const result = await open({ title: "Open", multiple: true, filters: MARKDOWN_FILTERS });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

/** Show the Save As dialog; resolves to a path or null. */
export async function pickSavePath(defaultPath, kind = "markdown") {
  return save({
    title: "Save As",
    defaultPath,
    filters: kind === "css" ? CSS_FILTERS : MARKDOWN_FILTERS,
  });
}

/** Ask which stylesheet in `dir` to edit; resolves to a path or null. */
export async function pickStylesheet(dir) {
  return open({
    title: "Choose a stylesheet to edit",
    defaultPath: dir,
    multiple: false,
    filters: CSS_FILTERS,
  });
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
