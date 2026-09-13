// Writing mode: Obsidian-style live preview inside the editor.
//
// The document stays plain text. A view plugin walks CodeMirror's syntax
// tree for the visible lines and adds decorations: heading, emphasis, code,
// link and strikethrough markers are hidden, `>` becomes a quote bar, list
// bullets become •, task markers become clickable checkboxes and `---`
// becomes a rule. Lines touched by the selection are left as raw source so
// the markers can be edited. Fenced code, tables, math, images, footnotes
// and definition lists are shown as source (the preview renders them).

import { Decoration, ViewPlugin, WidgetType, EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-wm-bullet";
    span.textContent = "•";
    return span;
  }
  eq() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-wm-hr";
    return span;
  }
  eq() {
    return true;
  }
}

class CheckWidget extends WidgetType {
  constructor(checked, pos) {
    super();
    this.checked = checked;
    this.pos = pos; // offset of the `[`
  }
  eq(other) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-wm-check";
    input.checked = this.checked;
    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" },
      });
    });
    return input;
  }
  ignoreEvent() {
    return true;
  }
}

const bulletWidget = new BulletWidget();
const ruleWidget = new RuleWidget();

const hidden = Decoration.replace({});
const inlineCodeMark = Decoration.mark({ class: "cm-wm-inline-code" });
const quoteLine = Decoration.line({ class: "cm-wm-quote" });
const codeLine = Decoration.line({ class: "cm-wm-codeblock" });
const codeFirstLine = Decoration.line({ class: "cm-wm-codeblock cm-wm-codeblock-first" });
const codeLastLine = Decoration.line({ class: "cm-wm-codeblock cm-wm-codeblock-last" });
const h1Line = Decoration.line({ class: "cm-wm-h1" });
const h2Line = Decoration.line({ class: "cm-wm-h2" });

