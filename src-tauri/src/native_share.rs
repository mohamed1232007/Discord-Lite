use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use livekit::{
    options::{DegradationPreference, TrackPublishOptions, VideoEncoding},
    prelude::*,
    webrtc::{
        audio_frame::AudioFrame,
        audio_source::{AudioSourceOptions, native::NativeAudioSource},
        video_frame::{I420Buffer, VideoFrame, VideoRotation},
        video_source::{RtcVideoSource, VideoResolution, native::NativeVideoSource},
    },
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::runtime::Handle;
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    encoder::{ImageEncoder, ImageEncoderPixelFormat, ImageFormat},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
    window::Window,
};

const SCREEN_ID_PREFIX: &str = "screen:";
const LOOPBACK_SAMPLE_RATE: u32 = 48_000;
const LOOPBACK_CHANNELS: u32 = 2;
const AUDIO_FRAME_SAMPLES: usize =
    (LOOPBACK_SAMPLE_RATE as usize / 100) * LOOPBACK_CHANNELS as usize;
static NEXT_SOURCE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSource {
    id: String,
    kind: String,
    name: String,
    width: u32,
    height: u32,
}

#[derive(Clone)]
struct CaptureFlags {
    width: u32,
    height: u32,
    video_source: NativeVideoSource,
    app: AppHandle,
    source_id: String,
    stop_audio: Arc<AtomicBool>,
}

struct ScreenCapture {
    flags: CaptureFlags,
}

#[derive(Clone, Copy)]
enum CaptureSource {
    Monitor(Monitor),
    Window(Window),
}

impl TryFrom<CaptureSource> for GraphicsCaptureItemType {
    type Error = String;

    fn try_from(source: CaptureSource) -> Result<Self, Self::Error> {
        match source {
            CaptureSource::Monitor(monitor) => monitor
                .try_into()
                .map_err(|error| format!("Could not open the selected display: {error}")),
            CaptureSource::Window(window) => window
                .try_into()
                .map_err(|error| format!("Could not open the selected window: {error}")),
        }
    }
}

impl GraphicsCaptureApiHandler for ScreenCapture {
    type Flags = CaptureFlags;
    type Error = String;

    fn new(context: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            flags: context.flags,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        let result = (|| {
            let frame_width = frame.width();
            let frame_height = frame.height();
            if frame_width == 0 || frame_height == 0 {
                return Ok(());
            }

            let frame_buffer = frame.buffer().map_err(|error| error.to_string())?;
            let mut scratch = Vec::new();
            let bgra = frame_buffer.as_nopadding_buffer(&mut scratch);
            let i420 = bgra_to_i420(
                &bgra,
                frame_width,
                frame_height,
                self.flags.width,
                self.flags.height,
            )?;
            let video_frame = VideoFrame::new(VideoRotation::VideoRotation0, i420);
            self.flags.video_source.capture_frame(&video_frame);
            Ok(())
        })();
        if let Err(error) = &result {
            self.flags.stop_audio.store(true, Ordering::Release);
            let _ = self
                .flags
                .app
                .emit("native-screen-share-ended", &self.flags.source_id);
            log::error!("Native screen capture stopped: {error}");
        }
        result
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.flags.stop_audio.store(true, Ordering::Release);
        let _ = self
            .flags
            .app
            .emit("native-screen-share-ended", &self.flags.source_id);
        Ok(())
    }
}

