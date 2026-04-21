use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

struct PendingFiles(Mutex<Vec<String>>);

fn extract_file_paths(argv: &[String]) -> Vec<String> {
    argv.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| !a.is_empty())
        .cloned()
        .collect()
}

#[tauri::command]
fn take_pending_files(state: State<'_, PendingFiles>) -> Vec<String> {
    let mut guard = state.0.lock().unwrap();
    std::mem::take(&mut *guard)
}

// Read a file by absolute path without going through the fs plugin's
// scope system. The fs plugin only grants scope to paths that came from
// its own dialog — paths handed in via OS file associations are rejected.
// This command lets us open whatever the user explicitly points us at.
#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, argv, _cwd| {
                let files = extract_file_paths(&argv);
                if files.is_empty() {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                // Queue first so the frontend can pick it up even if the emit
                // is missed; also emit for live delivery when listener is ready.
                {
                    let state: State<PendingFiles> = app.state();
                    state.0.lock().unwrap().extend(files.clone());
                }
                let _ = app.emit("open-files", files);
            },
        ));
    }

    builder
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![take_pending_files, read_project_file])
        .setup(|app| {
            let argv: Vec<String> = std::env::args().collect();
            let files = extract_file_paths(&argv);
            if !files.is_empty() {
                let state: State<PendingFiles> = app.state();
                state.0.lock().unwrap().extend(files);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
