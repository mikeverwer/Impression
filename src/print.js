// PDF export via the native print dialog.
//
// The exported PDF is a static snapshot, so before printing the app:
//  1. switches the preview to the light theme (and re-renders Mermaid
//     diagrams with the light theme) so the page prints on white,
//  2. forces every <details> open, otherwise its content silently vanishes.
// Everything is restored after the dialog closes.

export async function exportPdf({ preview, rerender, currentTheme }) {
  // `preview` is the article element; every <details> inside it is forced
  // open after the print render below.
  const root = document.documentElement;
  const previousTheme = root.dataset.theme;
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    if (previousTheme !== "light") root.dataset.theme = previousTheme;
    // Re-render for the screen: restores the theme and closes the <details>
    // that were forced open.
    rerender(currentTheme());
  };

  // Always re-render: the preview may be stale or empty if its pane is hidden
  // (writing mode, or the preview toggled off).
  if (previousTheme !== "light") root.dataset.theme = "light";
  await rerender("light");
  preview.querySelectorAll("details").forEach((d) => (d.open = true));
  // Let layout and any pending transitions settle before the snapshot.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 350)));

  window.addEventListener("afterprint", restore, { once: true });
  window.print();
  // Chromium blocks in print() until the dialog closes; afterprint should
  // already have fired. This is a safety net in case it never does.
  setTimeout(restore, 1000);
}
