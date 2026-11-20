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

fn build_notification_toast_xml(
    title: &str,
    body: &str,
    launch_attribute: &str,
    avatar_file_uri: Option<&str>,
) -> String {
    let escaped_title = escape_xml(title);
    let escaped_body = escape_xml(body);
    let image_xml = if let Some(uri) = avatar_file_uri {
        format!(r#"<image placement="appLogoOverride" hint-crop="circle" src="{}"/>"#, escape_xml(uri))
    } else {
        String::new()
    };
    format!(
        r#"<toast duration="short"{launch_attribute}><visual><binding template="ToastGeneric">{image_xml}<text>{escaped_title}</text><text>{escaped_body}</text></binding></visual><audio silent="true"/></toast>"#
    )
}

#[cfg(windows)]
fn save_avatar_bytes(bytes: &[u8], extension: &str) -> Result<String, String> {
    use std::{
        fs,
        hash::{Hash, Hasher},
    };

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "Windows local app data path is unavailable.".to_owned())?;
    let avatar_path = std::path::PathBuf::from(local_app_data)
        .join("DiscordLite")
        .join("NotificationAvatars")
        .join(format!("avatar-{:016x}.{}", hasher.finish(), extension));
    if !avatar_path.is_file() {
        let directory = avatar_path
            .parent()
            .ok_or_else(|| "Could not locate sender-avatar cache directory.".to_owned())?;
        fs::create_dir_all(directory)
            .map_err(|error| format!("Could not create sender-avatar cache: {error}"))?;
        let temporary_path = avatar_path.with_extension(format!(
            "{extension}-{}-{}.tmp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| format!("System clock error: {error}"))?
                .as_nanos()
        ));
        fs::write(&temporary_path, bytes)
            .map_err(|error| format!("Could not cache sender avatar: {error}"))?;
        if let Err(error) = fs::rename(&temporary_path, &avatar_path) {
            if !avatar_path.is_file() {
                let _ = fs::remove_file(&temporary_path);
                return Err(format!("Could not finalize sender-avatar cache: {error}"));
            }
            let _ = fs::remove_file(&temporary_path);
        }
    }
    path_to_file_uri(&avatar_path)
}

#[cfg(windows)]
fn parse_notification_avatar_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value)
        .map_err(|error| format!("Sender avatar URL is invalid: {error}"))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("Sender avatar URL must use HTTP or HTTPS.".to_owned());
    }
    Ok(url)
}

#[cfg(windows)]
fn notification_avatar_extension(mime_type: &str, avatar_url: &reqwest::Url) -> &'static str {
    match mime_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        _ => {
            let ext = avatar_url.path().rsplit('.').next().unwrap_or("");
            match ext.to_ascii_lowercase().as_str() {
                "png" => "png",
                "jpg" | "jpeg" => "jpg",
                "webp" => "webp",
                _ => "png",
            }
        }
    }
}