fn encode_bgra_preview(
    bgra: &[u8],
    frame_width: u32,
    frame_height: u32,
    max_width: u32,
    max_height: u32,
) -> Result<String, String> {
    if frame_width == 0 || frame_height == 0 {
        return Err("The selected source returned an empty preview.".to_owned());
    }
    let required = frame_width as usize * frame_height as usize * 4;
    if bgra.len() < required {
        return Err("Windows returned an incomplete source preview.".to_owned());
    }
    let scale = (max_width as f64 / frame_width as f64)
        .min(max_height as f64 / frame_height as f64)
        .min(1.0);
    let width = ((frame_width as f64 * scale).round() as u32).max(2);
    let height = ((frame_height as f64 * scale).round() as u32).max(2);
    let mut thumbnail = vec![0_u8; width as usize * height as usize * 4];
    for y in 0..height {
        for x in 0..width {
            let source_x = (x as u64 * frame_width as u64 / width as u64) as u32;
            let source_y = (y as u64 * frame_height as u64 / height as u64) as u32;
            let source_offset = ((source_y * frame_width + source_x) as usize).saturating_mul(4);
            let target_offset = ((y * width + x) as usize).saturating_mul(4);
            thumbnail[target_offset..target_offset + 4]
                .copy_from_slice(&bgra[source_offset..source_offset + 4]);
        }
    }
    let jpeg = ImageEncoder::new(ImageFormat::Jpeg, ImageEncoderPixelFormat::Bgra8)
        .map_err(|error| error.to_string())?
        .encode(&thumbnail, width, height)
        .map_err(|error| error.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", BASE64.encode(jpeg)))
}

struct NativeShareSession {
    room: Room,
    capture: Option<CaptureControl<ScreenCapture, String>>,
    stop_audio: Arc<AtomicBool>,
    audio_thread: Option<JoinHandle<()>>,
}

#[derive(Clone, Copy)]
struct SelectedSource {
    capture: CaptureSource,
    width: u32,
    height: u32,
}

struct PreviewCapture {
    result_sender: Option<mpsc::SyncSender<Result<String, String>>>,
}

impl GraphicsCaptureApiHandler for PreviewCapture {
    type Flags = mpsc::SyncSender<Result<String, String>>;
    type Error = String;

    fn new(context: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            result_sender: Some(context.flags),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        let result = (|| {
            let frame_width = frame.width();
            let frame_height = frame.height();
            if frame_width == 0 || frame_height == 0 {
                return Err("The selected source returned an empty preview.".to_owned());
            }

            let frame_buffer = frame.buffer().map_err(|error| error.to_string())?;
            let mut scratch = Vec::new();
            let bgra = frame_buffer.as_nopadding_buffer(&mut scratch);
            let required = frame_width as usize * frame_height as usize * 4;
            if bgra.len() < required {
                return Err("Windows returned an incomplete source preview.".to_owned());
            }
            encode_bgra_preview(&bgra, frame_width, frame_height, 480, 270)
        })();

        if let Some(sender) = self.result_sender.take() {
            let _ = sender.send(result);
        }
        capture_control.stop();
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        if let Some(sender) = self.result_sender.take() {
            let _ = sender.send(Err(
                "The selected source closed before its preview was ready.".to_owned(),
            ));
        }
        Ok(())
    }
}

pub struct NativeShareState {
    session: Mutex<Option<NativeShareSession>>,
    sources: Mutex<HashMap<String, SelectedSource>>,
}

impl Default for NativeShareState {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
            sources: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub fn list_screen_share_sources(
    state: State<'_, NativeShareState>,
) -> Result<Vec<ShareSource>, String> {
    let mut sources = Vec::new();
    let mut source_snapshot = state
        .sources
        .lock()
        .map_err(|_| "The screen-source list is unavailable.".to_owned())?;
    source_snapshot.clear();

    for (index, monitor) in Monitor::enumerate()
        .map_err(|error| format!("Could not enumerate displays: {error}"))?
        .into_iter()
        .enumerate()
    {
        let width = monitor
            .width()
            .map_err(|error| format!("Could not read display width: {error}"))?;
        let height = monitor
            .height()
            .map_err(|error| format!("Could not read display height: {error}"))?;
        let name = monitor
            .name()
            .unwrap_or_else(|_| format!("Display {}", index + 1));
        let id = next_source_id();
        source_snapshot.insert(
            id.clone(),
            SelectedSource {
                capture: CaptureSource::Monitor(monitor),
                width,
                height,
            },
        );
        sources.push(ShareSource {
            id,
            kind: "monitor".to_owned(),
            name,
            width,
            height,
        });
    }

    for window in Window::enumerate()
        .map_err(|error| format!("Could not enumerate windows: {error}"))?
        .into_iter()
    {
        if !window.is_valid() {
            continue;
        }
        let Ok(name) = window.title() else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() || name == "Discord Lite" {
            continue;
        }
        let (Ok(width), Ok(height)) = (window.width(), window.height()) else {
            continue;
        };
        if width < 64 || height < 64 {
            continue;
        }
        let id = next_source_id();
        source_snapshot.insert(
            id.clone(),
            SelectedSource {
                capture: CaptureSource::Window(window),
                width: width as u32,
                height: height as u32,
            },
        );
        sources.push(ShareSource {
            id,
            kind: "window".to_owned(),
            name: name.to_owned(),
            width: width as u32,
            height: height as u32,
        });
    }

    Ok(sources)
}

#[tauri::command]
pub async fn get_screen_share_source_preview(
    state: State<'_, NativeShareState>,
    source_id: String,
) -> Result<String, String> {
    let source = state
        .sources
        .lock()
        .map_err(|_| "The screen-source list is unavailable.".to_owned())?
        .get(&source_id)
        .copied()
        .ok_or_else(|| {
            "The selected screen source is no longer available. Refresh the list and try again."
                .to_owned()
        })?
        .capture;

    tauri::async_runtime::spawn_blocking(move || capture_source_preview(source))
        .await
        .map_err(|error| format!("The screen preview task failed: {error}"))?
}

fn capture_source_preview(source: CaptureSource) -> Result<String, String> {
    let (result_sender, result_receiver) = mpsc::sync_channel(1);
    let settings = Settings::new(
        source,
        CursorCaptureSettings::WithoutCursor,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Custom(Duration::from_millis(100)),
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        result_sender,
    );
    let capture = PreviewCapture::start_free_threaded(settings)
        .map_err(|error| format!("Could not capture the selected source preview: {error}"))?;

    match result_receiver.recv_timeout(Duration::from_secs(3)) {
        Ok(result) => {
            capture
                .wait()
                .map_err(|error| format!("Could not finish the source preview capture: {error}"))?;
            result
        }
        Err(error) => {
            capture.stop().map_err(|stop_error| {
                format!("Preview timed out ({error}) and cleanup failed: {stop_error}")
            })?;
            Err(format!("The selected source preview timed out: {error}"))
        }
    }
}

#[tauri::command]
pub async fn start_native_screen_share(
    app: AppHandle,
    state: State<'_, NativeShareState>,
    source_id: String,
    server_url: String,
    token: String,
    quality: String,
    frame_rate: u32,
    include_system_audio: bool,
) -> Result<bool, String> {
    if source_id.len() > 64 || !source_id.starts_with(SCREEN_ID_PREFIX) {
        return Err("The selected screen source is invalid.".to_owned());
    }
    if server_url.len() > 2048 || token.len() > 8192 {
        return Err("The LiveKit connection details are invalid.".to_owned());
    }
    let (max_width, max_height, max_bitrate) = match quality.as_str() {
        "480" => (854, 480, 1_500_000),
        "720" => (1280, 720, 3_000_000),
        "1080" => (1920, 1080, 5_000_000),
        _ => return Err("Choose a supported screen-share resolution.".to_owned()),
    };
    if !matches!(frame_rate, 15 | 30 | 60) {
        return Err("The screen-share quality settings are invalid.".to_owned());
    }
    {
        let session = state
            .session
            .lock()
            .map_err(|_| "The screen-sharing state is unavailable.".to_owned())?;
        if session.is_some() {
            return Err("Screen sharing is already active.".to_owned());
        }
    }

    let selected_source = state
        .sources
        .lock()
        .map_err(|_| "The screen-source list is unavailable.".to_owned())?
        .remove(&source_id)
        .ok_or_else(|| {
            "The selected screen source is no longer available. Refresh the list and try again."
                .to_owned()
        })?;
    let (capture_item, source_width, source_height) = (
        selected_source.capture,
        selected_source.width,
        selected_source.height,
    );
    let source_width = source_width.max(2);
    let source_height = source_height.max(2);
    let scale = (max_width as f64 / source_width as f64)
        .min(max_height as f64 / source_height as f64)
        .min(1.0);
    let width = ((source_width as f64 * scale).round() as u32).max(2) & !1;
    let height = ((source_height as f64 * scale).round() as u32).max(2) & !1;
    let stop_audio = Arc::new(AtomicBool::new(false));
    let video_source = NativeVideoSource::new(VideoResolution { width, height }, true);
    let audio_source = include_system_audio.then(|| {
        NativeAudioSource::new(
            AudioSourceOptions::default(),
            LOOPBACK_SAMPLE_RATE,
            LOOPBACK_CHANNELS,
            100,
        )
    });

    let mut room_options = RoomOptions::default();
    room_options.auto_subscribe = false;
    let (room, mut events) = Room::connect(&server_url, &token, room_options)
        .await
        .map_err(|error| {
            format!("Could not connect the native screen publisher to LiveKit: {error}")
        })?;

    let video_track =
        LocalVideoTrack::create_video_track("screen", RtcVideoSource::Native(video_source.clone()));
    let video_options = TrackPublishOptions {
        source: TrackSource::Screenshare,
        video_encoding: Some(VideoEncoding {
            max_bitrate,
            max_framerate: frame_rate as f64,
        }),
        degradation_preference: Some(DegradationPreference::MaintainFramerate),
        ..Default::default()
    };
    if let Err(error) = room
        .local_participant()
        .publish_track(LocalTrack::Video(video_track), video_options)
        .await
    {
        let _ = room.close().await;
        return Err(format!("Could not publish the screen video track: {error}"));
    }

    let flags = CaptureFlags {
        width,
        height,
        video_source,
        app: app.clone(),
        source_id: source_id.clone(),
        stop_audio: stop_audio.clone(),
    };
    let settings = Settings::new(
        capture_item,
        CursorCaptureSettings::WithCursor,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Custom(Duration::from_millis(1000 / frame_rate as u64)),
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    );
    let capture = match ScreenCapture::start_free_threaded(settings) {
        Ok(capture) => capture,
        Err(error) => {
            stop_audio.store(true, Ordering::Release);
            let _ = room.close().await;
            return Err(format!("Could not start native screen capture: {error}"));
        }
    };

    let mut audio_thread = if let Some(audio_source) = audio_source.as_ref() {
        match start_loopback_capture(
            audio_source.clone(),
            stop_audio.clone(),
            Handle::current(),
            app.clone(),
            source_id.clone(),
        ) {
            Ok(thread) => Some(thread),
            Err(error) => {
                log::warn!("System audio is unavailable; continuing with screen video: {error}");
                None
            }
        }
    } else {
        None
    };

    if let (Some(audio_source), Some(_)) = (audio_source.as_ref(), audio_thread.as_ref()) {
        let audio_track = LocalAudioTrack::create_audio_track(
            "screen-audio",
            RtcAudioSource::Native(audio_source.clone()),
        );
        let audio_options = TrackPublishOptions {
            source: TrackSource::ScreenshareAudio,
            ..Default::default()
        };
        if let Err(error) = room
            .local_participant()
            .publish_track(LocalTrack::Audio(audio_track), audio_options)
            .await
        {
            log::warn!("Could not publish system audio; continuing with screen video: {error}");
            stop_audio.store(true, Ordering::Release);
            if let Some(audio_thread) = audio_thread.take() {
                let _ = tauri::async_runtime::spawn_blocking(move || audio_thread.join()).await;
            }
        }
    }

    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            if matches!(event, RoomEvent::Disconnected { .. }) {
                let _ = app.emit("native-screen-share-ended", &source_id);
                break;
            }
        }
    });

    let has_system_audio = audio_thread.is_some();
    let mut pending_session = Some(NativeShareSession {
        room,
        capture: Some(capture),
        stop_audio,
        audio_thread,
    });
    let already_active = {
        let mut session = state
            .session
            .lock()
            .map_err(|_| "The screen-sharing state is unavailable.".to_owned())?;
        if session.is_some() {
            true
        } else {
            *session = pending_session.take();
            false
        }
    };
    if already_active {
        let Some(mut session) = pending_session.take() else {
            return Err("Could not recover the native screen-share session.".to_owned());
        };
        session.stop_audio.store(true, Ordering::Release);
        if let Some(capture) = session.capture.take() {
            let _ = tauri::async_runtime::spawn_blocking(move || capture.stop()).await;
        }
        if let Some(audio_thread) = session.audio_thread.take() {
            let _ = tauri::async_runtime::spawn_blocking(move || audio_thread.join()).await;
        }
        let _ = session.room.close().await;
        return Err("Screen sharing was started elsewhere.".to_owned());
    }
    Ok(has_system_audio)
}

