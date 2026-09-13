// Markdown table helpers: insert a blank table, move between cells with Tab,
// and re-align a table's pipes.
//
// All of these work on plain text; there is no table model. A "table line" is
// any line whose first non-space character is a pipe.

const BLANK_TABLE = "|  |  |\n|---|---|\n|  |  |";

function isTableLine(text) {
  return /^\s*\|/.test(text);
}

/** Split a table row into trimmed cells, keeping escaped pipes intact. */
function splitCells(text) {
  const body = text.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      cell += "\\|";
      i++;
    } else if (body[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += body[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

const DELIMITER_CELL = /^:?-+:?$/;

function isDelimiterRow(cells) {
  return cells.length > 0 && cells.every((c) => DELIMITER_CELL.test(c));
}

/**
 * Positions of each cell in a table line, as [start, end] document offsets of
 * the text between pipes. The trailing pipe closes the last cell.
 */
function cellRanges(line) {
  const pipes = [];
  for (let i = 0; i < line.text.length; i++) {
    if (line.text[i] === "|" && line.text[i - 1] !== "\\") pipes.push(i);
  }
  const ranges = [];
  for (let i = 0; i < pipes.length - 1; i++) {
    ranges.push([line.from + pipes[i] + 1, line.from + pipes[i + 1]]);
  }
  return ranges;
}

/** Selection that puts the caret usefully inside a cell: its content, or its middle. */
function selectionForCell(state, [from, to]) {
  const text = state.doc.sliceString(from, to);
  const lead = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  if (text.trim()) return { anchor: from + lead, head: to - trailing };
  // Empty cell: sit between the padding spaces.
  return { anchor: from + Math.min(1, text.length) };
}

// ---------------------------------------------------------------------------

/** Insert a blank 2x2 table, caret in the first heading cell. */
export function insertTable(view) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const line = doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const after = line.text.slice(to - line.from);

  let prefix = "";
  if (before.trim()) prefix = "\n\n";
  else if (line.number > 1 && doc.line(line.number - 1).text.trim()) prefix = "\n";

  const suffix = after.trim() ? "\n\n" : "\n";
  const insert = prefix + BLANK_TABLE + suffix;
  // Two characters into "|  |" is the middle of the first heading cell.
  const caret = from + prefix.length + 2;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: caret },
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
  return true;
}

/**
 * Move to the next (dir 1) or previous (dir -1) table cell.
 * Returns false when the caret is not in a table, so Tab keeps its usual
 * indent behaviour everywhere else.
 */
export function moveCell(view, dir) {
  const state = view.state;
  const doc = state.doc;
  const head = state.selection.main.head;
  const line = doc.lineAt(head);
  if (!isTableLine(line.text)) return false;

  const ranges = cellRanges(line);
  if (!ranges.length) return false;

  let index = ranges.findIndex(([from, to]) => head >= from && head <= to);
  if (index < 0) index = head < ranges[0][0] ? 0 : ranges.length - 1;

  const target = index + dir;
  if (target >= 0 && target < ranges.length) {
    view.dispatch({ selection: selectionForCell(state, ranges[target]), scrollIntoView: true });
    return true;
  }

  // Past the end of the row: step to the next/previous table line, skipping
  // the delimiter row so Tab walks through editable cells only.
  let n = line.number + dir;
  while (n >= 1 && n <= doc.lines) {
    const next = doc.line(n);
    if (!isTableLine(next.text)) return false;
    const nextRanges = cellRanges(next);
    if (nextRanges.length && !isDelimiterRow(splitCells(next.text))) {
      const cell = dir > 0 ? nextRanges[0] : nextRanges[nextRanges.length - 1];
      view.dispatch({ selection: selectionForCell(state, cell), scrollIntoView: true });
      return true;
    }
    n += dir;
  }
  return false;
}

/** Re-align the pipes of the table around the caret. */
export function formatTable(view) {
  const state = view.state;
  const doc = state.doc;
  const head = state.selection.main.head;
  const caretLine = doc.lineAt(head);
  if (!isTableLine(caretLine.text)) return false;

  let first = caretLine.number;
  let last = caretLine.number;
  while (first > 1 && isTableLine(doc.line(first - 1).text)) first--;
  while (last < doc.lines && isTableLine(doc.line(last + 1).text)) last++;

  const rows = [];
  for (let n = first; n <= last; n++) rows.push(splitCells(doc.line(n).text));
  const columns = Math.max(...rows.map((r) => r.length));

  // Remember where the caret was so it can land in the same cell afterwards.
  const caretRow = caretLine.number - first;
  const caretRanges = cellRanges(caretLine);
  let caretCell = caretRanges.findIndex(([f, t]) => head >= f && head <= t);
  if (caretCell < 0) caretCell = 0;

  const widths = new Array(columns).fill(3);
  rows.forEach((cells) => {
    if (isDelimiterRow(cells)) return;
    for (let c = 0; c < columns; c++) widths[c] = Math.max(widths[c], (cells[c] || "").length);
  });

  const indent = /^\s*/.exec(doc.line(first).text)[0];
  const lines = rows.map((cells) => {
    const out = [];
    for (let c = 0; c < columns; c++) {
      const cell = cells[c] || "";
      if (isDelimiterRow(cells)) {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":") && cell.length > 1;
        const width = widths[c];
        let bar;
        if (left && right) bar = `:${"-".repeat(Math.max(1, width - 2))}:`;
        else if (left) bar = `:${"-".repeat(Math.max(2, width - 1))}`;
        else if (right) bar = `${"-".repeat(Math.max(2, width - 1))}:`;
        else bar = "-".repeat(width);
        out.push(bar);
      } else {
        out.push(cell.padEnd(widths[c]));
      }
    }
    return `${indent}| ${out.join(" | ")} |`;
  });

  const from = doc.line(first).from;
  const to = doc.line(last).to;
  const text = lines.join("\n");
  if (text === doc.sliceString(from, to)) return true; // already aligned

  view.dispatch({ changes: { from, to, insert: text }, userEvent: "input" });

  // Put the caret back in the same cell of the same row.
  const newLine = view.state.doc.line(first + caretRow);
  const ranges = cellRanges(newLine);
  if (ranges.length) {
    const cell = ranges[Math.min(caretCell, ranges.length - 1)];
    view.dispatch({ selection: selectionForCell(view.state, cell) });
  }
  view.focus();
  return true;
}
