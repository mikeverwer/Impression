// CodeMirror 6 editor: markdown syntax highlighting, theme, spellcheck, and
// the bold/italic toggle commands.

import { EditorState, EditorSelection, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { languages } from "@codemirror/language-data";
import { tags as t, Tag, styleTags } from "@lezer/highlight";
import { writingMode } from "./writing.js";

// Custom tags so list bullets, blockquote markers and task checkboxes can be
// coloured independently of the other markdown punctuation.
const listMark = Tag.define();
const quoteMark = Tag.define();
const codeText = Tag.define(); // plain text inside fenced code (default tag is shared with inline code)
const markdownMarks = {
  props: [styleTags({ ListMark: listMark, QuoteMark: quoteMark, TaskMarker: listMark, CodeText: codeText })],
};

// ---------------------------------------------------------------------------
// Theme: every colour comes from a CSS custom property, so the editor follows
// data-theme automatically. Only the `dark` flag differs between the two.

function makeTheme(dark) {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: "var(--cm-bg)",
        color: "var(--cm-fg)",
        // font-size comes from fontCompartment only; a value here would
        // compete with it (theme rules share specificity).
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        lineHeight: "1.65",
        overflow: "auto",
      },
      ".cm-content": {
        padding: "16px 0 50vh",
        caretColor: "var(--cm-cursor)",
      },
      ".cm-line": { padding: "0 24px 0 8px" },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--cm-cursor)" },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--cm-selection)",
      },
      ".cm-activeLine": { backgroundColor: "var(--cm-active-line)" },
      ".cm-gutters": {
        backgroundColor: "var(--cm-gutter-bg)",
        color: "var(--cm-gutter-fg)",
        border: "none",
        minWidth: "3.2em",
      },
      ".cm-activeLineGutter": { backgroundColor: "var(--cm-active-line)" },
      ".cm-selectionMatch": { backgroundColor: "var(--cm-match)" },
      ".cm-searchMatch": { backgroundColor: "var(--cm-match)", outline: "1px solid var(--cm-cursor)" },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--cm-selection)" },
      ".cm-matchingBracket": { backgroundColor: "var(--cm-match)" },
      ".cm-placeholder": { color: "var(--cm-gutter-fg)", fontStyle: "italic" },
      ".cm-panels": { backgroundColor: "var(--ui-bg)", color: "var(--ui-text)" },
      ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--ui-border)" },
      ".cm-panel input, .cm-panel button": { fontFamily: "var(--font-body)" },
    },
    { dark }
  );
}

const themes = { light: makeTheme(false), dark: makeTheme(true) };
const themeCompartment = new Compartment();

// Font size lives in its own compartment so changing it goes through a
// CodeMirror transaction, which re-measures line heights and keeps the
// gutter aligned (an external CSS change would leave stale measurements).
const fontCompartment = new Compartment();
let currentFontSize = 14;
const fontThemes = new Map(); // one mounted stylesheet per size
function fontTheme(px) {
  if (!fontThemes.has(px)) fontThemes.set(px, EditorView.theme({ "&": { fontSize: `${px}px` } }));
  return fontThemes.get(px);
}

// Writing mode (inline rendering) is only meaningful for markdown documents.
const writingCompartment = new Compartment();
let writingEnabled = false;
const writingFor = (kind) =>
  writingEnabled && kind === "markdown"
    ? [syntaxHighlighting(writingHighlightStyle), writingMode()]
    : [syntaxHighlighting(highlightStyle)];

