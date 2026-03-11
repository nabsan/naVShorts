mod core;
mod media;

use std::collections::HashMap;
use std::fs;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use core::{
    alternating_zoom_envelope, analyze_beats_from_video, decay_envelope,
    dynamic_loop_zoom_envelope, normalize_beat_map, BeatPoint,
};
use media::{
    build_filtergraph, build_reframe_filtergraph, detect_hardware_encoders, estimate_face_track_points,
    ffmpeg_binary, ffprobe_binary, probe_video, render_with_ffmpeg, tool_version_line, verify_onnx_assets,
};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub path: String,
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatMap {
    pub points: Vec<BeatPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZoomMode {
    None,
    ZoomIn,
    ZoomOut,
    ZoomInOutBeat,
    ZoomInOutLoop,
    ZoomSineSmooth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectsConfig {
    pub zoom_mode: ZoomMode,
    pub zoom_strength: f64,
    pub bounce_strength: f64,
    pub beat_sensitivity: f64,
    #[serde(default)]
    pub motion_blur_strength: f64,
}

impl Default for EffectsConfig {
    fn default() -> Self {
        Self {
            zoom_mode: ZoomMode::ZoomIn,
            zoom_strength: 0.18,
            bounce_strength: 0.16,
            beat_sensitivity: 0.55,
            motion_blur_strength: 0.0,
        }
    }
}

impl EffectsConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.0..=1.0).contains(&self.zoom_strength) {
            return Err("zoom_strength must be between 0.0 and 1.0".to_string());
        }
        if !(0.0..=1.0).contains(&self.bounce_strength) {
            return Err("bounce_strength must be between 0.0 and 1.0".to_string());
        }
        if !(0.0..=1.0).contains(&self.beat_sensitivity) {
            return Err("beat_sensitivity must be between 0.0 and 1.0".to_string());
        }
        if !(0.0..=1.0).contains(&self.motion_blur_strength) {
            return Err("motion_blur_strength must be between 0.0 and 1.0".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectState {
    pub input_video: Option<String>,
    pub video_info: Option<VideoInfo>,
    pub effects: EffectsConfig,
    pub beat_map: Option<BeatMap>,
}

impl Default for ProjectState {
    fn default() -> Self {
        Self {
            input_video: None,
            video_info: None,
            effects: EffectsConfig::default(),
            beat_map: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportPreset {
    Shorts1080x1920,
    Reels1080x1920,
    #[serde(rename = "vertical4k2160x3840")]
    Vertical4K2160x3840,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VideoEncoder {
    Auto,
    Cpu,
    Nvidia,
    Intel,
    Amd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReframeRenderRequest {
    pub input_path: String,
    pub output_path: String,
    pub target_face_path: Option<String>,
    pub preview: bool,
    pub encoder: Option<VideoEncoder>,
    #[serde(default = "default_tracking_strength")]
    pub tracking_strength: f64,
    #[serde(default = "default_identity_threshold")]
    pub identity_threshold: f64,
    #[serde(default = "default_stability")]
    pub stability: f64,
}

fn default_tracking_strength() -> f64 {
    0.72
}

fn default_identity_threshold() -> f64 {
    0.58
}

fn default_stability() -> f64 {
    0.68
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub output_path: String,
    pub preset: ExportPreset,
    pub preview: bool,
    pub encoder: Option<VideoEncoder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RenderState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderStatus {
    pub job_id: String,
    pub state: RenderState,
    pub progress: f64,
    pub message: String,
    pub output_path: Option<String>,
}

#[derive(Default)]
struct AppState {
    project: Mutex<ProjectState>,
    renders: Mutex<HashMap<String, Arc<Mutex<RenderStatus>>>>,
}

#[tauri::command]
fn pick_video_file() -> Result<Option<String>, String> {
    let picked = FileDialog::new()
        .add_filter("Video", &["mp4", "mov", "mkv", "avi", "webm"])
        .pick_file();

    Ok(picked.map(|p| p.display().to_string()))
}

#[tauri::command]
fn pick_image_file() -> Result<Option<String>, String> {
    let picked = FileDialog::new()
        .add_filter("Image", &["png", "jpg", "jpeg", "webp", "bmp"])
        .pick_file();

    Ok(picked.map(|p| p.display().to_string()))
}

#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    let picked = FileDialog::new().pick_folder();
    Ok(picked.map(|p| p.display().to_string()))
}

#[tauri::command]
fn open_video(path: String, state: State<AppState>) -> Result<VideoInfo, String> {
    let input = PathBuf::from(&path);
    if !input.exists() {
        return Err(format!("Input file does not exist: {path}"));
    }

    let ffprobe = ffprobe_binary().map_err(|e| format!("{e:#}"))?;
    let info = probe_video(&ffprobe, &input).map_err(|e| format!("{e:#}"))?;

    let mut project = state.project.lock().map_err(|_| "State lock poisoned")?;
    project.input_video = Some(path.clone());
    project.video_info = Some(info.clone());
    project.beat_map = None;

    Ok(info)
}

#[tauri::command]
fn analyze_beats(path: String, sensitivity: f64, state: State<AppState>) -> Result<BeatMap, String> {
    let sensitivity = sensitivity.clamp(0.0, 1.0);
    let ffmpeg = ffmpeg_binary().map_err(|e| format!("{e:#}"))?;
    let raw = analyze_beats_from_video(&ffmpeg, Path::new(&path), sensitivity).map_err(|e| format!("{e:#}"))?;
    let normalized = normalize_beat_map(&raw);

    let beat_map = BeatMap { points: normalized };
    let mut project = state.project.lock().map_err(|_| "State lock poisoned")?;
    project.beat_map = Some(beat_map.clone());

    Ok(beat_map)
}

#[tauri::command]
fn set_effects(config: EffectsConfig, state: State<AppState>) -> Result<ProjectState, String> {
    config.validate()?;

    let mut project = state.project.lock().map_err(|_| "State lock poisoned")?;
    project.effects = config;
    Ok(project.clone())
}

#[tauri::command]
fn get_project(state: State<AppState>) -> Result<ProjectState, String> {
    let project = state.project.lock().map_err(|_| "State lock poisoned")?;
    Ok(project.clone())
}

fn preset_frame_rate(preset: &ExportPreset) -> u32 {
    match preset {
        ExportPreset::Shorts1080x1920 => 30,
        ExportPreset::Reels1080x1920 => 30,
        ExportPreset::Vertical4K2160x3840 => 30,
    }
}

fn preset_dimensions(preset: &ExportPreset) -> (u32, u32) {
    match preset {
        ExportPreset::Shorts1080x1920 => (1080, 1920),
        ExportPreset::Reels1080x1920 => (1080, 1920),
        ExportPreset::Vertical4K2160x3840 => (2160, 3840),
    }
}

#[tauri::command]
fn render(request: RenderRequest, state: State<AppState>) -> Result<String, String> {
    let project = state.project.lock().map_err(|_| "State lock poisoned")?.clone();
    let input_video = project
        .input_video
        .clone()
        .ok_or_else(|| "No input video loaded".to_string())?;

    let info = project
        .video_info
        .clone()
        .ok_or_else(|| "Video metadata missing; re-open the input video".to_string())?;

    project.effects.validate()?;

    let output_path = request.output_path.trim().to_string();
    if output_path.is_empty() {
        return Err("Output path is empty".to_string());
    }
    if input_video.eq_ignore_ascii_case(&output_path) {
        return Err("Output path must be different from input video path".to_string());
    }

    let ffmpeg = ffmpeg_binary().map_err(|e| format!("{e:#}"))?;
    let ffmpeg_ver = tool_version_line(&ffmpeg).unwrap_or_else(|_| "unknown".to_string());
    let available_hw = detect_hardware_encoders(&ffmpeg).map_err(|e| format!("{e:#}"))?;
    let requested_encoder = request.encoder.clone().unwrap_or(VideoEncoder::Auto);
    let chosen_encoder = resolve_encoder(requested_encoder.clone(), &available_hw)?;
    let frame_rate = if request.preview { 24 } else { preset_frame_rate(&request.preset) };
    let (out_width, out_height) = if request.preview {
        (540, 960)
    } else {
        preset_dimensions(&request.preset)
    };

    let beat_points = project
        .beat_map
        .as_ref()
        .map(|m| m.points.len())
        .unwrap_or(0);

    let bounce_expr = match &project.beat_map {
        Some(map) => decay_envelope(&map.points, project.effects.bounce_strength, 0.20),
        None => "0".to_string(),
    };
    let beat_zoom_expr = match project.effects.zoom_mode {
        ZoomMode::ZoomInOutBeat => project
            .beat_map
            .as_ref()
            .map(|map| alternating_zoom_envelope(&map.points, project.effects.zoom_strength, 0.24)),
        ZoomMode::ZoomInOutLoop => Some(dynamic_loop_zoom_envelope(
            project.beat_map.as_ref().map(|m| m.points.as_slice()),
            project.effects.zoom_strength,
        )),
        _ => None,
    };

    let filtergraph = build_filtergraph(
        &project.effects.zoom_mode,
        project.effects.zoom_strength,
        beat_zoom_expr.as_deref(),
        project.effects.motion_blur_strength,
        &bounce_expr,
        out_width,
        out_height,
    );

    let job_id = Uuid::new_v4().to_string();
    let status = Arc::new(Mutex::new(RenderStatus {
        job_id: job_id.clone(),
        state: RenderState::Queued,
        progress: 0.0,
        message: "Queued".to_string(),
        output_path: None,
    }));

    {
        let mut renders = state.renders.lock().map_err(|_| "State lock poisoned")?;
        renders.insert(job_id.clone(), status.clone());
    }

    let effects_for_log = project.effects.clone();
    let preset_for_log = request.preset.clone();

    std::thread::spawn(move || {
        let started_at = SystemTime::now();
        let started_timer = Instant::now();

        {
            if let Ok(mut s) = status.lock() {
                s.state = RenderState::Running;
                s.message = "Rendering started".to_string();
            }
        }

        let render_result = render_with_ffmpeg(
            &ffmpeg,
            Path::new(&input_video),
            Path::new(&output_path),
            &filtergraph,
            frame_rate,
            info.duration_sec,
            chosen_encoder.clone(),
            |progress: f64, message: String| {
                if let Ok(mut s) = status.lock() {
                    s.progress = progress.clamp(0.0, 1.0);
                    s.message = message;
                }
            },
        );

        let elapsed_sec = started_timer.elapsed().as_secs_f64();
        let finished_at = SystemTime::now();

        let mut final_message = String::new();
        let mut final_ok = false;

        if let Ok(mut s) = status.lock() {
            match &render_result {
                Ok(_) => {
                    s.state = RenderState::Completed;
                    s.progress = 1.0;
                    s.message = "Render completed".to_string();
                    s.output_path = Some(output_path.clone());
                    final_message = s.message.clone();
                    final_ok = true;
                }
                Err(err) => {
                    s.state = RenderState::Failed;
                    s.message = format!("Render failed: {err:#}");
                    final_message = s.message.clone();
                }
            }
        }

        let _ = write_export_log(
            &output_path,
            LogSnapshot {
                success: final_ok,
                status_message: final_message,
                started_at,
                finished_at,
                elapsed_sec,
                input_video: input_video.clone(),
                output_video: output_path.clone(),
                ffmpeg_path: ffmpeg.display().to_string(),
                ffmpeg_version: ffmpeg_ver.clone(),
                requested_encoder,
                chosen_encoder,
                available_hw,
                preset: preset_for_log,
                width: out_width,
                height: out_height,
                frame_rate,
                effects: effects_for_log,
                beat_points,
                filter_len: filtergraph.len(),
                render_report: render_result.ok(),
            },
        );
    });

    Ok(job_id)
}

#[tauri::command]
fn render_reframe(request: ReframeRenderRequest, state: State<AppState>) -> Result<String, String> {
    let input_video = request.input_path.trim().to_string();
    let output_path = request.output_path.trim().to_string();

    if input_video.is_empty() {
        return Err("Input path is empty".to_string());
    }
    if output_path.is_empty() {
        return Err("Output path is empty".to_string());
    }
    if input_video.eq_ignore_ascii_case(&output_path) {
        return Err("Output path must be different from input video path".to_string());
    }

    let input_path = PathBuf::from(&input_video);
    if !input_path.exists() {
        return Err(format!("Input file does not exist: {input_video}"));
    }

    let ffmpeg = ffmpeg_binary().map_err(|e| format!("{e:#}"))?;
    let ffprobe = ffprobe_binary().map_err(|e| format!("{e:#}"))?;
    let info = probe_video(&ffprobe, &input_path).map_err(|e| format!("{e:#}"))?;

    let ffmpeg_ver = tool_version_line(&ffmpeg).unwrap_or_else(|_| "unknown".to_string());
    let available_hw = detect_hardware_encoders(&ffmpeg).map_err(|e| format!("{e:#}"))?;
    let requested_encoder = request.encoder.clone().unwrap_or(VideoEncoder::Auto);
    let chosen_encoder = resolve_encoder(requested_encoder.clone(), &available_hw)?;

    let frame_rate = if request.preview { 24 } else { 30 };
    let (out_width, out_height) = if request.preview { (540, 960) } else { (1080, 1920) };

    let mut track_points = Vec::new();
    let tracking_strength = request.tracking_strength.clamp(0.0, 1.0);
    let identity_threshold = request.identity_threshold.clamp(0.0, 1.0);
    let stability = request.stability.clamp(0.0, 1.0);
    if let Some(face_path_raw) = request.target_face_path.as_ref() {
        let face_path_trim = face_path_raw.trim();
        if !face_path_trim.is_empty() {
            let face_path = PathBuf::from(face_path_trim);
            if face_path.exists() {
                track_points = estimate_face_track_points(
                    &ffmpeg,
                    &input_path,
                    &face_path,
                    info.width,
                    info.height,
                    tracking_strength,
                    identity_threshold,
                    stability,
                )
                .map_err(|e| format!("face tracking analysis failed: {e:#}"))?;
            }
        }
    }

    let filtergraph = build_reframe_filtergraph(out_width, out_height, &track_points);

    let job_id = Uuid::new_v4().to_string();
    let status = Arc::new(Mutex::new(RenderStatus {
        job_id: job_id.clone(),
        state: RenderState::Queued,
        progress: 0.0,
        message: if track_points.is_empty() {
            "Queued (center reframe)".to_string()
        } else {
            format!("Queued (face track points: {}, strength={:.2}, id={:.2}, stab={:.2})", track_points.len(), tracking_strength, identity_threshold, stability)
        },
        output_path: None,
    }));

    {
        let mut renders = state.renders.lock().map_err(|_| "State lock poisoned")?;
        renders.insert(job_id.clone(), status.clone());
    }

    std::thread::spawn(move || {
        let started_at = SystemTime::now();
        let started_timer = Instant::now();

        {
            if let Ok(mut s) = status.lock() {
                s.state = RenderState::Running;
                s.message = if track_points.is_empty() {
                    "Rendering started (center reframe)".to_string()
                } else {
                    format!("Rendering started (face tracking, points={}, strength={:.2}, id={:.2}, stab={:.2})", track_points.len(), tracking_strength, identity_threshold, stability)
                };
            }
        }

        let render_result = render_with_ffmpeg(
            &ffmpeg,
            Path::new(&input_video),
            Path::new(&output_path),
            &filtergraph,
            frame_rate,
            info.duration_sec,
            chosen_encoder.clone(),
            |progress: f64, message: String| {
                if let Ok(mut s) = status.lock() {
                    s.progress = progress.clamp(0.0, 1.0);
                    s.message = message;
                }
            },
        );

        let elapsed_sec = started_timer.elapsed().as_secs_f64();
        let finished_at = SystemTime::now();

        let mut final_message = String::new();
        let mut final_ok = false;

        if let Ok(mut s) = status.lock() {
            match &render_result {
                Ok(_) => {
                    s.state = RenderState::Completed;
                    s.progress = 1.0;
                    s.message = if track_points.is_empty() {
                        "Reframe completed (center)".to_string()
                    } else {
                        format!("Reframe completed (face tracked, points={}, strength={:.2}, id={:.2}, stab={:.2})", track_points.len(), tracking_strength, identity_threshold, stability)
                    };
                    s.output_path = Some(output_path.clone());
                    final_message = s.message.clone();
                    final_ok = true;
                }
                Err(err) => {
                    s.state = RenderState::Failed;
                    s.message = format!("Render failed: {err:#}");
                    final_message = s.message.clone();
                }
            }
        }

        let _ = write_export_log(
            &output_path,
            LogSnapshot {
                success: final_ok,
                status_message: final_message,
                started_at,
                finished_at,
                elapsed_sec,
                input_video: input_video.clone(),
                output_video: output_path.clone(),
                ffmpeg_path: ffmpeg.display().to_string(),
                ffmpeg_version: ffmpeg_ver.clone(),
                requested_encoder,
                chosen_encoder,
                available_hw,
                preset: ExportPreset::Shorts1080x1920,
                width: out_width,
                height: out_height,
                frame_rate,
                effects: EffectsConfig {
                    zoom_mode: ZoomMode::None,
                    zoom_strength: 0.0,
                    bounce_strength: 0.0,
                    beat_sensitivity: 0.5,
                    motion_blur_strength: 0.0,
                },
                beat_points: track_points.len(),
                filter_len: filtergraph.len(),
                render_report: render_result.ok(),
            },
        );
    });

    Ok(job_id)
}
#[tauri::command]
fn get_render_status(job_id: String, state: State<AppState>) -> Result<RenderStatus, String> {
    let renders = state.renders.lock().map_err(|_| "State lock poisoned")?;
    let status = renders
        .get(&job_id)
        .ok_or_else(|| format!("Unknown render job: {job_id}"))?;

    let snapshot = status.lock().map_err(|_| "Status lock poisoned")?.clone();
    Ok(snapshot)
}

#[tauri::command]
fn verify_runtime_tools() -> Result<Vec<String>, String> {
    let ffmpeg = ffmpeg_binary().map_err(|e| format!("{e:#}"))?;
    let ffprobe = ffprobe_binary().map_err(|e| format!("{e:#}"))?;

    Ok(vec![
        format!("ffmpeg={}", ffmpeg.display()),
        format!("ffmpeg_version={}", tool_version_line(&ffmpeg).map_err(|e| format!("{e:#}"))?),
        format!("ffprobe={}", ffprobe.display()),
        format!("ffprobe_version={}", tool_version_line(&ffprobe).map_err(|e| format!("{e:#}"))?),
    ])
}


#[tauri::command]
fn verify_onnx_runtime_assets() -> Result<Vec<String>, String> {
    Ok(verify_onnx_assets())
}

#[tauri::command]
fn get_encoder_options() -> Result<Vec<String>, String> {
    let ffmpeg = ffmpeg_binary().map_err(|e| format!("{e:#}"))?;
    let available_hw = detect_hardware_encoders(&ffmpeg).map_err(|e| format!("{e:#}"))?;

    let mut out = vec!["auto".to_string(), "cpu".to_string()];
    out.extend(available_hw);
    Ok(out)
}

fn resolve_encoder(requested: VideoEncoder, available_hw: &[String]) -> Result<VideoEncoder, String> {
    let has_nvidia = available_hw.iter().any(|x| x == "nvidia");
    let has_intel = available_hw.iter().any(|x| x == "intel");
    let has_amd = available_hw.iter().any(|x| x == "amd");

    let chosen = match requested {
        VideoEncoder::Auto => {
            if has_nvidia {
                VideoEncoder::Nvidia
            } else if has_intel {
                VideoEncoder::Intel
            } else if has_amd {
                VideoEncoder::Amd
            } else {
                VideoEncoder::Cpu
            }
        }
        VideoEncoder::Nvidia if !has_nvidia => {
            return Err("NVIDIA encoder is not available on this machine".to_string())
        }
        VideoEncoder::Intel if !has_intel => {
            return Err("Intel encoder is not available on this machine".to_string())
        }
        VideoEncoder::Amd if !has_amd => {
            return Err("AMD encoder is not available on this machine".to_string())
        }
        x => x,
    };

    Ok(chosen)
}

#[derive(Clone)]
struct LogSnapshot {
    success: bool,
    status_message: String,
    started_at: SystemTime,
    finished_at: SystemTime,
    elapsed_sec: f64,
    input_video: String,
    output_video: String,
    ffmpeg_path: String,
    ffmpeg_version: String,
    requested_encoder: VideoEncoder,
    chosen_encoder: VideoEncoder,
    available_hw: Vec<String>,
    preset: ExportPreset,
    width: u32,
    height: u32,
    frame_rate: u32,
    effects: EffectsConfig,
    beat_points: usize,
    filter_len: usize,
    render_report: Option<media::RenderExecutionReport>,
}

fn write_export_log(output_path: &str, snap: LogSnapshot) -> Result<(), String> {
    let out_path = PathBuf::from(output_path);
    let log_path = out_path.with_extension("json");

    let started_epoch = snap
        .started_at
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let finished_epoch = snap
        .finished_at
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let command_line = snap
        .render_report
        .as_ref()
        .map(|r| r.command_line.clone())
        .unwrap_or_else(|| "(command unavailable due to startup failure)".to_string());
    let ffmpeg_exit = snap
        .render_report
        .as_ref()
        .map(|r| r.exit_status.clone())
        .unwrap_or_else(|| "(unknown)".to_string());
    let stderr_text = snap
        .render_report
        .as_ref()
        .map(|r| r.stderr_text.clone())
        .unwrap_or_default();

    let payload = serde_json::json!({
        "tool": "naVShorts",
        "status": if snap.success { "completed" } else { "failed" },
        "message": snap.status_message,
        "started_unix": started_epoch,
        "finished_unix": finished_epoch,
        "elapsed_sec": snap.elapsed_sec,
        "input": snap.input_video,
        "output": snap.output_video,
        "log_file": log_path.display().to_string(),
        "ffmpeg": {
            "path": snap.ffmpeg_path,
            "version": snap.ffmpeg_version,
            "exit_status": ffmpeg_exit,
            "command": command_line,
            "filter_script": snap.render_report.as_ref().and_then(|r| r.filter_script_path.clone()),
            "stderr": stderr_text
        },
        "encoder": {
            "requested": format!("{:?}", snap.requested_encoder),
            "chosen": format!("{:?}", snap.chosen_encoder),
            "available_hw": snap.available_hw
        },
        "preset": {
            "name": format!("{:?}", snap.preset),
            "width": snap.width,
            "height": snap.height,
            "frame_rate": snap.frame_rate
        },
        "effects": {
            "zoom_mode": format!("{:?}", snap.effects.zoom_mode),
            "zoom_strength": snap.effects.zoom_strength,
            "bounce_strength": snap.effects.bounce_strength,
            "beat_sensitivity": snap.effects.beat_sensitivity,
            "motion_blur_strength": snap.effects.motion_blur_strength,
            "beat_points": snap.beat_points,
            "filter_len": snap.filter_len
        }
    });

    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("failed to serialize export log json: {e}"))?;

    fs::write(&log_path, text).map_err(|e| format!("failed to write export log json: {e}"))
}
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            pick_video_file,
            pick_image_file,
            pick_folder,
            open_video,
            analyze_beats,
            set_effects,
            get_project,
            render,
            render_reframe,
            get_render_status,
            verify_runtime_tools,
            verify_onnx_runtime_assets,
            get_encoder_options
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effects_defaults_are_valid() {
        assert!(EffectsConfig::default().validate().is_ok());
    }

    #[test]
    fn effects_validation_rejects_out_of_range() {
        let invalid = EffectsConfig {
            zoom_mode: ZoomMode::ZoomIn,
            zoom_strength: 1.2,
            bounce_strength: 0.2,
            beat_sensitivity: 0.5,
            motion_blur_strength: 0.0,
        };
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn zoom_in_out_beat_mode_serializes() {
        let payload = EffectsConfig {
            zoom_mode: ZoomMode::ZoomInOutBeat,
            zoom_strength: 0.4,
            bounce_strength: 0.2,
            beat_sensitivity: 0.5,
            motion_blur_strength: 0.0,
        };
        let s = serde_json::to_string(&payload).expect("serialize");
        assert!(s.contains("zoomInOutBeat"));
    }

    #[test]
    fn zoom_in_out_loop_mode_serializes() {
        let payload = EffectsConfig {
            zoom_mode: ZoomMode::ZoomInOutLoop,
            zoom_strength: 0.5,
            bounce_strength: 0.2,
            beat_sensitivity: 0.5,
            motion_blur_strength: 0.0,
        };
        let s = serde_json::to_string(&payload).expect("serialize");
        assert!(s.contains("zoomInOutLoop"));
    }

    #[test]
    fn zoom_sine_smooth_mode_serializes() {
        let payload = EffectsConfig {
            zoom_mode: ZoomMode::ZoomSineSmooth,
            zoom_strength: 0.5,
            bounce_strength: 0.2,
            beat_sensitivity: 0.5,
            motion_blur_strength: 0.0,
        };
        let s = serde_json::to_string(&payload).expect("serialize");
        assert!(s.contains("zoomSineSmooth"));
    }
}


































