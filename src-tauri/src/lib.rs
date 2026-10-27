use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{codecs::jpeg::JpegEncoder, imageops, ColorType, ImageEncoder, RgbaImage};
use tauri::Manager;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ScreenSource {
    pub id: u32,
    pub kind: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

fn encode_image_to_data_url(img: &RgbaImage) -> Result<String, String> {
    let (width, height) = img.dimensions();
    let max_side = 640;
    let (target_width, target_height) = if width > height {
        let scale = (width.max(1) as f32 / max_side as f32).max(1.0);
        let scaled = (width as f32 / scale) as u32;
        let scaled_h = ((height as f32 / width as f32) * scaled as f32) as u32;
        (scaled.max(1), scaled_h.max(1))
    } else {
        let scale = (height.max(1) as f32 / max_side as f32).max(1.0);
        let scaled = (height as f32 / scale) as u32;
        let scaled_w = ((width as f32 / height as f32) * scaled as f32) as u32;
        (scaled_w.max(1), scaled.max(1))
    };
    let scaled = imageops::resize(img, target_width, target_height, imageops::FilterType::Lanczos3);
    let mut buffer = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut buffer, 72)
        .write_image(
            scaled.as_raw(),
            target_width,
            target_height,
            ColorType::Rgba8.into(),
        )
        .map_err(|error| format!("Could not encode preview frame: {error}"))?;
    let encoded = STANDARD.encode(buffer.into_inner());
    Ok(format!("data:image/jpeg;base64,{encoded}"))
}

fn capture_source_image(kind: &str, id: u32) -> Result<RgbaImage, String> {
    match kind {
        "monitor" => {
            let candidate = xcap::Monitor::all()
                .map_err(|error| format!("Failed to list monitors: {error}"))?
                .into_iter()
                .find(|monitor| monitor.id().map(|monitor_id| monitor_id == id).unwrap_or(false));
            let monitor = candidate.ok_or_else(|| format!("Monitor {id} not found"))?;
            monitor.capture_image().map_err(|error| format!("Failed to capture monitor {id}: {error}"))
        }
        "window" => {
            let candidate = xcap::Window::all()
                .map_err(|error| format!("Failed to list windows: {error}"))?
                .into_iter()
                .find(|window| window.id().map(|window_id| window_id == id).unwrap_or(false));
            let window = candidate.ok_or_else(|| format!("Window {id} not found"))?;
            window.capture_image().map_err(|error| format!("Failed to capture window {id}: {error}"))
        }
        _ => Err("Unsupported screen source type".to_string()),
    }
}

mod commands {
    use super::{capture_source_image, encode_image_to_data_url, ScreenSource};

    #[tauri::command]
    pub fn list_screen_sources() -> Result<Vec<ScreenSource>, String> {
        let mut sources = Vec::new();

        for monitor in xcap::Monitor::all().map_err(|error| format!("Failed to enumerate monitors: {error}"))? {
            let Ok(id) = monitor.id() else { continue };
            let Ok(name) = monitor.name() else { continue };
            let Ok(width) = monitor.width() else { continue };
            let Ok(height) = monitor.height() else { continue };
            let Ok(x) = monitor.x() else { continue };
            let Ok(y) = monitor.y() else { continue };
            let Ok(is_primary) = monitor.is_primary() else { continue };
            sources.push(ScreenSource {
                id,
                kind: "monitor".to_string(),
                name,
                width,
                height,
                x,
                y,
                is_primary,
            });
        }

        for window in xcap::Window::all().map_err(|error| format!("Failed to enumerate windows: {error}"))? {
            let Ok(id) = window.id() else { continue };
            let Ok(title) = window.title() else { continue };
            if title.trim().is_empty() {
                continue;
            }
            let Ok(width) = window.width() else { continue };
            let Ok(height) = window.height() else { continue };
            let Ok(x) = window.x() else { continue };
            let Ok(y) = window.y() else { continue };
            let Ok(is_minimized) = window.is_minimized() else { continue };
            if is_minimized {
                continue;
            }

            sources.push(ScreenSource {
                id,
                kind: "window".to_string(),
                name: title,
                width,
                height,
                x,
                y,
                is_primary: false,
            });
        }

        sources.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        Ok(sources)
    }

    #[tauri::command]
    pub fn capture_source_preview(kind: String, id: u32) -> Result<String, String> {
        let captured = capture_source_image(kind.as_str(), id)?;
        encode_image_to_data_url(&captured)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::list_screen_sources,
            commands::capture_source_preview
        ])
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
