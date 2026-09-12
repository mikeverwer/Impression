//! Tauri backend. All application logic (menus, tabs, rendering, file I/O)
//! lives in the frontend; the Rust side only registers the plugins the
//! frontend calls into (native dialogs, file system, opening links).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
