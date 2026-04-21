use tauri::{Emitter, Manager};

fn collect_file_args(argv: &[String]) -> Vec<String> {
    argv.iter()
        .skip(1)
        .filter(|a| !a.starts_with("--") && !a.starts_with('-'))
        .filter(|a| {
            let lower = a.to_lowercase();
            lower.ends_with(".perkloom") || lower.ends_with(".json")
        })
        .cloned()
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, argv, _cwd| {
                let files = collect_file_args(&argv);
                if files.is_empty() {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
                let _ = app.emit("open-files", files);
            },
        ));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let argv: Vec<String> = std::env::args().collect();
            let files = collect_file_args(&argv);
            if !files.is_empty() {
                let handle = app.handle().clone();
                // Defer so the frontend listener has a chance to attach.
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    let _ = handle.emit("open-files", files);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
