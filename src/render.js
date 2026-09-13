// Markdown rendering pipeline.
//
// renderMarkdown(): markdown-it (html, linkify, typographer, footnotes,
// definition lists) with highlight.js wired through the `highlight` option.
// Every block-level element is stamped with data-source-line /
// data-source-line-end from markdown-it's token.map; scroll sync and
// jump-to-source both build on that single mapping.
//
// enhance(): the second, debounced pass over the rendered DOM that runs KaTeX
// auto-render and Mermaid. Both libraries are imported lazily the first time
// a document needs them, so a plain document never pays for them at startup.

// applyCached() is the synchronous per-keystroke pass; enhance() finishes
// whatever it could not do (lazy imports, uncached diagrams).

import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import deflist from "markdown-it-deflist";
import hljs from "highlight.js/lib/common";

// ---------------------------------------------------------------------------
// Language labels for fenced code blocks (rendered as data-lang="…").
// Anything not listed falls back to highlight.js's own display name, then to
// the raw info string.

const LANG_LABELS = {
  js: "JavaScript", javascript: "JavaScript", jsx: "JSX",
  ts: "TypeScript", typescript: "TypeScript", tsx: "TSX",
  py: "Python", python: "Python",
  rs: "Rust", rust: "Rust",
  sh: "Shell", shell: "Shell", bash: "Bash", zsh: "Zsh",
  ps1: "PowerShell", powershell: "PowerShell", pwsh: "PowerShell",
  html: "HTML", xml: "XML", svg: "SVG",
  css: "CSS", scss: "SCSS", less: "Less",
  json: "JSON", jsonc: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", ini: "INI",
  md: "Markdown", markdown: "Markdown",
  sql: "SQL", graphql: "GraphQL",
  c: "C", h: "C", cpp: "C++", "c++": "C++", cc: "C++", hpp: "C++",
  cs: "C#", csharp: "C#", "c#": "C#",
  java: "Java", kotlin: "Kotlin", kt: "Kotlin", scala: "Scala",
  go: "Go", golang: "Go",
  rb: "Ruby", ruby: "Ruby", php: "PHP", perl: "Perl", pl: "Perl",
  swift: "Swift", objc: "Objective-C", objectivec: "Objective-C",
  r: "R", lua: "Lua", dart: "Dart", elixir: "Elixir", haskell: "Haskell", hs: "Haskell",
  diff: "Diff", patch: "Diff", makefile: "Makefile", make: "Makefile",
  dockerfile: "Dockerfile", docker: "Dockerfile",
  tex: "LaTeX", latex: "LaTeX",
  wasm: "WebAssembly",
  mermaid: "Mermaid",
  text: "Text", txt: "Text", plaintext: "Text", plain: "Text",
};

export function languageLabel(lang) {
  const key = lang.toLowerCase();
  if (LANG_LABELS[key]) return LANG_LABELS[key];
  const def = hljs.getLanguage(key);
  if (def && def.name) return def.name;
  return lang;
}

// ---------------------------------------------------------------------------
// markdown-it setup

function highlightCode(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch (err) {
      console.warn("highlight.js failed for", lang, err);
    }
  }
  // Returning an empty string tells the fence renderer to escape the raw code.
  return "";
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: highlightCode,
})
  .use(footnote)
  .use(deflist);

const { escapeHtml, unescapeAll } = md.utils;

// Stamp source line ranges onto every block-level opening token.
md.core.ruler.push("source_lines", (state) => {
  for (const token of state.tokens) {
    if (!token.map || token.nesting < 0 || token.hidden || token.type === "inline") continue;
    token.attrSet("data-source-line", String(token.map[0]));
    token.attrSet("data-source-line-end", String(token.map[1]));
  }
});

