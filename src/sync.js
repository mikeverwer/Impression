// Scroll sync and jump-to-source.
//
// Both are built on the data-source-line / data-source-line-end attributes the
// renderer stamps onto block elements. The map is a sorted list of
// { start, end, top, bottom } entries (source lines, pixel offsets inside the
// preview scroll container). Positions between mapped blocks are interpolated
// linearly so scrolling stays smooth.

import { EditorView } from "@codemirror/view";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export class ScrollSync {
  /**
   * @param {object} opts
   * @param {import('@codemirror/view').EditorView} opts.view
   * @param {HTMLElement} opts.editorPane   wrapper around the editor
   * @param {HTMLElement} opts.previewPane  the scroll container
   * @param {HTMLElement} opts.preview      the rendered article inside it
   */
  constructor({ view, editorPane, previewPane, preview }) {
    this.view = view;
    this.editorPane = editorPane;
    this.previewPane = previewPane;
    this.preview = preview;
    this.entries = [];
    this.master = "editor"; // which pane the user is driving
    this.pending = null;
    this.enabled = true; // false while the editor shows something other than the previewed document

    editorPane.addEventListener("pointerenter", () => (this.master = "editor"));
    editorPane.addEventListener("keydown", () => (this.master = "editor"));
    previewPane.addEventListener("pointerenter", () => (this.master = "preview"));

    view.scrollDOM.addEventListener("scroll", () => {
      if (this.master === "editor") this.schedule(() => this.editorToPreview());
    });
    previewPane.addEventListener("scroll", () => {
      if (this.master === "preview") this.schedule(() => this.previewToEditor());
    });
  }

  schedule(fn) {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = null;
      fn();
    });
  }

  /** Rebuild the line map after the preview DOM changed. */
  refresh() {
    const paneRect = this.previewPane.getBoundingClientRect();
    const origin = paneRect.top - this.previewPane.scrollTop;
    const entries = [];
    for (const el of this.preview.querySelectorAll("[data-source-line]")) {
      const start = Number(el.dataset.sourceLine);
      if (!Number.isFinite(start)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) continue;
      let end = Number(el.dataset.sourceLineEnd);
      if (!Number.isFinite(end) || end <= start) end = start + 1;
      entries.push({ el, start, end, top: rect.top - origin, bottom: rect.bottom - origin });
    }
    // Document order already has parents before children; keep the outermost
    // element for any given start line so the map stays monotonic.
    const seen = new Set();
    this.entries = entries.filter((e) => {
      if (seen.has(e.start)) return false;
      seen.add(e.start);
      return true;
    });
  }

  // ---- editor side ------------------------------------------------------

  /** Fractional 0-based source line at the top of the editor viewport. */
  editorTopLine() {
    const view = this.view;
    const h = Math.max(0, view.scrollDOM.scrollTop - view.documentPadding.top);
    const block = view.lineBlockAtHeight(h);
    const lineNo = view.state.doc.lineAt(block.from).number - 1;
    const frac = block.height > 0 ? clamp((h - block.top) / block.height, 0, 1) : 0;
    return lineNo + frac;
  }

  scrollEditorToLine(line) {
    const view = this.view;
    const total = view.state.doc.lines;
    const n = clamp(Math.floor(line) + 1, 1, total);
    const frac = clamp(line - (n - 1), 0, 1);
    const block = view.lineBlockAt(view.state.doc.line(n).from);
    view.scrollDOM.scrollTop = block.top + frac * block.height + view.documentPadding.top;
  }

  // ---- preview side -----------------------------------------------------

  /** Pixel offset in the preview container for a fractional source line. */
  lineToOffset(line) {
    const entries = this.entries;
    if (!entries.length) return 0;
    // Last entry whose start <= line.
    let lo = 0;
    let hi = entries.length - 1;
    let i = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid].start <= line) {
        i = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (i < 0) {
      const first = entries[0];
      return first.start > 0 ? (line / first.start) * first.top : 0;
    }
    const a = entries[i];
    if (line < a.end) return a.top + ((line - a.start) / (a.end - a.start)) * (a.bottom - a.top);
    const b = entries[i + 1];
    if (!b) return a.bottom;
    const span = b.start - a.end;
    if (span <= 0) return b.top;
    return a.bottom + ((line - a.end) / span) * (b.top - a.bottom);
  }

  /** Fractional source line for a pixel offset in the preview container. */
  offsetToLine(y) {
    const entries = this.entries;
    if (!entries.length) return 0;
    let prev = null;
    for (const e of entries) {
      if (y < e.top) {
        if (!prev) return e.start > 0 ? (y / e.top) * e.start : 0;
        const gap = e.top - prev.bottom;
        if (gap <= 0) return e.start;
        return prev.end + ((y - prev.bottom) / gap) * (e.start - prev.end);
      }
      if (y < e.bottom) return e.start + ((y - e.top) / (e.bottom - e.top)) * (e.end - e.start);
      prev = e;
    }
    return prev ? prev.end : 0;
  }

  // ---- sync -------------------------------------------------------------

  editorToPreview() {
    if (!this.enabled || !this.entries.length) return;
    const line = this.editorTopLine();
    const target = this.lineToOffset(line);
    const max = this.previewPane.scrollHeight - this.previewPane.clientHeight;
    this.previewPane.scrollTop = clamp(target, 0, Math.max(0, max));
  }

  previewToEditor() {
    if (!this.enabled || !this.entries.length) return;
    const line = this.offsetToLine(this.previewPane.scrollTop);
    this.scrollEditorToLine(line);
  }

  // ---- jump to source ---------------------------------------------------

  /**
   * Resolve a point in the preview to a document offset in the editor.
   * Returns null when nothing under the point maps to source.
   */
  locate(clientX, clientY) {
    if (!this.enabled) return null;
    const hit = document.elementFromPoint(clientX, clientY);
    let el = hit && hit.closest ? hit.closest("[data-source-line]") : null;
    if (el && !this.preview.contains(el)) el = null;
    if (!el) {
      // Whitespace beside or between blocks: pick the block nearest that row.
      const paneRect = this.previewPane.getBoundingClientRect();
      const y = clientY - paneRect.top + this.previewPane.scrollTop;
      let best = null;
      let bestDist = Infinity;
      for (const e of this.entries) {
        const dist = y < e.top ? e.top - y : y >= e.bottom ? y - e.bottom : 0;
        if (dist < bestDist) {
          bestDist = dist;
          best = e;
        }
      }
      if (!best) return null;
      el = best.el;
    }

    const doc = this.view.state.doc;
    const start = clamp(Number(el.dataset.sourceLine), 0, doc.lines - 1);
    let end = Number(el.dataset.sourceLineEnd);
    if (!Number.isFinite(end) || end <= start) end = start + 1;
    end = clamp(end, start + 1, doc.lines);

    // Refine using the word under the pointer, searched within the block's
    // source range. Falls back to the block's first line.
    const word = wordAtPoint(clientX, clientY);
    if (word) {
      for (let n = start + 1; n <= end; n++) {
        const line = doc.line(n);
        const idx = line.text.indexOf(word);
        if (idx >= 0) return line.from + idx;
      }
    }
    return doc.line(start + 1).from;
  }

  jumpTo(pos) {
    const view = this.view;
    this.master = "editor";
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
  }
}

function wordAtPoint(x, y) {
  let node = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent;
  let a = offset;
  let b = offset;
  const isWord = (c) => /[\p{L}\p{N}_]/u.test(c);
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  const word = text.slice(a, b);
  return word.length >= 2 ? word : null;
}