#[cfg(windows)]
async fn cache_notification_avatar(avatar_url: Option<&str>) -> Result<Option<String>, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let Some(avatar_url) = avatar_url.filter(|s| !s.trim().is_empty()) else {
        return Ok(None);
    };

    if avatar_url.starts_with("data:image/") {
        if let Some((header, base64_data)) = avatar_url.split_once(";base64,") {
            let extension = if header.contains("png") {
                "png"
            } else if header.contains("webp") {
                "webp"
            } else {
                "jpg"
            };
            if let Ok(bytes) = STANDARD.decode(base64_data.trim()) {
                if !bytes.is_empty() && bytes.len() <= 5 * 1024 * 1024 {
                    return save_avatar_bytes(&bytes, extension).map(Some);
                }
            }
        }
    }

    let url = parse_notification_avatar_url(avatar_url)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(3))
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Could not create sender-avatar client: {error}"))?;
    let response = client
        .get(url.clone())
        .header(
            reqwest::header::ACCEPT,
            "image/png,image/jpeg,image/webp,*/*",
        )
        .send()
        .await
        .map_err(|error| format!("Could not download sender avatar: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Sender-avatar request returned HTTP {}.",
            response.status()
        ));
    }

    let mime_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default();
    let extension = notification_avatar_extension(mime_type, &url);
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read sender avatar: {error}"))?;
    if bytes.is_empty() {
        return Err("Sender avatar download was empty.".to_owned());
    }

    save_avatar_bytes(&bytes, extension).map(Some)
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

        let (ico_dos_path, png_dos_path) = if cfg!(debug_assertions) {
            let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let ico = manifest_dir.join("icons").join("icon.ico");
            let png = manifest_dir.join("icons").join("Square44x44Logo.png");
            (
                ico.to_string_lossy().into_owned(),
                png.to_string_lossy().into_owned(),
            )
        } else {
            let ico = app
                .path()
                .resolve("icons/icon.ico", tauri::path::BaseDirectory::Resource)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let png = app
                .path()
                .resolve("icons/Square44x44Logo.png", tauri::path::BaseDirectory::Resource)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            (ico, png)
        };

        let notification_icon = if !ico_dos_path.is_empty() && std::path::Path::new(&ico_dos_path).is_file() {
            std::path::PathBuf::from(&ico_dos_path)
        } else if !png_dos_path.is_empty() && std::path::Path::new(&png_dos_path).is_file() {
            std::path::PathBuf::from(&png_dos_path)
        } else {
            std::path::PathBuf::from("icons/icon.ico")
        };

        let icon_uri = path_to_file_uri(&notification_icon).unwrap_or_default();
        let avatar_file_uri = match cache_notification_avatar(avatar_url.as_deref()).await {
            Ok(Some(uri)) => Some(uri),
            Ok(None) => if icon_uri.is_empty() { None } else { Some(icon_uri) },
            Err(error) => {
                log::warn!("Could not cache sender avatar, falling back: {error}");
                if icon_uri.is_empty() { None } else { Some(icon_uri) }
            }
        };

        let launch_attribute = activation_url
            .as_deref()
            .filter(|url| parse_notification_target(url).is_some())
            .map(|url| format!(r#" launch="{}" activationType="protocol""#, escape_xml(url)))
            .unwrap_or_default();

        let toast_xml = build_notification_toast_xml(
            &title,
            &body,
            &launch_attribute,
            avatar_file_uri.as_deref(),
        );
        let encoded_toast_xml = STANDARD.encode(toast_xml.as_bytes());
        let encoded_ico_path = STANDARD.encode(ico_dos_path.as_bytes());
        let encoded_png_path = STANDARD.encode(png_dos_path.as_bytes());
        let app_id = app.config().identifier.replace('\'', "''");
        let ps_script = r#"
$ErrorActionPreference = 'Stop'
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null

    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    $appDir = Join-Path $localAppData 'DiscordLite'
    if (!(Test-Path $appDir)) {
        New-Item -ItemType Directory -Path $appDir -Force -ErrorAction SilentlyContinue | Out-Null
    }

    $sourceIco = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__ICO_PATH__'))
    $targetIco = Join-Path $appDir 'app.ico'
    if ($sourceIco -and (Test-Path $sourceIco)) {
        if (!(Test-Path $targetIco) -or ((Get-Item $sourceIco).LastWriteTime -gt (Get-Item $targetIco).LastWriteTime)) {
            Copy-Item -Path $sourceIco -Destination $targetIco -Force -ErrorAction SilentlyContinue
        }
    }

    $sourcePng = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PNG_PATH__'))
    $targetPng = Join-Path $appDir 'app.png'
    if ($sourcePng -and (Test-Path $sourcePng)) {
        if (!(Test-Path $targetPng) -or ((Get-Item $sourcePng).LastWriteTime -gt (Get-Item $targetPng).LastWriteTime)) {
            Copy-Item -Path $sourcePng -Destination $targetPng -Force -ErrorAction SilentlyContinue
        }
    }

    $chosenIcon = if (Test-Path $targetIco) { $targetIco } elseif (Test-Path $targetPng) { $targetPng } else { $sourceIco }

    $identityKey = 'HKCU:\Software\Classes\AppUserModelId\__APP_ID__'
    try {
        New-Item -Path $identityKey -Force -ErrorAction SilentlyContinue | Out-Null
        New-ItemProperty -Path $identityKey -Name 'DisplayName' -Value 'Discord Lite' -PropertyType String -Force -ErrorAction SilentlyContinue | Out-Null
        New-ItemProperty -Path $identityKey -Name 'IconUri' -Value $chosenIcon -PropertyType String -Force -ErrorAction SilentlyContinue | Out-Null
        New-ItemProperty -Path $identityKey -Name 'IconBackgroundColor' -Value '0' -PropertyType String -Force -ErrorAction SilentlyContinue | Out-Null
    } catch {}

    try {
        $programs = [Environment]::GetFolderPath('Programs')
        $shortcut = Join-Path $programs 'Discord Lite.lnk'
        if (!(Test-Path $shortcut)) {
            $wsh = New-Object -ComObject WScript.Shell
            $sc = $wsh.CreateShortcut($shortcut)
            $currentExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
            $sc.TargetPath = $currentExe
            if (Test-Path $targetIco) {
                $sc.IconLocation = "$targetIco,0"
            }
            $sc.Save()
        }
    } catch {}

    $toastXml = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__TOAST_XML__'))
    $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
    $xml.LoadXml($toastXml)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $toast.ExpirationTime = [DateTimeOffset]::Now.AddSeconds(6)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('__APP_ID__').Show($toast)
} catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    exit 1
}
"#
        .replace("__ICO_PATH__", &encoded_ico_path)
        .replace("__PNG_PATH__", &encoded_png_path)
        .replace("__APP_ID__", &app_id)
        .replace("__TOAST_XML__", &encoded_toast_xml);

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
        if !output.stderr.is_empty() {
            log::warn!(
                "Could not load the sender avatar for a desktop notification: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
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
    use super::{
        NotificationTarget, build_notification_toast_xml, notification_avatar_extension,
        parse_notification_avatar_url, parse_notification_target,
    };

    #[test]
    fn lays_out_sender_avatar_next_to_notification_text() {
        let xml = build_notification_toast_xml("sender", "message", "", Some("file:///avatar.png"));
        assert!(xml.contains(
            r#"<image placement="appLogoOverride" hint-crop="circle" src="file:///avatar.png"/>"#
        ));
        assert!(xml.contains("<text>sender</text>"));
        assert!(xml.contains("<text>message</text>"));
    }

    #[test]
    fn accepts_http_and_https_sender_avatar_urls() {
        assert!(
            parse_notification_avatar_url(
                "https://yzipdagodwiumzvhqkof.supabase.co/storage/v1/object/public/avatars/user.png"
            )
            .is_ok()
        );
        assert!(parse_notification_avatar_url("http://localhost:3000/avatar.png").is_ok());
        assert!(parse_notification_avatar_url("file:///avatar.png").is_err());
    }

    #[test]
    fn detects_supported_sender_avatar_extensions() {
        let png = reqwest::Url::parse("https://example.com/avatar.png").unwrap();
        let webp = reqwest::Url::parse("https://example.com/avatar.webp").unwrap();
        let unknown = reqwest::Url::parse("https://example.com/avatar").unwrap();

        assert_eq!(notification_avatar_extension("image/png", &png), "png");
        assert_eq!(notification_avatar_extension("image/jpeg", &png), "jpg");
        assert_eq!(notification_avatar_extension("image/webp", &png), "webp");
        assert_eq!(
            notification_avatar_extension("application/octet-stream", &png),
            "png"
        );
        assert_eq!(notification_avatar_extension("", &webp), "webp");
        assert_eq!(notification_avatar_extension("", &unknown), "png");
    }

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
    if let Err(error) = window.unminimize() {
        log::error!("Failed to unminimize main window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::error!("Failed to focus main window from system tray: {error}");
    }
}
