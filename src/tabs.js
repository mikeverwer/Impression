// Tab bar: renders the list of open documents and reports clicks.

export class TabBar {
  constructor(container, { onSelect, onClose }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onClose = onClose;
  }

  render(docs, active) {
    const frag = document.createDocumentFragment();
    for (const doc of docs) {
      const tab = document.createElement("div");
      tab.className = "tab" + (doc === active ? " active" : "") + (doc.dirty ? " dirty" : "");
      tab.setAttribute("role", "tab");
      tab.title = doc.path || doc.name;

      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = doc.name;

      const dirty = document.createElement("span");
      dirty.className = "tab-dirty";
      dirty.title = "Unsaved changes";

      const close = document.createElement("button");
      close.className = "tab-close";
      close.type = "button";
      close.title = "Close (Ctrl+W)";
      close.setAttribute("aria-label", `Close ${doc.name}`);
      close.textContent = "×";

      tab.append(name, dirty, close);
      tab.addEventListener("mousedown", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.onClose(doc);
        } else if (e.button === 0 && e.target !== close) {
          this.onSelect(doc);
        }
      });
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onClose(doc);
      });
      frag.appendChild(tab);
    }
    this.container.replaceChildren(frag);
    const activeEl = this.container.querySelector(".tab.active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}
