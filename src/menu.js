// Native menus, built from JS with Tauri's menu API so the menu logic and the
// app state live in one place. Accelerators are registered natively; the
// frontend also handles the same key combos as a fallback and the action
// dispatcher in main.js de-duplicates the two.

import { Menu, Submenu, MenuItem, PredefinedMenuItem, CheckMenuItem } from "@tauri-apps/api/menu";

/**
 * Build and install the application menu.
 * `run(actionId, source)` dispatches actions; `themePref` is the initial
 * "system" | "light" | "dark" preference.
 */
export async function installAppMenu(run, themePref) {
  const item = (id, text, accelerator) =>
    MenuItem.new({ id, text, accelerator: accelerator || undefined, action: () => run(id, "menu") });
  const separator = () => PredefinedMenuItem.new({ item: "Separator" });

  const file = await Submenu.new({
    text: "&File",
    items: [
      await item("new", "&New", "CmdOrCtrl+N"),
      await item("open", "&Open…", "CmdOrCtrl+O"),
      await separator(),
      await item("save", "&Save", "CmdOrCtrl+S"),
      await item("save-as", "Save &As…", "CmdOrCtrl+Shift+S"),
      await separator(),
      await item("export-pdf", "&Export to PDF…", "CmdOrCtrl+P"),
      await separator(),
      await item("close-tab", "&Close Tab", "CmdOrCtrl+W"),
      await item("quit", "E&xit"),
    ],
  });

  const edit = await Submenu.new({
    text: "&Edit",
    items: [
      await item("bold", "&Bold", "CmdOrCtrl+B"),
      await item("italic", "&Italic", "CmdOrCtrl+I"),
    ],
  });

  const themeItems = {};
  for (const [id, text] of [
    ["system", "Follow &System"],
    ["light", "&Light"],
    ["dark", "&Dark"],
  ]) {
    themeItems[id] = await CheckMenuItem.new({
      id: `theme-${id}`,
      text,
      checked: themePref === id,
      action: () => run(`theme-${id}`, "menu"),
    });
  }

  // Preview Style submenu: fixed commands around a rebuildable list of
  // stylesheet radio items.
  const styleMenu = await Submenu.new({
    text: "Preview &Style",
    items: [
      await item("edit-styles", "&Edit Preview Styles…", "CmdOrCtrl+Shift+E"),
      await separator(),
      // stylesheet items are inserted here (index 2)
      await separator(),
      await item("refresh-styles", "&Refresh List"),
      await item("open-styles-folder", "&Open Styles Folder"),
    ],
  });
  let styleItems = [];

  const fontMenu = await Submenu.new({
    text: "Editor &Font Size",
    items: [
      // Ctrl with = - 0 is swallowed by the webview (browser zoom keys), so
      // these follow Word's Ctrl+Shift+> / Ctrl+Shift+< convention.
      await item("font-increase", "&Increase", "CmdOrCtrl+Shift+."),
      await item("font-decrease", "&Decrease", "CmdOrCtrl+Shift+,"),
      await item("font-reset", "&Reset"),
    ],
  });

  const zoomMenu = await Submenu.new({
    text: "Preview &Zoom",
    items: [
      await item("zoom-in", "Zoom &In", "CmdOrCtrl+Shift+]"),
      await item("zoom-out", "Zoom &Out", "CmdOrCtrl+Shift+["),
      await item("zoom-reset", "&Reset"),
    ],
  });

  const writingItem = await CheckMenuItem.new({
    id: "toggle-writing",
    text: "&Writing Mode",
    accelerator: "CmdOrCtrl+Shift+W",
    checked: false,
    action: () => run("toggle-writing", "menu"),
  });

  const outlineItem = await CheckMenuItem.new({
    id: "toggle-outline",
    text: "&Outline",
    accelerator: "CmdOrCtrl+Shift+O",
    checked: false,
    action: () => run("toggle-outline", "menu"),
  });

  const view = await Submenu.new({
    text: "&View",
    items: [
      outlineItem,
      writingItem,
      await item("toggle-preview", "Toggle &Preview", "CmdOrCtrl+Shift+P"),
      await item("reset-split", "&Reset Split"),
      await separator(),
      fontMenu,
      zoomMenu,
      await separator(),
      styleMenu,
      await Submenu.new({ text: "&Theme", items: [themeItems.system, themeItems.light, themeItems.dark] }),
    ],
  });

  const menu = await Menu.new({ items: [file, edit, view] });
  if (navigator.userAgent.includes("Mac")) await menu.setAsAppMenu();
  else await menu.setAsWindowMenu();

  return {
    async setThemeChecked(pref) {
      for (const [id, it] of Object.entries(themeItems)) await it.setChecked(id === pref);
    },

    async setWritingChecked(on) {
      await writingItem.setChecked(on);
    },

    async setOutlineChecked(on) {
      await outlineItem.setChecked(on);
    },

    /** Replace the stylesheet radio items with `names`, checking `activeName`. */
    async setStyleList(names, activeName) {
      for (const it of styleItems) await styleMenu.remove(it);
      styleItems = [];
      for (const name of names) {
        styleItems.push(
          await CheckMenuItem.new({
            id: `style:${name}`,
            text: name === "default.css" ? "Default (default.css)" : name,
            checked: name.toLowerCase() === activeName.toLowerCase(),
            action: () => run(`style:${name}`, "menu"),
          })
        );
      }
      await styleMenu.insert(styleItems, 2);
    },

    async setStyleChecked(activeName) {
      for (const it of styleItems) {
        const name = it.id.slice("style:".length);
        await it.setChecked(name.toLowerCase() === activeName.toLowerCase());
      }
    },
  };
}

/**
 * Context menu for the preview pane: the standard Copy / Select All entries
 * plus "Jump to Source". WebView2's built-in menu cannot be extended from
 * JS, so this native popup stands in for it.
 */
export async function createPreviewContextMenu(onJump) {
  const jump = await MenuItem.new({ id: "jump-to-source", text: "Jump to Source", action: onJump });
  const menu = await Menu.new({
    items: [
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      jump,
    ],
  });
  return {
    async popup(canJump) {
      await jump.setEnabled(canJump);
      await menu.popup();
    },
  };
}
