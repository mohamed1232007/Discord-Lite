use tauri::Manager;

#[cfg(windows)]
mod native_share;

#[cfg(not(windows))]
mod native_share {
    use tauri::{AppHandle, State};

    #[derive(Default)]
    pub struct NativeShareState;

    #[tauri::command]
    pub fn list_screen_share_sources(
        _state: State<'_, NativeShareState>,
    ) -> Result<Vec<serde_json::Value>, String> {
        Err("Native screen sharing is only available in the Windows desktop app.".to_owned())
    }

    #[tauri::command]
    pub async fn get_screen_share_source_preview(
        _state: State<'_, NativeShareState>,
        _source_id: String,
    ) -> Result<String, String> {
        Err("Native screen sharing is only available in the Windows desktop app.".to_owned())
    }

    #[tauri::command]
    pub async fn start_native_screen_share(
        _app: AppHandle,
        _state: State<'_, NativeShareState>,
        _source_id: String,
        _server_url: String,
        _token: String,
        _quality: String,
        _frame_rate: u32,
        _include_system_audio: bool,
    ) -> Result<bool, String> {
        Err("Native screen sharing is only available in the Windows desktop app.".to_owned())
    }

    #[tauri::command]
    pub async fn stop_native_screen_share(
        _state: State<'_, NativeShareState>,
    ) -> Result<(), String> {
        Err("Native screen sharing is only available in the Windows desktop app.".to_owned())
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(native_share::NativeShareState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            native_share::list_screen_share_sources,
            native_share::get_screen_share_source_preview,
            native_share::start_native_screen_share,
            native_share::stop_native_screen_share
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    log::error!("Failed to hide window to system tray: {error}");
                }
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            use tauri::{
                menu::{Menu, MenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
            };

            let open_item =
                MenuItem::with_id(app, "open", "Open Discord Lite", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit Discord Lite", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("Default window icon is not configured")?;

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Discord Lite")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        log::error!("Main window is unavailable when restoring from system tray");
        return;
    };

    if let Err(error) = window.show() {
        log::error!("Failed to show main window from system tray: {error}");
        return;
    }
    if let Err(error) = window.set_focus() {
        log::error!("Failed to focus main window from system tray: {error}");
    }
}