const highlightStyle = HighlightStyle.define([
  // Markdown structure
  { tag: t.heading1, color: "var(--cm-heading)", fontWeight: "bold", fontSize: "1.5em" },
  { tag: t.heading2, color: "var(--cm-heading)", fontWeight: "bold", fontSize: "1.3em" },
  { tag: t.heading3, color: "var(--cm-heading)", fontWeight: "bold", fontSize: "1.15em" },
  { tag: [t.heading4, t.heading5, t.heading6], color: "var(--cm-heading)", fontWeight: "bold" },
  { tag: t.heading, color: "var(--cm-heading)", fontWeight: "bold" },
  { tag: t.strong, color: "var(--cm-strong)", fontWeight: "bold" },
  { tag: t.emphasis, color: "var(--cm-emphasis)", fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--cm-link)", textDecoration: "underline" },
  { tag: t.url, color: "var(--cm-url)" },
  { tag: [t.monospace, codeText], color: "var(--cm-code)" },
  // Blockquote text keeps the normal colour, only italic; the > and list
  // bullets/numbers get the accent below.
  { tag: t.quote, fontStyle: "italic" },
  { tag: t.processingInstruction, color: "var(--cm-marker)" },
  { tag: [listMark, quoteMark], color: "var(--cm-list-mark)", fontWeight: "bold" },
  { tag: t.contentSeparator, color: "var(--cm-marker)", fontWeight: "bold" },
  { tag: t.escape, color: "var(--cm-marker)" },
  { tag: t.labelName, color: "var(--cm-type)" },
  { tag: t.tagName, color: "var(--cm-keyword)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--cm-type)" },

  // Tokens inside fenced code blocks (nested languages via language-data)
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword], color: "var(--cm-keyword)" },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], color: "var(--cm-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: "var(--cm-number)" },
  { tag: [t.typeName, t.className, t.namespace, t.macroName], color: "var(--cm-type)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: "var(--cm-function)" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: "var(--cm-marker)" },
]);

// Writing mode uses the preview's tokens instead of the code-editor palette:
// accent headings with the preview's scale, body-text colour, and monospace
// only for code. Marker colours stay the same.
const writingHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: "var(--color-accent)", fontWeight: "bold", fontSize: "2em" },
  { tag: t.heading2, color: "var(--color-accent)", fontWeight: "bold", fontSize: "1.6em" },
  { tag: t.heading3, color: "var(--color-accent)", fontWeight: "bold", fontSize: "1.35em" },
  { tag: t.heading4, color: "var(--color-accent)", fontWeight: "bold", fontSize: "1.15em" },
  { tag: [t.heading5, t.heading6], color: "var(--color-accent)", fontWeight: "bold" },
  { tag: t.heading, color: "var(--color-accent)", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--color-accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--color-accent)" },
  { tag: t.monospace, color: "var(--color-inline-code-text)", fontFamily: "var(--font-mono)" },
  // codeText is deliberately unstyled here so fenced text takes the slab colour.
  { tag: t.quote, color: "var(--color-quote-text)", fontStyle: "italic" },
  { tag: t.processingInstruction, color: "var(--cm-marker)" },
  { tag: [listMark, quoteMark], color: "var(--cm-list-mark)", fontWeight: "bold" },
  { tag: t.contentSeparator, color: "var(--cm-marker)" },
  { tag: t.escape, color: "var(--cm-marker)" },
  { tag: t.tagName, color: "var(--cm-keyword)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--cm-type)" },
  // Code tokens go through --wm-* variables: the writing theme maps them to
  // the editor palette normally and to the preview's --hl-* palette inside
  // fenced code blocks, which are drawn on the preview's dark slab.
  { tag: t.labelName, color: "var(--wm-type)" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword], color: "var(--wm-keyword)" },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], color: "var(--wm-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--wm-comment)", fontStyle: "italic" },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: "var(--wm-number)" },
  { tag: [t.typeName, t.className, t.namespace, t.macroName], color: "var(--wm-type)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: "var(--wm-function)" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: "var(--wm-punctuation)" },
]);

// ---------------------------------------------------------------------------
// Bold / italic toggling
//
// Works on each selection range (or the cursor if empty). Adjacent `*` runs
// on both sides of the range, inside or outside it, are counted to find the
// current emphasis level (0 none, 1 italic, 2 bold, 3 both); the level is
// then toggled and the text rewritten. Toggling italic on `**text**` gives
// `***text***`; toggling bold on that gives `*text*`.

