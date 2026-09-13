// Tab bar: renders the list of open documents, reports clicks, and lets tabs
// be dragged into a different order.
//
// Reordering uses pointer events rather than HTML5 drag-and-drop: the webview
// reserves native drag-and-drop for file drops from Explorer, which the app
// uses to open files and insert images.

const DRAG_THRESHOLD = 4;

export class TabBar {
  constructor(container, { onSelect, onClose, onReorder }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onClose = onClose;
    this.onReorder = onReorder;
  }

  render(docs, active) {
    const frag = document.createDocumentFragment();
    docs.forEach((doc, index) => {
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
      tab.addEventListener("pointerdown", (e) => this.onPointerDown(e, tab, doc, index, docs.length));
      tab.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.onClose(doc);
        }
      });
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onClose(doc);
      });
      frag.appendChild(tab);
    });
    this.container.replaceChildren(frag);
    const activeEl = this.container.querySelector(".tab.active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  onPointerDown(event, tab, doc, index, count) {
    if (event.button !== 0 || event.target.classList.contains("tab-close")) return;
    event.preventDefault();
    this.onSelect(doc);
    if (count < 2 || !this.onReorder) return;

    // Static geometry of every tab, captured before anything moves.
    const tabs = Array.from(this.container.children);
    const boxes = tabs.map((el) => el.getBoundingClientRect());
    const startX = event.clientX;
    let dragging = false;
    let target = index;

    tab.setPointerCapture(event.pointerId);

    const move = (e) => {
      const dx = e.clientX - startX;
      if (!dragging && Math.abs(dx) < DRAG_THRESHOLD) return;
      dragging = true;
      tab.classList.add("dragging");
      tab.style.transform = `translateX(${dx}px)`;
      const centre = boxes[index].left + boxes[index].width / 2 + dx;
      let next = index;
      for (let i = 0; i < boxes.length; i++) {
        if (i === index) continue;
        const mid = boxes[i].left + boxes[i].width / 2;
        if (i < index && centre < mid) {
          next = Math.min(next, i);
        } else if (i > index && centre > mid) {
          next = Math.max(next, i);
        }
      }
      target = next;
    };

    const end = () => {
      tab.removeEventListener("pointermove", move);
      tab.removeEventListener("pointerup", end);
      tab.removeEventListener("pointercancel", end);
      tab.classList.remove("dragging");
      tab.style.transform = "";
      if (dragging && target !== index) this.onReorder(index, target);
    };

    tab.addEventListener("pointermove", move);
    tab.addEventListener("pointerup", end);
    tab.addEventListener("pointercancel", end);
  }
}