// GitHub-style task lists: "- [ ] todo" / "- [x] done" become list items with
// a (disabled) checkbox. Runs after inline parsing so the marker is the first
// text child of the item's paragraph.
md.core.ruler.after("inline", "task_lists", (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline.type !== "inline" || tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue;
    const first = inline.children && inline.children[0];
    if (!first || first.type !== "text") continue;
    const match = /^\[([ xX])\](?:\s+|$)/.exec(first.content);
    if (!match) continue;
    first.content = first.content.slice(match[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input class="task-list-item-checkbox" type="checkbox" disabled${match[1] === " " ? "" : " checked"}> `;
    inline.children.unshift(box);
    tokens[i - 2].attrJoin("class", "task-list-item");
  }
});

// Heading ids so in-document links ([text](#section)) survive into the PDF.
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

md.core.ruler.push("heading_ids", (state) => {
  const used = new Map();
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "heading_open") continue;
    const inline = tokens[i + 1];
    const text =
      inline && inline.type === "inline" && inline.children
        ? inline.children
            .filter((t) => t.type === "text" || t.type === "code_inline")
            .map((t) => t.content)
            .join("")
        : "";
    let slug = slugify(text) || "section";
    const count = used.get(slug) || 0;
    used.set(slug, count + 1);
    if (count) slug = `${slug}-${count}`;
    tokens[i].attrSet("id", slug);
  }
});

// Fenced code: mermaid blocks become a .mermaid div holding the raw diagram
// text; everything else becomes <pre><code class="hljs language-x" data-lang>.
md.renderer.rules.fence = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  const info = token.info ? unescapeAll(token.info).trim() : "";
  const lang = info.split(/\s+/g)[0] || "";
  const attrs = self.renderAttrs(token);

  if (lang.toLowerCase() === "mermaid") {
    return `<div class="mermaid"${attrs}>${escapeHtml(token.content)}</div>\n`;
  }

  let code = "";
  if (lang && options.highlight) code = options.highlight(token.content, lang, "");
  if (!code) code = escapeHtml(token.content);

  const classes = lang ? `hljs language-${escapeHtml(lang)}` : "hljs";
  const label = lang ? ` data-lang="${escapeHtml(languageLabel(lang))}"` : "";
  return `<pre${attrs}><code class="${classes}"${label}>${code}</code></pre>\n`;
};

// Tables are wrapped in .table-wrapper; the stylesheet expects this.
md.renderer.rules.table_open = (tokens, idx, _options, _env, self) =>
  `<div class="table-wrapper"${self.renderAttrs(tokens[idx])}><table>`;
md.renderer.rules.table_close = () => "</table></div>";

export function renderMarkdown(source) {
  return md.render(source);
}

// ---------------------------------------------------------------------------
// Second pass: KaTeX and Mermaid

let renderMath = null;
let mermaid = null;
let mermaidTheme = null;
let mermaidSeq = 0;
const mermaidCache = new Map(); // `${theme}\n${text}` -> svg markup
const MERMAID_CACHE_MAX = 64;

const KATEX_OPTIONS = {
  delimiters: [
    { left: "$$", right: "$$", display: true },
    { left: "$", right: "$", display: false },
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
  ],
  throwOnError: false,
  ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
  ignoredClasses: ["mermaid"],
};

/**
 * Run KaTeX and Mermaid over `container`.
 * `isStale()` lets the caller abort when a newer render has replaced the DOM
 * while a lazy import or diagram layout was in flight.
 */
function hasMath(container) {
  const text = container.textContent;
  return text.includes("$") || text.includes("\\(") || text.includes("\\[");
}

/**
 * Synchronous fast path run on every keystroke: KaTeX (once its module is
 * loaded) and any Mermaid diagram whose SVG is already cached. Returns true
 * when something still needs the async pass (a library not yet loaded, or an
 * uncached diagram).
 */
export function applyCached(container, theme) {
  let pending = false;
  if (hasMath(container)) {
    if (renderMath) renderMath(container, KATEX_OPTIONS);
    else pending = true;
  }
  for (const node of container.querySelectorAll(".mermaid:not([data-rendered])")) {
    const svg = mermaid && mermaidTheme === theme ? mermaidCache.get(`${theme}\n${node.textContent}`) : null;
    if (svg) {
      node.innerHTML = svg;
      node.dataset.rendered = "1";
    } else pending = true;
  }
  return pending;
}

export async function enhance(container, theme, isStale = () => false) {
  if (hasMath(container)) {
    if (!renderMath) {
      renderMath = (await import("katex/contrib/auto-render")).default;
      if (isStale()) return;
      renderMath(container, KATEX_OPTIONS);
    } else if (!container.querySelector(".katex")) {
      renderMath(container, KATEX_OPTIONS);
    }
  }

  const nodes = Array.from(container.querySelectorAll(".mermaid:not([data-rendered])"));
  if (!nodes.length) return;

  if (!mermaid) {
    mermaid = (await import("mermaid")).default;
    if (isStale()) return;
  }
  if (mermaidTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
    });
    mermaidTheme = theme;
  }

  for (const node of nodes) {
    const text = node.textContent;
    const key = `${theme}\n${text}`;
    let svg = mermaidCache.get(key);
    if (!svg) {
      try {
        ({ svg } = await mermaid.render(`mermaid-${++mermaidSeq}`, text));
      } catch (err) {
        if (isStale()) return;
        node.innerHTML = `<pre class="mermaid-error">${escapeHtml(String(err && err.message ? err.message : err))}</pre>`;
        continue;
      }
      if (isStale()) return;
      if (mermaidCache.size >= MERMAID_CACHE_MAX) {
        mermaidCache.delete(mermaidCache.keys().next().value);
      }
      mermaidCache.set(key, svg);
    }
    node.innerHTML = svg;
    node.dataset.rendered = "1";
  }
}