#[tauri::command]
pub async fn stop_native_screen_share(state: State<'_, NativeShareState>) -> Result<(), String> {
    let Some(mut session) = state
        .session
        .lock()
        .map_err(|_| "The screen-sharing state is unavailable.".to_owned())?
        .take()
    else {
        return Ok(());
    };
    session.stop_audio.store(true, Ordering::Release);

    let mut cleanup_errors = Vec::new();
    if let Some(capture) = session.capture.take() {
        match tauri::async_runtime::spawn_blocking(move || capture.stop()).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                cleanup_errors.push(format!("Could not stop native screen capture: {error}"))
            }
            Err(error) => {
                cleanup_errors.push(format!("Could not join native screen capture: {error}"))
            }
        }
    }
    if let Some(audio_thread) = session.audio_thread.take() {
        match tauri::async_runtime::spawn_blocking(move || audio_thread.join()).await {
            Ok(Ok(())) => {}
            Ok(Err(_)) => {
                cleanup_errors.push("System-audio capture stopped unexpectedly.".to_owned())
            }
            Err(error) => {
                cleanup_errors.push(format!("Could not join system-audio capture: {error}"))
            }
        }
    }
    if let Err(error) = session.room.close().await {
        cleanup_errors.push(format!(
            "Could not disconnect the native screen publisher: {error}"
        ));
    }
    if cleanup_errors.is_empty() {
        Ok(())
    } else {
        Err(cleanup_errors.join(" "))
    }
}

