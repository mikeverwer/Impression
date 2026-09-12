// PDF export via the native print dialog.
//
// The exported PDF is a static snapshot, so before printing the app:
//  1. switches the preview to the light theme (and re-renders Mermaid
//     diagrams with the light theme) so the page prints on white,
//  2. forces every <details> open, otherwise its content silently vanishes.
// Everything is restored after the dialog closes.

export async function exportPdf({ preview, rerender, currentTheme }) {
  const root = document.documentElement;
  const previousTheme = root.dataset.theme;
  const details = Array.from(preview.querySelectorAll("details"));
  const wasOpen = details.map((d) => d.open);
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    details.forEach((d, i) => (d.open = wasOpen[i]));
    if (previousTheme !== "light") {
      root.dataset.theme = previousTheme;
      rerender(currentTheme());
    }
  };

  details.forEach((d) => (d.open = true));
  if (previousTheme !== "light") {
    root.dataset.theme = "light";
    await rerender("light");
  }
  // Let layout and any pending transitions settle before the snapshot.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 350)));

  window.addEventListener("afterprint", restore, { once: true });
  window.print();
  // Chromium blocks in print() until the dialog closes; afterprint should
  // already have fired. This is a safety net in case it never does.
  setTimeout(restore, 1000);
}
