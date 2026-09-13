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
          case "FencedCode":
            eachLine(node.from, node.to, codeLine);
            break;
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
  ".cm-content": { maxWidth: "80ch", margin: "0 auto" },
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
  },
  ".cm-wm-codeblock": { backgroundColor: "var(--cm-codeblock-bg)" },
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
