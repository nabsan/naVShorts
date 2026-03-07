mod core;
mod media;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use core::{analyze_beats_from_video, decay_envelope, normalize_beat_map, BeatPoint};
use media::{
    build_filtergraph, ffmpeg_binary, ffprobe_binary, probe_video, render_with_ffmpeg,
    tool_version_line,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectsConfig {
    pub zoom_mode: ZoomMode,
    pub zoom_strength: f64,
    pub bounce_strength: f64,
    pub beat_sensitivity: f64,
}

impl Default for EffectsConfig {
    fn default() -> Self {
        Self {
            zoom_mode: ZoomMode::ZoomIn,
            zoom_strength: 0.18,
            bounce_strength: 0.16,
            beat_sensitivity: 0.55,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub output_path: String,
    pub preset: ExportPreset,
    pub preview: bool,
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
    let frame_rate = if request.preview { 24 } else { preset_frame_rate(&request.preset) };

    let bounce_expr = match &project.beat_map {
        Some(map) => decay_envelope(&map.points, project.effects.bounce_strength, 0.20),
        None => "0".to_string(),
    };

    let filtergraph = build_filtergraph(
        &project.effects.zoom_mode,
        project.effects.zoom_strength,
        &bounce_expr,
        request.preview,
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

    std::thread::spawn(move || {
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
            |progress, message| {
                if let Ok(mut s) = status.lock() {
                    s.progress = progress.clamp(0.0, 1.0);
                    s.message = message;
                }
            },
        );

        if let Ok(mut s) = status.lock() {
            match render_result {
                Ok(_) => {
                    s.state = RenderState::Completed;
                    s.progress = 1.0;
                    s.message = "Render completed".to_string();
                    s.output_path = Some(output_path);
                }
                Err(err) => {
                    s.state = RenderState::Failed;
                    s.message = format!("Render failed: {err:#}");
                }
            }
        }
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

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            pick_video_file,
            open_video,
            analyze_beats,
            set_effects,
            get_project,
            render,
            get_render_status,
            verify_runtime_tools
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
        };
        assert!(invalid.validate().is_err());
    }
}
