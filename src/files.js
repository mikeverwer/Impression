// File dialogs and disk I/O through the Tauri dialog and fs plugins.

import { open, save, message, ask } from "@tauri-apps/plugin-dialog";
import {
  readTextFile,
  readFile as readBytes,
  writeTextFile,
  writeFile as writeBytesToFile,
  mkdir,
  exists,
  stat,
} from "@tauri-apps/plugin-fs";

const MARKDOWN_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] },
  { name: "Stylesheet", extensions: ["css"] },
  { name: "All files", extensions: ["*"] },
];

const CSS_FILTERS = [
  { name: "Stylesheet", extensions: ["css"] },
  { name: "All files", extensions: ["*"] },
];

const HTML_FILTERS = [
  { name: "HTML", extensions: ["html", "htm"] },
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
export async function pickSavePath(defaultPath, kind = "markdown", title = "Save As") {
  const filters = kind === "css" ? CSS_FILTERS : kind === "html" ? HTML_FILTERS : MARKDOWN_FILTERS;
  return save({ title, defaultPath, filters });
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

/** Read a file as bytes (used to embed images in exported HTML). */
export async function readBinaryFile(path) {
  return readBytes(path);
}

export async function writeFile(path, text) {
  await writeTextFile(path, text);
}

/** Write binary data, creating the parent folder if needed. */
export async function writeBinaryFile(path, bytes) {
  const dir = dirName(path);
  if (dir && !(await exists(dir))) await mkdir(dir, { recursive: true });
  await writeBytesToFile(path, bytes);
}

export async function fileExists(path) {
  return exists(path);
}

/** Last-modified time in ms, or null if the file can't be read. */
export async function modifiedTime(path) {
  try {
    const info = await stat(path);
    return info.mtime ? new Date(info.mtime).getTime() : null;
  } catch {
    return null;
  }
}

/** Yes/No question; resolves to true for Yes. */
export async function confirm(text, { title = "Impression", kind = "warning" } = {}) {
  return ask(text, { title, kind });
}

/** Folder part of a path (no trailing separator), or "" if none. */
export function dirName(path) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : "";
}

/** Join a folder and a relative path, resolving "." and ".." segments. */
export function joinPath(base, rel) {
  const sep = base.includes("\\") ? "\\" : "/";
  const parts = base.replace(/[\\/]+$/, "").split(/[\\/]/);
  for (const seg of rel.split(/[\\/]/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(seg);
  }
  return parts.join(sep);
}

/** Path of `target` relative to folder `fromDir` (forward slashes), or the absolute path if on another drive. */
export function relativePath(fromDir, target) {
  const a = fromDir.replace(/[\\/]+$/, "").split(/[\\/]/);
  const b = target.split(/[\\/]/);
  if (a[0].toLowerCase() !== b[0].toLowerCase()) return target.replace(/\\/g, "/");
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  const up = a.slice(i).map(() => "..");
  return [...up, ...b.slice(i)].join("/");
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
