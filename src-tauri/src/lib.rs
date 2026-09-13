//! Tauri backend. All application logic (menus, tabs, rendering, file I/O)
//! lives in the frontend; the Rust side registers plugins and exposes the
//! launch arguments so files opened from Explorer or a terminal reach it.

use std::path::PathBuf;
use tauri::{Emitter, Manager};

/// File paths given on the command line (absolute), skipping flags.
fn file_args<I: IntoIterator<Item = String>>(args: I, cwd: Option<&std::path::Path>) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(&a);
            let abs = if p.is_absolute() {
                p
            } else if let Some(base) = cwd {
                base.join(p)
            } else {
                std::env::current_dir().map(|d| d.join(&p)).unwrap_or(p)
            };
            abs.to_string_lossy().into_owned()
        })
        .collect()
}

/// Files passed to this (first) instance on launch.
#[tauri::command]
fn launch_args() -> Vec<String> {
    file_args(std::env::args().skip(1), None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second launch forwards its arguments to
        // the running instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let files = file_args(args.into_iter().skip(1), Some(std::path::Path::new(&cwd)));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit("open-files", files);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![launch_args])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
