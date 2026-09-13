// Export the rendered document as a single HTML file.
//
// The preview DOM is cloned, so Mermaid diagrams (inline SVG) and KaTeX markup
// come along as they are. Local images are embedded as data URIs, the theme
// tokens and the active preview stylesheet are inlined, and the editor's own
// attributes are stripped. The result opens anywhere, with no Impression and
// no adjacent files needed.

import variablesCss from "./styles/variables.css?raw";

const KATEX_CSS_URL = "https://cdn.jsdelivr.net/npm/katex@0.18.7/dist/katex.min.css";

const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

function base64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

/**
 * Build the standalone HTML document.
 * @param {HTMLElement} preview  the live preview element
 * @param {string} css           the active preview stylesheet text
 * @param {string} fallbackTitle used when the document has no heading
 * @param {(path: string) => Promise<Uint8Array>} readBinary
 */
export async function buildHtml(preview, css, fallbackTitle, readBinary) {
  const article = preview.cloneNode(true);

  // Editor-only bookkeeping has no place in the exported file.
  for (const el of article.querySelectorAll("[data-source-line]")) {
    el.removeAttribute("data-source-line");
    el.removeAttribute("data-source-line-end");
  }

  // Inline local images; anything remote or already inline is left alone.
  const failed = [];
  for (const img of article.querySelectorAll("img[data-file]")) {
    const file = img.getAttribute("data-file");
    img.removeAttribute("data-file");
    const ext = (file.split(".").pop() || "").toLowerCase();
    try {
      const bytes = await readBinary(file);
      img.setAttribute("src", `data:${MIME[ext] || "application/octet-stream"};base64,${base64(bytes)}`);
    } catch (err) {
      console.warn("could not embed image", file, err);
      failed.push(file);
    }
  }

  const heading = article.querySelector("h1, h2");
  const title = (heading && heading.textContent.trim()) || fallbackTitle;
  const needsKatex = Boolean(article.querySelector(".katex"));

  const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${needsKatex ? `<link rel="stylesheet" href="${KATEX_CSS_URL}">\n` : ""}<style>
${variablesCss}
html { background: var(--color-bg-page); }
body {
  margin: 0;
  padding: 32px 16px 64px;
  background: var(--color-bg-page);
}
.markdown-body {
  box-sizing: border-box;
  max-width: 920px;
  margin: 0 auto;
  padding: 40px 48px 64px;
  background: var(--color-bg-card);
  box-shadow: 0 0 12px -6px var(--color-shadow);
}
@media print {
  body { padding: 0; background: #fff; }
  .markdown-body { max-width: none; margin: 0; padding: 0; background: transparent; box-shadow: none; }
}
${css}
</style>
</head>
<body>
<article class="markdown-body">
${article.innerHTML}
</article>
</body>
</html>
`;
  return { html, failed };
}