function buildDecorations(view) {
  const { state } = view;
  const doc = state.doc;
  const ranges = [];

  // Lines touched by any selection range show their raw markup.
  const active = new Set();
  for (const range of state.selection.ranges) {
    const a = doc.lineAt(range.from).number;
    const b = doc.lineAt(range.to).number;
    for (let n = a; n <= b; n++) active.add(n);
  }
  const isActive = (from, to) => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(Math.min(to, doc.length)).number;
    for (let n = a; n <= b; n++) if (active.has(n)) return true;
    return false;
  };
  const hide = (from, to) => {
    if (to > from && !isActive(from, to)) ranges.push(hidden.range(from, to));
  };
  // Extend a marker range over one following space so hidden markers don't
  // leave a stray indent.
  const withSpace = (to) => (doc.sliceString(to, to + 1) === " " ? to + 1 : to);
  const eachLine = (from, to, deco) => {
    let pos = from;
    while (pos <= to && pos <= doc.length) {
      const line = doc.lineAt(pos);
      ranges.push(deco.range(line.from));
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  };

  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const parent = node.node.parent;
        const parentName = parent ? parent.name : "";
        switch (node.name) {
          case "ATXHeading1":
          case "SetextHeading1":
            ranges.push(h1Line.range(doc.lineAt(node.from).from));
            break;
          case "ATXHeading2":
          case "SetextHeading2":
            ranges.push(h2Line.range(doc.lineAt(node.from).from));
            break;
          case "HeaderMark":
            if (/^ATXHeading/.test(parentName)) hide(node.from, withSpace(node.to));
            else hide(node.from, node.to); // setext underline
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
            hide(node.from, node.to);
            break;
          case "CodeMark":
            if (parentName === "InlineCode") hide(node.from, node.to);
            break;
          case "InlineCode":
            ranges.push(inlineCodeMark.range(node.from, node.to));
            break;
          case "LinkMark":
          case "LinkLabel":
          case "LinkTitle":
            hide(node.from, node.to);
            break;
          case "URL":
            // In `[text](url)` hide the url; in an autolink the url is the text.
            if (parentName !== "Autolink") hide(node.from, node.to);
            break;
          case "QuoteMark":
            hide(node.from, withSpace(node.to));
            break;
          case "Blockquote":
            if (parentName !== "Blockquote") eachLine(node.from, node.to, quoteLine);
            break;
          case "ListMark": {
            const list = parent && parent.parent;
            if (list && list.name === "BulletList" && !isActive(node.from, node.to)) {
              ranges.push(Decoration.replace({ widget: bulletWidget }).range(node.from, node.to));
            }
            break;
          }
          case "TaskMarker":
            if (!isActive(node.from, node.to)) {
              const checked = /x/i.test(doc.sliceString(node.from, node.to));
              ranges.push(Decoration.replace({ widget: new CheckWidget(checked, node.from) }).range(node.from, node.to));
            }
            break;
          case "HorizontalRule":
            if (!isActive(node.from, node.to)) {
              ranges.push(Decoration.replace({ widget: ruleWidget }).range(node.from, node.to));
            }
            break;
          case "FencedCode": {
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(Math.min(node.to, doc.length)).number;
            for (let n = first; n <= last; n++) {
              const deco = n === first ? codeFirstLine : n === last ? codeLastLine : codeLine;
              ranges.push(deco.range(doc.line(n).from));
            }
            break;
          }
          default:
            break;
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(update) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

const theme = EditorView.theme({
  // Prose in the preview's font and colour; code stays monospace.
  ".cm-content": {
    maxWidth: "80ch",
    margin: "0 auto",
    fontFamily: "var(--font-markdown)",
    fontSize: "1.1em",
    lineHeight: "1.6",
    color: "var(--color-body-text)",
    // Code tokens: editor palette by default (see writingHighlightStyle).
    "--wm-keyword": "var(--cm-keyword)",
    "--wm-string": "var(--cm-string)",
    "--wm-comment": "var(--cm-comment)",
    "--wm-number": "var(--cm-number)",
    "--wm-type": "var(--cm-type)",
    "--wm-function": "var(--cm-function)",
    "--wm-punctuation": "var(--cm-marker)",
  },
  ".cm-wm-h1": { borderBottom: "2px solid var(--color-accent)", paddingBottom: "0.1em", marginBottom: "0.4em" },
  ".cm-wm-h2": { borderBottom: "1px solid var(--color-accent)", paddingBottom: "0.1em", marginBottom: "0.3em" },
  ".cm-wm-quote": { borderLeft: "3px solid var(--cm-list-mark)", paddingLeft: "12px" },
  ".cm-wm-bullet": { color: "var(--cm-list-mark)", fontWeight: "bold" },
  ".cm-wm-hr": {
    display: "inline-block",
    width: "100%",
    borderTop: "2px solid var(--cm-marker)",
    verticalAlign: "middle",
  },
  ".cm-wm-inline-code": {
    backgroundColor: "var(--cm-codeblock-bg)",
    borderRadius: "3px",
    padding: "0 3px",
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
  },
  // Fenced code: the preview's dark slab with its highlight.js palette.
  ".cm-wm-codeblock": {
    backgroundColor: "#383e4a",
    color: "#eeffff",
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    padding: "0 16px",
    "--wm-keyword": "var(--hl-keyword, var(--cm-keyword))",
    "--wm-string": "var(--hl-string, var(--cm-string))",
    "--wm-comment": "var(--hl-comment, var(--cm-comment))",
    "--wm-number": "var(--hl-number, var(--cm-number))",
    "--wm-type": "var(--hl-type, var(--cm-type))",
    "--wm-function": "var(--hl-function, var(--cm-function))",
    "--wm-punctuation": "var(--hl-punctuation, var(--cm-marker))",
  },
  ".cm-wm-codeblock-first": { borderRadius: "3px 3px 0 0", paddingTop: "6px" },
  ".cm-wm-codeblock-last": { borderRadius: "0 0 3px 3px", paddingBottom: "6px" },
  "&.cm-focused .cm-wm-codeblock.cm-activeLine, .cm-wm-codeblock.cm-activeLine": {
    backgroundColor: "#434a58",
  },
  ".cm-wm-check": {
    accentColor: "var(--cm-list-mark)",
    margin: "0 6px 0 0",
    verticalAlign: "middle",
    cursor: "pointer",
  },
});

/** The writing-mode extension bundle. */
export function writingMode() {
  return [plugin, theme];
}