fn next_source_id() -> String {
    format!(
        "{SCREEN_ID_PREFIX}{}",
        NEXT_SOURCE_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn bgra_to_i420(
    bgra: &[u8],
    input_width: u32,
    input_height: u32,
    width: u32,
    height: u32,
) -> Result<I420Buffer, String> {
    let required = input_width as usize * input_height as usize * 4;
    if bgra.len() < required || width < 2 || height < 2 {
        return Err("Windows returned an invalid screen frame.".to_owned());
    }
    let mut output = I420Buffer::new(width, height);
    let (y_stride, u_stride, v_stride) = output.strides();
    let (y_plane, u_plane, v_plane) = output.data_mut();

    if input_width == width && input_height == height {
        for row in 0..height {
            let source_row = row as usize * input_width as usize * 4;
            let target_row = row as usize * y_stride as usize;
            for column in 0..width {
                let source = source_row + column as usize * 4;
                let blue = bgra[source] as f32;
                let green = bgra[source + 1] as f32;
                let red = bgra[source + 2] as f32;
                y_plane[target_row + column as usize] =
                    (16.0 + 0.257 * red + 0.504 * green + 0.098 * blue)
                        .round()
                        .clamp(0.0, 255.0) as u8;
            }
        }
        for row in (0..height).step_by(2) {
            for column in (0..width).step_by(2) {
                let top_left = ((row as usize * input_width as usize) + column as usize) * 4;
                let top_right = top_left + 4;
                let bottom_left = top_left + input_width as usize * 4;
                let bottom_right = bottom_left + 4;
                let channels = [0, 1, 2].map(|channel| {
                    (bgra[top_left + channel] as f32
                        + bgra[top_right + channel] as f32
                        + bgra[bottom_left + channel] as f32
                        + bgra[bottom_right + channel] as f32)
                        * 0.25
                });
                let blue = channels[0];
                let green = channels[1];
                let red = channels[2];
                let u_offset = (row / 2 * u_stride + column / 2) as usize;
                let v_offset = (row / 2 * v_stride + column / 2) as usize;
                u_plane[u_offset] = (128.0 - 0.148 * red - 0.291 * green + 0.439 * blue)
                    .round()
                    .clamp(0.0, 255.0) as u8;
                v_plane[v_offset] = (128.0 + 0.439 * red - 0.368 * green - 0.071 * blue)
                    .round()
                    .clamp(0.0, 255.0) as u8;
            }
        }
        return Ok(output);
    }

    let source_pixel = |x: u32, y: u32| -> (f32, f32, f32) {
        let source_x = (x as u64 * input_width as u64 / width as u64) as usize;
        let source_y = (y as u64 * input_height as u64 / height as u64) as usize;
        let offset = (source_y * input_width as usize + source_x) * 4;
        (
            bgra[offset + 2] as f32,
            bgra[offset + 1] as f32,
            bgra[offset] as f32,
        )
    };

    for row in 0..height {
        for column in 0..width {
            let (red, green, blue) = source_pixel(column, row);
            let offset = (row * y_stride + column) as usize;
            y_plane[offset] = ((0.257 * red + 0.504 * green + 0.098 * blue + 16.0)
                .round()
                .clamp(0.0, 255.0)) as u8;
        }
    }
    for row in (0..height).step_by(2) {
        for column in (0..width).step_by(2) {
            let mut red = 0.0;
            let mut green = 0.0;
            let mut blue = 0.0;
            for dy in 0..2 {
                for dx in 0..2 {
                    let (r, g, b) = source_pixel(column + dx, row + dy);
                    red += r;
                    green += g;
                    blue += b;
                }
            }
            red *= 0.25;
            green *= 0.25;
            blue *= 0.25;
            let chroma_offset = (row / 2 * u_stride + column / 2) as usize;
            u_plane[chroma_offset] = ((-0.148 * red - 0.291 * green + 0.439 * blue + 128.0)
                .round()
                .clamp(0.0, 255.0)) as u8;
            let chroma_offset = (row / 2 * v_stride + column / 2) as usize;
            v_plane[chroma_offset] = ((0.439 * red - 0.368 * green - 0.071 * blue + 128.0)
                .round()
                .clamp(0.0, 255.0)) as u8;
        }
    }
    Ok(output)
}

fn start_loopback_capture(
    audio_source: NativeAudioSource,
    stop: Arc<AtomicBool>,
    runtime: Handle,
    app: AppHandle,
    source_id: String,
) -> Result<JoinHandle<()>, String> {
    let (ready_sender, ready_receiver) = mpsc::sync_channel::<Result<(), String>>(1);
    let thread = thread::Builder::new()
        .name("discord-lite-system-audio".to_owned())
        .spawn(move || {
            let setup = (|| -> Result<_, String> {
                use wasapi::{
                    DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat, initialize_mta,
                };
                initialize_mta()
                    .ok()
                    .map_err(|error| format!("COM initialization failed: {error}"))?;
                let enumerator = DeviceEnumerator::new()
                    .map_err(|error| format!("Audio device enumeration failed: {error}"))?;
                let device = enumerator
                    .get_default_device(&Direction::Render)
                    .map_err(|error| format!("Default output device unavailable: {error}"))?;
                let mut client = device
                    .get_iaudioclient()
                    .map_err(|error| format!("Could not open the output device: {error}"))?;
                let format = WaveFormat::new(
                    32,
                    32,
                    &SampleType::Float,
                    LOOPBACK_SAMPLE_RATE as usize,
                    LOOPBACK_CHANNELS as usize,
                    None,
                );
                let (_, minimum_period) = client
                    .get_device_period()
                    .map_err(|error| format!("Could not read the output-device period: {error}"))?;
                client
                    .initialize_client(
                        &format,
                        &Direction::Capture,
                        &StreamMode::EventsShared {
                            autoconvert: true,
                            buffer_duration_hns: minimum_period,
                        },
                    )
                    .map_err(|error| {
                        format!("Could not initialize system-audio loopback: {error}")
                    })?;
                let event = client.set_get_eventhandle().map_err(|error| {
                    format!("Could not create the audio capture event: {error}")
                })?;
                let capture = client
                    .get_audiocaptureclient()
                    .map_err(|error| format!("Could not open system-audio capture: {error}"))?;
                client.start_stream().map_err(|error| {
                    format!("Could not start Windows system-audio loopback: {error}")
                })?;
                Ok((client, capture, event))
            })();

            let (client, capture, event) = match setup {
                Ok(setup) => {
                    if ready_sender.send(Ok(())).is_err() {
                        let _ = setup.0.stop_stream();
                        return;
                    }
                    setup
                }
                Err(error) => {
                    let _ = ready_sender.send(Err(error));
                    return;
                }
            };

            let mut samples = VecDeque::<i16>::new();
            while !stop.load(Ordering::Acquire) {
                let packet_result = (|| -> Result<(), String> {
                    while let Some(packet_frames) = capture
                        .get_next_packet_size()
                        .map_err(|error| error.to_string())?
                    {
                        if packet_frames == 0 {
                            break;
                        }
                        let mut raw = vec![0_u8; packet_frames as usize * 8];
                        let (frames, info) = capture
                            .read_from_device(&mut raw)
                            .map_err(|error| error.to_string())?;
                        if frames == 0 {
                            continue;
                        }
                        if info.flags.silent {
                            samples.extend(std::iter::repeat_n(0_i16, frames as usize * 2));
                        } else {
                            for bytes in raw[..frames as usize * 8].chunks_exact(4) {
                                let sample =
                                    f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                                samples
                                    .push_back((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16);
                            }
                        }
                    }
                    while samples.len() >= AUDIO_FRAME_SAMPLES {
                        let mut data = Vec::with_capacity(AUDIO_FRAME_SAMPLES);
                        for _ in 0..AUDIO_FRAME_SAMPLES {
                            if let Some(sample) = samples.pop_front() {
                                data.push(sample);
                            }
                        }
                        let frame = AudioFrame {
                            data: data.into(),
                            sample_rate: LOOPBACK_SAMPLE_RATE,
                            num_channels: LOOPBACK_CHANNELS,
                            samples_per_channel: LOOPBACK_SAMPLE_RATE / 100,
                        };
                        runtime
                            .block_on(audio_source.capture_frame(&frame))
                            .map_err(|error| format!("Could not publish system audio: {error}"))?;
                    }
                    Ok(())
                })();
                if let Err(error) = packet_result {
                    log::error!("System-audio capture stopped: {error}");
                    stop.store(true, Ordering::Release);
                    let _ = app.emit("native-screen-share-audio-ended", &source_id);
                    break;
                }
                if event.wait_for_event(200_000).is_err() {
                    log::debug!("System-audio capture event wait timed out.");
                }
            }
            if let Err(error) = client.stop_stream() {
                log::warn!("Could not stop Windows system-audio loopback cleanly: {error}");
            }
        })
        .map_err(|error| format!("Could not start system-audio thread: {error}"))?;

    match ready_receiver.recv() {
        Ok(Ok(())) => Ok(thread),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        Err(error) => {
            let _ = thread.join();
            Err(format!(
                "System-audio thread exited during startup: {error}"
            ))
        }
    }
}
