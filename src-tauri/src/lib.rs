use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationTarget {
    friend_id: String,
    message_id: String,
}

#[derive(Default)]
struct NotificationNavigationState {
    pending: Mutex<Option<NotificationTarget>>,
}

fn is_uuid(value: &str) -> bool {
    let segments: Vec<_> = value.split('-').collect();
    if segments.len() != 5 {
        return false;
    }

    [8, 4, 4, 4, 12]
        .iter()
        .zip(segments)
        .all(|(expected_length, segment)| {
            segment.len() == *expected_length
                && segment.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

fn parse_notification_target(value: &str) -> Option<NotificationTarget> {
    let path = value.strip_prefix("discordlite://message/")?;
    let mut segments = path.split('/');
    let friend_id = segments.next()?;
    let message_id = segments.next()?;
    if segments.next().is_some() || !is_uuid(friend_id) || !is_uuid(message_id) {
        return None;
    }

    Some(NotificationTarget {
        friend_id: friend_id.to_owned(),
        message_id: message_id.to_owned(),
    })
}

fn queue_notification_target<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    target: NotificationTarget,
) {
    match app.state::<NotificationNavigationState>().pending.lock() {
        Ok(mut pending) => *pending = Some(target.clone()),
        Err(error) => log::error!("Failed to store notification destination: {error}"),
    }
    if let Err(error) = app.emit("notification-open", target) {
        log::error!("Failed to dispatch notification destination: {error}");
    }
}

#[tauri::command]
fn take_notification_target(
    state: tauri::State<'_, NotificationNavigationState>,
) -> Result<Option<NotificationTarget>, String> {
    state
        .pending
        .lock()
        .map(|mut pending| pending.take())
        .map_err(|error| format!("Could not read notification destination: {error}"))
}

#[tauri::command]
async fn show_desktop_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    avatar_url: Option<String>,
    activation_url: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        use std::{os::windows::process::CommandExt, process::Command};

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let notification_icon = if cfg!(debug_assertions) {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("notifications")
                .join("discord-notification.png")
        } else {
            app.path()
                .resolve(
                    "notifications/discord-notification.png",
                    tauri::path::BaseDirectory::Resource,
                )
                .map_err(|error| format!("Could not locate notification icon: {error}"))?
        };
        if !notification_icon.is_file() {
            return Err(format!(
                "Desktop notification icon not found: {}",
                notification_icon.display()
            ));
        }
        let icon_uri = path_to_file_uri(&notification_icon)?;
        let avatar_image = avatar_url
            .as_deref()
            .filter(|url| url.starts_with("https://"))
            .map(|url| {
                format!(
                    r#"<image placement="appLogoOverride" hint-crop="circle" src="{}"/>"#,
                    escape_xml(url)
                )
            })
            .unwrap_or_else(|| {
                format!(
                    r#"<image placement="appLogoOverride" hint-crop="circle" src="{}"/>"#,
                    escape_xml(&icon_uri)
                )
            });
        let launch_attribute = activation_url
            .as_deref()
            .filter(|url| parse_notification_target(url).is_some())
            .map(|url| format!(r#" launch="{}" activationType="protocol""#, escape_xml(url)))
            .unwrap_or_default();
        let toast_xml = format!(
            r#"<toast duration="short"{launch_attribute}><visual><binding template="ToastGeneric">{avatar_image}<text>{}</text><text>{}</text></binding></visual><audio silent="true"/></toast>"#,
            escape_xml(&title),
            escape_xml(&body)
        );
        let encoded_toast = STANDARD.encode(toast_xml.as_bytes());
        let encoded_icon_uri = STANDARD.encode(icon_uri.as_bytes());
        let app_id = app.config().identifier.replace('\'', "''");
        let ps_script = format!(
            r#"$ErrorActionPreference = 'Stop'; try {{ [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $iconUri = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded_icon_uri}')); $identityKey = 'HKCU:\Software\Classes\AppUserModelId\{app_id}'; New-Item -Path $identityKey -Force | Out-Null; New-ItemProperty -Path $identityKey -Name 'IconUri' -Value $iconUri -PropertyType String -Force | Out-Null; New-ItemProperty -Path $identityKey -Name 'IconBackgroundColor' -Value '#5865F2' -PropertyType String -Force | Out-Null; $toastXml = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded_toast}')); $xml = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]::new(); $xml.LoadXml($toastXml); $toast = [Windows.UI.Notifications.ToastNotification]::new($xml); $toast.ExpirationTime = [DateTimeOffset]::Now.AddSeconds(8); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{app_id}').Show($toast); }} catch {{ [Console]::Error.WriteLine($_.Exception.ToString()); exit 1; }}"#
        );
        let output = tauri::async_runtime::spawn_blocking(move || {
            Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    &ps_script,
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
        })
        .await
        .map_err(|error| format!("Windows notification task failed: {error}"))?
        .map_err(|error| format!("Could not start PowerShell for notification: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = stderr.trim();
            return Err(if detail.is_empty() {
                format!(
                    "PowerShell notification exited with status {}.",
                    output.status
                )
            } else {
                format!("PowerShell notification failed: {detail}")
            });
        }

        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = (app, title, body, avatar_url, activation_url);
        Err("Desktop notifications are only supported on Windows.".to_owned())
    }
}

#[cfg(windows)]
fn path_to_file_uri(path: &std::path::Path) -> Result<String, String> {
    let path = path
        .to_str()
        .ok_or_else(|| "Desktop notification icon path is not valid UTF-8.".to_owned())?
        .replace('\\', "/");
    let mut uri = String::from("file:///");
    const HEX: &[u8; 16] = b"0123456789ABCDEF";

    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b':' | b'-' | b'_' | b'.' | b'~') {
            uri.push(byte as char);
        } else {
            uri.push('%');
            uri.push(HEX[(byte >> 4) as usize] as char);
            uri.push(HEX[(byte & 0x0F) as usize] as char);
        }
    }

    Ok(uri)
}

#[cfg(windows)]
fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn run() {
    tauri::Builder::default()
        .manage(native_share::NativeShareState::default())
        .manage(NotificationNavigationState::default())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(target) = argv
                .iter()
                .find_map(|argument| parse_notification_target(argument))
            {
                queue_notification_target(app, target);
            }
            show_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            native_share::list_screen_share_sources,
            native_share::get_screen_share_source_preview,
            native_share::start_native_screen_share,
            native_share::stop_native_screen_share,
            show_desktop_notification,
            take_notification_target
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
            if let Some(target) =
                std::env::args().find_map(|argument| parse_notification_target(&argument))
            {
                queue_notification_target(app.handle(), target);
            }

            #[cfg(windows)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register("discordlite")?;
            }

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

#[cfg(test)]
mod tests {
    use super::{NotificationTarget, parse_notification_target};

    #[test]
    fn parses_notification_destination_with_message_id() {
        let target = parse_notification_target(
            "discordlite://message/123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001",
        );

        assert!(matches!(
            target,
            Some(NotificationTarget { friend_id, message_id })
                if friend_id == "123e4567-e89b-12d3-a456-426614174000"
                    && message_id == "123e4567-e89b-12d3-a456-426614174001"
        ));
    }

    #[test]
    fn rejects_invalid_notification_destinations() {
        assert!(parse_notification_target("https://example.com").is_none());
        assert!(
            parse_notification_target(
                "discordlite://message/not-a-uuid/123e4567-e89b-12d3-a456-426614174001"
            )
            .is_none()
        );
        assert!(parse_notification_target(
            "discordlite://message/123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001/extra"
        )
        .is_none());
        assert!(parse_notification_target(
            "discordlite://message/123e4567-e89b-12d3-a456-426614174000-extra/123e4567-e89b-12d3-a456-426614174001"
        )
        .is_none());
    }
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
