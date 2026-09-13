// Outline panel: a collapsible tree of the document's headings, built from
// CodeMirror's syntax tree (so it costs nothing extra to parse).

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";

/** Flat list of { level, text, from, line } for every heading in the document. */
export function extractHeadings(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) || syntaxTree(state);
  const headings = [];
  tree.iterate({
    enter(node) {
      const match = /^(ATX|Setext)Heading(\d)$/.exec(node.name);
      if (!match) return undefined;
      const line = state.doc.lineAt(node.from);
      let text = line.text;
      if (match[1] === "ATX") text = text.replace(/^\s{0,3}#{1,6}[ \t]*/, "").replace(/[ \t]+#+[ \t]*$/, "");
      text = text.trim() || "(untitled)";
      headings.push({ level: Number(match[2]), text, from: node.from, line: line.number });
      return false; // headings don't nest
    },
  });
  return headings;
}

/** Nest headings by level: each heading goes under the nearest shallower one. */
export function buildTree(headings) {
  const root = { level: 0, children: [] };
  const stack = [root];
  const seen = new Map();
  for (const h of headings) {
    const base = `${h.level}:${h.text}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    const node = { ...h, key: n ? `${base}#${n}` : base, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children;
}

export class OutlinePanel {
  /**
   * @param {HTMLElement} container  element that receives the tree
   * @param {{ onSelect: (heading: object) => void }} opts
   */
  constructor(container, { onSelect }) {
    this.container = container;
    this.onSelect = onSelect;
    this.collapsed = new Set(); // keys of collapsed nodes; swapped per document
    this.headings = [];
    this.rows = new Map(); // heading.from -> row element
    this.activeFrom = -1;
  }

  /** Use a document's own collapse state. */
  setCollapsedStore(set) {
    this.collapsed = set;
  }

  render(headings, emptyMessage = "No headings") {
    this.headings = headings;
    this.rows.clear();
    const frag = document.createDocumentFragment();
    if (!headings.length) {
      const empty = document.createElement("div");
      empty.className = "outline-empty";
      empty.textContent = emptyMessage;
      frag.appendChild(empty);
    } else {
      frag.appendChild(this.renderList(buildTree(headings), 0));
    }
    this.container.replaceChildren(frag);
    this.setActive(this.activeFrom, true);
  }

  renderList(nodes, depth) {
    const ul = document.createElement("ul");
    ul.className = "outline-list";
    for (const node of nodes) {
      const li = document.createElement("li");
      li.className = `outline-item level-${node.level}`;
      if (node.children.length && this.collapsed.has(node.key)) li.classList.add("collapsed");

      const row = document.createElement("div");
      row.className = "outline-row";
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.title = node.text;

      const chevron = document.createElement("button");
      chevron.type = "button";
      chevron.className = "outline-chevron";
      chevron.tabIndex = -1;
      if (node.children.length) {
        chevron.setAttribute("aria-label", "Collapse");
        chevron.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.collapsed.has(node.key)) this.collapsed.delete(node.key);
          else this.collapsed.add(node.key);
          li.classList.toggle("collapsed", this.collapsed.has(node.key));
        });
      } else {
        chevron.classList.add("outline-chevron-spacer");
        chevron.disabled = true;
      }

      const label = document.createElement("span");
      label.className = "outline-label";
      label.textContent = node.text;

      row.append(chevron, label);
      row.addEventListener("click", () => this.onSelect(node));
      li.appendChild(row);
      this.rows.set(node.from, row);
      if (node.children.length) li.appendChild(this.renderList(node.children, depth + 1));
      ul.appendChild(li);
    }
    return ul;
  }

  /** Highlight the heading that contains document position `pos`. */
  setActive(pos, force = false) {
    let current = -1;
    for (const h of this.headings) {
      if (h.from <= pos) current = h.from;
      else break;
    }
    if (current === this.activeFrom && !force) return;
    if (this.rows.has(this.activeFrom)) this.rows.get(this.activeFrom).classList.remove("active");
    this.activeFrom = current;
    const row = this.rows.get(current);
    if (row) {
      row.classList.add("active");
      row.scrollIntoView({ block: "nearest" });
    }
  }
}