function starsBefore(doc, pos, max) {
  let n = 0;
  while (n < max && pos - n - 1 >= 0 && doc.sliceString(pos - n - 1, pos - n) === "*") n++;
  return n;
}

function starsAfter(doc, pos, max) {
  let n = 0;
  while (n < max && pos + n < doc.length && doc.sliceString(pos + n, pos + n + 1) === "*") n++;
  return n;
}

export function toggleMark(view, width) {
  const spec = view.state.changeByRange((range) => {
    const doc = view.state.doc;
    const { from, to } = range;
    const text = doc.sliceString(from, to);

    // Stars sitting at the edges of the selection itself.
    let inL = 0;
    while (inL < 3 && inL < text.length && text[inL] === "*") inL++;
    let inR = 0;
    while (inR < 3 && inR < text.length - inL && text[text.length - 1 - inR] === "*") inR++;
    const inK = Math.min(inL, inR);

    // Stars immediately outside the selection (only counted when balanced).
    const outK = Math.min(starsBefore(doc, from, 3), starsAfter(doc, to, 3));

    const a = from - outK;
    const b = to + outK;
    const level = Math.min(inK + outK, 3);
    const content = doc.sliceString(a + level, b - level);

    let next;
    if (width === 2) next = level >= 2 ? level - 2 : level + 2;
    else next = level === 1 || level === 3 ? level - 1 : level + 1;

    const marks = "*".repeat(next);
    const insert = marks + content + marks;
    const selFrom = a + next;
    return {
      changes: { from: a, to: b, insert },
      range: content.length
        ? EditorSelection.range(selFrom, selFrom + content.length)
        : EditorSelection.cursor(selFrom),
    };
  });
  view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input" });
  return true;
}

export const toggleBold = (view) => toggleMark(view, 2);
export const toggleItalic = (view) => toggleMark(view, 1);

// ---------------------------------------------------------------------------

// Per-document language: markdown (with native spellcheck) or CSS.
const languageCompartment = new Compartment();

function languageFor(kind) {
  if (kind === "css") {
    return [css(), EditorView.contentAttributes.of({ spellcheck: "false" })];
  }
  return [
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true, extensions: [markdownMarks] }),
    // Native spellcheck: WebView2 is Chromium, so this uses the OS engine.
    EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "off", autocapitalize: "off" }),
  ];
}

/**
 * Create the editor. Returns { view, newState, setTheme }.
 * `keys` is a list of extra keymap bindings; `onUpdate` receives every
 * ViewUpdate. `newState(text, kind)` builds a state for a "markdown" or
 * "css" document.
 */
export function createEditor({ parent, theme, keys = [], onUpdate, emptyHint = "" }) {
  const extensionsFor = (kind) => [
    kind === "markdown" && emptyHint ? placeholder(emptyHint) : [],
    themeCompartment.of(themes[theme] || themes.light),
    fontCompartment.of(fontTheme(currentFontSize)),
    languageCompartment.of(languageFor(kind)),
    writingCompartment.of(writingFor(kind)),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of("  "),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    keymap.of([...keys, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => onUpdate && onUpdate(update)),
  ];

  const newState = (text = "", kind = "markdown") =>
    EditorState.create({ doc: text, extensions: extensionsFor(kind) });
  const view = new EditorView({ parent, state: newState("") });

  const setTheme = (name) => {
    view.dispatch({ effects: themeCompartment.reconfigure(themes[name] || themes.light) });
  };

  const setFontSize = (px) => {
    currentFontSize = px;
    view.dispatch({ effects: fontCompartment.reconfigure(fontTheme(px)) });
    requestAnimationFrame(() => view.requestMeasure());
  };

  /** Turn writing mode on/off for the current state (`kind` of the active document). */
  const setWritingMode = (on, kind = "markdown") => {
    writingEnabled = on;
    view.dispatch({ effects: writingCompartment.reconfigure(writingFor(kind)) });
  };

  return { view, newState, setTheme, setFontSize, setWritingMode };
}
