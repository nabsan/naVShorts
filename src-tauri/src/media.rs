use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::{VideoEncoder, VideoInfo, ZoomMode};

#[derive(Debug, Clone)]
pub struct ReframeTrackPoint {
    pub time_sec: f64,
    pub center_x_ratio: f64,
}

#[derive(Debug, Clone)]
pub struct RenderExecutionReport {
    pub command_line: String,
    pub exit_status: String,
    pub stderr_text: String,
    pub filter_script_path: Option<String>,
}

pub fn ffmpeg_binary() -> Result<PathBuf> {
    resolve_binary("ffmpeg")
}

pub fn ffprobe_binary() -> Result<PathBuf> {
    resolve_binary("ffprobe")
}

pub fn detect_hardware_encoders(ffmpeg_path: &Path) -> Result<Vec<String>> {
    let out = Command::new(ffmpeg_path)
        .arg("-hide_banner")
        .arg("-encoders")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .with_context(|| format!("failed to query encoders from {}", ffmpeg_path.display()))?;

    if !out.status.success() {
        return Err(anyhow!(
            "ffmpeg -encoders failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
    let mut list = Vec::new();

    if text.contains("h264_nvenc") {
        list.push("nvidia".to_string());
    }
    if text.contains("h264_qsv") {
        list.push("intel".to_string());
    }
    if text.contains("h264_amf") {
        list.push("amd".to_string());
    }

    Ok(list)
}



pub fn verify_onnx_assets() -> Vec<String> {
    let mut out = Vec::new();

    let runtime = find_onnx_runtime_dll();
    match runtime {
        Some(p) => out.push(format!("onnxruntime_dll=OK:{}", p.display())),
        None => out.push("onnxruntime_dll=MISSING".to_string()),
    }

    let model_dir = find_model_dir();
    match &model_dir {
        Some(d) => out.push(format!("onnx_model_dir=OK:{}", d.display())),
        None => out.push("onnx_model_dir=MISSING".to_string()),
    }

    if let Some(s) = find_identity_track_script() {
        out.push(format!("identity_track_script=OK:{}", s.display()));
    } else {
        out.push("identity_track_script=MISSING".to_string());
    }

    out.push(verify_python_identity_stack());

    let detector_name = "face_detector.onnx";
    let arcface_name = "arcface.onnx";

    if let Some(d) = model_dir {
        let detector = d.join(detector_name);
        let arcface = d.join(arcface_name);

        out.push(format!(
            "onnx_face_detector={}",
            if detector.exists() {
                format!("OK:{}", detector.display())
            } else {
                format!("MISSING:{}", detector.display())
            }
        ));

        out.push(format!(
            "onnx_arcface={}",
            if arcface.exists() {
                format!("OK:{}", arcface.display())
            } else {
                format!("MISSING:{}", arcface.display())
            }
        ));
    }

    out
}

fn find_onnx_runtime_dll() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(v) = env::var("ONNXRUNTIME_DLL_PATH") {
        if !v.trim().is_empty() {
            candidates.push(PathBuf::from(v));
        }
    }

    candidates.push(PathBuf::from(r"C:\Windows\System32\onnxruntime.dll"));
    candidates.push(PathBuf::from(r"C:\Windows\SysWOW64\onnxruntime.dll"));

    for p in candidates {
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn find_model_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = env::current_exe() {
        if let Some(base) = exe.parent() {
            candidates.push(base.join("resources").join("models"));
        }
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join("resources").join("models"));
        candidates.push(cwd.join("src-tauri").join("resources").join("models"));
    }

    for p in candidates {
        if p.exists() {
            return Some(p);
        }
    }

    None
}

#[derive(Debug, Deserialize)]
struct IdentityTrackPointRaw {
    time_sec: f64,
    center_x_ratio: f64,
    similarity: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct IdentityTrackOutput {
    points: Vec<IdentityTrackPointRaw>,
    count: Option<usize>,
}


fn verify_python_identity_stack() -> String {
    let script = "import importlib.util;mods=['onnxruntime','cv2','numpy'];print(','.join([m+':'+('OK' if importlib.util.find_spec(m) else 'MISSING') for m in mods]))";
    let out = Command::new("python")
        .arg("-c")
        .arg(script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { "python_identity_stack=UNKNOWN".to_string() } else { format!("python_identity_stack={s}") }
        }
        Ok(o) => format!("python_identity_stack=ERR:{}", String::from_utf8_lossy(&o.stderr).trim()),
        Err(e) => format!("python_identity_stack=ERR:{e}"),
    }
}
fn find_identity_track_script() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join("src-tauri").join("scripts").join("identity_track.py"));
        candidates.push(cwd.join("scripts").join("identity_track.py"));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(base) = exe.parent() {
            candidates.push(base.join("resources").join("scripts").join("identity_track.py"));
        }
    }

    candidates.into_iter().find(|p| p.exists())
}

fn track_identity_with_onnx_python(
    input_video: &Path,
    target_face_ref: &Path,
    sample_width: u32,
    sample_fps: f64,
    sim_threshold: f64,
) -> Result<Vec<ReframeTrackPoint>> {
    let script = find_identity_track_script()
        .ok_or_else(|| anyhow!("identity_track.py not found"))?;

    let model_dir = find_model_dir().ok_or_else(|| anyhow!("onnx model dir not found"))?;
    let detector = model_dir.join("face_detector.onnx");
    let arcface = model_dir.join("arcface.onnx");

    if !detector.exists() || !arcface.exists() {
        return Err(anyhow!(
            "onnx models missing (detector={}, arcface={})",
            detector.display(),
            arcface.display()
        ));
    }

    let mut command = Command::new("python");
    command
        .arg(script)
        .arg("--video")
        .arg(input_video)
        .arg("--detector")
        .arg(detector)
        .arg("--arcface")
        .arg(arcface)
        .arg("--sample-fps")
        .arg(format!("{sample_fps:.4}"))
        .arg("--sample-width")
        .arg(sample_width.to_string())
        .arg("--sim-threshold")
        .arg(format!("{sim_threshold:.4}"));

    if target_face_ref.is_dir() {
        command.arg("--target-dir").arg(target_face_ref);
    } else {
        command.arg("--target").arg(target_face_ref);
    }

    let output = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .context("failed to start identity_track.py")?;

    if !output.status.success() {
        return Err(anyhow!(
            "identity_track.py failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let parsed: IdentityTrackOutput = serde_json::from_slice(&output.stdout)
        .context("identity_track.py returned invalid json")?;

    let mut out = Vec::with_capacity(parsed.points.len());
    for p in parsed.points {
        out.push(ReframeTrackPoint {
            time_sec: p.time_sec,
            center_x_ratio: p.center_x_ratio.clamp(0.1, 0.9),
        });
    }
    Ok(out)
}

fn is_face_image_file(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let e = ext.to_ascii_lowercase();
            matches!(e.as_str(), "jpg" | "jpeg" | "png" | "webp" | "bmp")
        }
        None => false,
    }
}

fn collect_target_face_images(target_face_ref: &Path) -> Vec<PathBuf> {
    if target_face_ref.is_file() {
        return vec![target_face_ref.to_path_buf()];
    }
    if !target_face_ref.is_dir() {
        return Vec::new();
    }

    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(target_face_ref) {
        for ent in rd.flatten() {
            let p = ent.path();
            if p.is_file() && is_face_image_file(&p) {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

pub fn tool_version_line(binary: &Path) -> Result<String> {
    let out = Command::new(binary)
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .with_context(|| format!("failed to execute {} -version", binary.display()))?;

    if !out.status.success() {
        return Err(anyhow!(
            "{} -version exited with non-zero status: {}",
            binary.display(),
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let first = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();

    if first.is_empty() {
        return Ok(format!("{}: version output was empty", binary.display()));
    }

    Ok(first)
}

fn resolve_binary(name: &str) -> Result<PathBuf> {
    let exe_name = format!("{name}.exe");
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = env::current_exe() {
        if let Some(base) = exe.parent() {
            candidates.push(base.join("resources").join("bin").join(&exe_name));
        }
    }

    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            candidates.push(dir.join(&exe_name));
        }
    }

    candidates.push(PathBuf::from(&exe_name));

    let mut seen = HashSet::new();
    for candidate in candidates {
        let key = candidate.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }

        let should_try = candidate == PathBuf::from(&exe_name) || candidate.exists();
        if !should_try {
            continue;
        }

        let status = Command::new(&candidate)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if status.map(|s| s.success()).unwrap_or(false) {
            return Ok(candidate);
        }
    }

    Err(anyhow!(
        "Could not find a runnable {name}.exe. Put it in src-tauri/resources/bin or add it to PATH."
    ))
}

#[derive(Debug, Deserialize)]
struct ProbeResult {
    streams: Vec<ProbeStream>,
    format: ProbeFormat,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
}

pub fn probe_video(ffprobe_path: &Path, input: &Path) -> Result<VideoInfo> {
    let output = Command::new(ffprobe_path)
        .arg("-v")
        .arg("error")
        .arg("-print_format")
        .arg("json")
        .arg("-show_streams")
        .arg("-show_format")
        .arg(input)
        .output()
        .context("failed to run ffprobe")?;

    if !output.status.success() {
        return Err(anyhow!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let parsed: ProbeResult = serde_json::from_slice(&output.stdout).context("invalid ffprobe json")?;

    let video_stream = parsed
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))
        .ok_or_else(|| anyhow!("input has no video stream"))?;

    let has_audio = parsed
        .streams
        .iter()
        .any(|s| s.codec_type.as_deref() == Some("audio"));

    let fps = video_stream
        .r_frame_rate
        .as_deref()
        .and_then(parse_rational)
        .unwrap_or(30.0);

    let duration_sec = parsed
        .format
        .duration
        .as_deref()
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    Ok(VideoInfo {
        path: input.display().to_string(),
        duration_sec,
        width: video_stream.width.unwrap_or(0),
        height: video_stream.height.unwrap_or(0),
        fps,
        has_audio,
    })
}

fn parse_rational(raw: &str) -> Option<f64> {
    if let Some((n, d)) = raw.split_once('/') {
        let n = n.parse::<f64>().ok()?;
        let d = d.parse::<f64>().ok()?;
        if d.abs() < f64::EPSILON {
            return None;
        }
        return Some(n / d);
    }

    raw.parse::<f64>().ok()
}

pub fn build_filtergraph(
    zoom_mode: &ZoomMode,
    zoom_strength: f64,
    beat_zoom_expr: Option<&str>,
    motion_blur_strength: f64,
    bounce_expr: &str,
    output_width: u32,
    output_height: u32,
) -> String {
    let zoom_strength = zoom_strength.clamp(0.0, 1.0);

    let zoom_expr = match zoom_mode {
        ZoomMode::None => "1.0".to_string(),
        ZoomMode::ZoomIn => format!("1+{:.5}*min(t/8,1)", zoom_strength * 0.22),
        ZoomMode::ZoomOut => format!("1+{:.5}*max(0,1-t/8)", zoom_strength * 0.22),
        ZoomMode::ZoomInOutBeat => beat_zoom_expr.unwrap_or("1.0").to_string(),
        ZoomMode::ZoomInOutLoop => match beat_zoom_expr {
            Some(expr) => expr.to_string(),
            None => {
                let amp = zoom_strength * 0.20;
                let period = 2.20;
                format!("1+{amp:.5}*(0.5+0.5*sin(2*PI*t/{period:.2}))")
            }
        },
        ZoomMode::ZoomSineSmooth => {
            let amp = zoom_strength * 0.25;
            format!("1+{amp:.5}*(0.5+0.5*sin(t*2))")
        }
    };

    let bounce = if bounce_expr.trim().is_empty() { "0" } else { bounce_expr };

    let post_fx = match zoom_mode {
        ZoomMode::ZoomSineSmooth => {
            let mb = motion_blur_strength.clamp(0.0, 1.0);
            if mb <= 0.0 {
                "".to_string()
            } else {
                let frames = if mb < 0.34 { 2 } else if mb < 0.67 { 3 } else { 4 };
                let weights = match frames {
                    2 => "1 1",
                    3 => "1 2 1",
                    _ => "1 2 2 1",
                };
                format!(",tmix=frames={}:weights='{}'", frames, weights)
            }
        }
        _ => "".to_string(),
    };

    let size = format!("{}:{}", output_width, output_height);

    format!(
        "scale='if(gt(a,9/16),-2,1080)':'if(gt(a,9/16),1920,-2)',crop=1080:1920,scale='ceil(1080*({zoom}+{bounce})/2)*2':'ceil(1920*({zoom}+{bounce})/2)*2':eval=frame,crop=1080:1920,scale={size}:flags=lanczos{post}",
        zoom = zoom_expr,
        bounce = bounce,
        size = size,
        post = post_fx
    )
}

pub fn build_reframe_filtergraph(
    output_width: u32,
    output_height: u32,
    track_points: &[ReframeTrackPoint],
) -> String {
    let center_expr = build_center_x_expr(track_points);
    let size = format!("{}:{}", output_width, output_height);

    format!(
        "scale='if(gt(a,9/16),-2,1080)':'if(gt(a,9/16),1920,-2)',crop=1080:1920:x='min(max(iw*({center})-540,0),iw-1080)':y='max((ih-1920)/2,0)',scale={size}:flags=lanczos",
        center = center_expr,
        size = size
    )
}

pub fn estimate_face_track_points(
    ffmpeg_path: &Path,
    input_video: &Path,
    target_face_ref: &Path,
    source_width: u32,
    source_height: u32,
    tracking_strength: f64,
    identity_threshold: f64,
    stability: f64,
) -> Result<Vec<ReframeTrackPoint>> {
    let s = tracking_strength.clamp(0.0, 1.0);
    let id = identity_threshold.clamp(0.0, 1.0);
    let stab = stability.clamp(0.0, 1.0);
    let sample_width = ((320.0 + 192.0 * s).round() as u32).clamp(320, 512);
    let sample_fps = 2.0 + (4.0 * s);
    let max_points = (72.0 + 96.0 * s).round() as usize;
    // Higher stability => smoother trajectory (smaller alpha).
    let alpha = (0.62 - 0.52 * stab).clamp(0.08, 0.75);

    // Preferred path #1: ONNX identity tracking (face detector + ArcFace embedding).
    // identity_threshold slider maps to cosine threshold in practical range.
    let sim_threshold = (0.18 + 0.20 * id).clamp(0.18, 0.38);
    if let Ok(points) = track_identity_with_onnx_python(
        input_video,
        target_face_ref,
        sample_width,
        sample_fps,
        sim_threshold,
    ) {
        if points.len() >= 6 {
            return Ok(compress_track_points(&points, max_points, alpha, stab));
        }
    }

    // Preferred path #2: detector-based tracking (stronger than template matching on difficult clips).
    if let Ok(points) = detect_faces_track_points_ffmpeg(ffmpeg_path, input_video, sample_width, sample_fps) {
        if points.len() >= 8 {
            return Ok(compress_track_points(&points, max_points, alpha, stab));
        }
    }

    // Fallback path: template matching using the first face image.
    let template_input = collect_target_face_images(target_face_ref)
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("no target face image found (need jpg/png/webp/bmp)"))?;
    let template_size = ((source_width as f64 / 72.0).round() as u32).clamp(32, 64);
    let target = load_template_gray(ffmpeg_path, &template_input, template_size)?;
    let sample_height = scaled_even_height(source_width, source_height, sample_width);
    let video_raw = sample_video_gray(ffmpeg_path, input_video, sample_fps, sample_width)?;
    let frame_size = (sample_width * sample_height) as usize;
    if frame_size == 0 || video_raw.len() < frame_size {
        return Ok(Vec::new());
    }

    let total_frames = video_raw.len() / frame_size;
    let mut points = Vec::with_capacity(total_frames.min(240));
    let mut prev_x = (sample_width / 2) as f64;

    for i in 0..total_frames {
        let start = i * frame_size;
        let end = start + frame_size;
        let frame = &video_raw[start..end];

        if let Some((best_x, _best_y, confidence)) =
            template_match_best(frame, sample_width as usize, sample_height as usize, &target, template_size as usize)
        {
            let conf_threshold = 0.50 - (0.25 * s);
            if confidence >= conf_threshold {
                prev_x = best_x as f64 + (template_size as f64 / 2.0);
            }
        }

        let center_x_ratio = (prev_x / sample_width as f64).clamp(0.1, 0.9);
        points.push(ReframeTrackPoint {
            time_sec: i as f64 / sample_fps,
            center_x_ratio,
        });
    }

    Ok(compress_track_points(&points, max_points, alpha, stab))
}

pub fn render_with_ffmpeg<F: FnMut(f64, String)>(
    ffmpeg_path: &Path,
    input: &Path,
    output: &Path,
    filtergraph: &str,
    frame_rate: u32,
    duration_sec: f64,
    encoder: VideoEncoder,
    mut progress: F,
) -> Result<RenderExecutionReport> {
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create output directory: {}", parent.display()))?;
        }
    }

    let filter_script_path = write_filter_script(filtergraph)?;
    let persisted_filter_path = persist_filter_script_for_debug(output, filtergraph).ok();

    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-v".to_string(),
        "error".to_string(),
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-i".to_string(),
        input.display().to_string(),
        "-filter_script:v".to_string(),
        filter_script_path.display().to_string(),
        "-r".to_string(),
        frame_rate.to_string(),
    ];

    match encoder {
        VideoEncoder::Cpu | VideoEncoder::Auto => {
            args.extend([
                "-c:v".to_string(),
                "libx264".to_string(),
                "-preset".to_string(),
                "medium".to_string(),
                "-crf".to_string(),
                "22".to_string(),
            ]);
        }
        VideoEncoder::Nvidia => {
            args.extend([
                "-c:v".to_string(),
                "h264_nvenc".to_string(),
                "-preset".to_string(),
                "p5".to_string(),
                "-cq".to_string(),
                "23".to_string(),
                "-b:v".to_string(),
                "0".to_string(),
            ]);
        }
        VideoEncoder::Intel => {
            args.extend([
                "-c:v".to_string(),
                "h264_qsv".to_string(),
                "-global_quality".to_string(),
                "23".to_string(),
            ]);
        }
        VideoEncoder::Amd => {
            args.extend([
                "-c:v".to_string(),
                "h264_amf".to_string(),
                "-quality".to_string(),
                "quality".to_string(),
                "-rc".to_string(),
                "cqp".to_string(),
                "-qp_i".to_string(),
                "23".to_string(),
                "-qp_p".to_string(),
                "23".to_string(),
            ]);
        }
    }

    args.extend([
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        output.display().to_string(),
    ]);

    let command_line = format!(
        "\"{}\" {}",
        ffmpeg_path.display(),
        args.iter().map(|a| quote_arg(a)).collect::<Vec<_>>().join(" ")
    );

    let mut cmd = Command::new(ffmpeg_path);
    cmd.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        anyhow!(
            "failed to start ffmpeg render (command={}): {}",
            command_line,
            e
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("failed to capture ffmpeg progress stream"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("failed to capture ffmpeg stderr stream"))?;

    let stderr_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let mut r = stderr;
        let _ = r.read_to_end(&mut buf);
        buf
    });

    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            break;
        }

        let trimmed = line.trim();
        if let Some(val) = trimmed.strip_prefix("out_time_ms=") {
            if let Ok(ms) = val.parse::<f64>() {
                if duration_sec > 0.0 {
                    progress((ms / 1_000_000.0 / duration_sec).clamp(0.0, 0.999), "Rendering".to_string());
                }
            }
        } else if let Some(val) = trimmed.strip_prefix("out_time_us=") {
            if let Ok(us) = val.parse::<f64>() {
                if duration_sec > 0.0 {
                    progress((us / 1_000_000.0 / duration_sec).clamp(0.0, 0.999), "Rendering".to_string());
                }
            }
        }
    }

    let status = child.wait()?;
    let stderr_buf = stderr_handle.join().unwrap_or_default();
    let stderr_text = String::from_utf8_lossy(&stderr_buf).to_string();

    let _ = fs::remove_file(&filter_script_path);

    if !status.success() {
        return Err(anyhow!(
            "ffmpeg render failed (status={}, command={}): {}",
            status,
            command_line,
            stderr_text
        ));
    }

    progress(1.0, "Finishing".to_string());

    Ok(RenderExecutionReport {
        command_line,
        exit_status: status.to_string(),
        stderr_text,
        filter_script_path: persisted_filter_path.map(|p| p.display().to_string()),
    })
}

fn quote_arg(raw: &str) -> String {
    if raw.is_empty() {
        return "\"\"".to_string();
    }
    if raw.contains(' ') || raw.contains('"') {
        return format!("\"{}\"", raw.replace('"', "\\\""));
    }
    raw.to_string()
}

fn write_filter_script(filtergraph: &str) -> Result<PathBuf> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = env::temp_dir().join(format!("shorts_reels_filter_{now}.txt"));
    fs::write(&path, filtergraph)
        .with_context(|| format!("failed to write filter script: {}", path.display()))?;
    Ok(path)
}

fn persist_filter_script_for_debug(output: &Path, filtergraph: &str) -> Result<PathBuf> {
    let stem = output
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let parent = output.parent().unwrap_or_else(|| Path::new("."));
    let debug_path = parent.join(format!("{stem}.filter_script.txt"));

    fs::write(&debug_path, filtergraph)
        .with_context(|| format!("failed to persist debug filter script: {}", debug_path.display()))?;

    Ok(debug_path)
}

fn build_center_x_expr(points: &[ReframeTrackPoint]) -> String {
    if points.is_empty() {
        return "0.5".to_string();
    }
    if points.len() == 1 {
        return format!("{:.5}", points[0].center_x_ratio.clamp(0.0, 1.0));
    }

    let first_t = points[0].time_sec;
    let first_x = points[0].center_x_ratio.clamp(0.0, 1.0);
    let last_t = points[points.len() - 1].time_sec;
    let last_x = points[points.len() - 1].center_x_ratio.clamp(0.0, 1.0);

    let mut seg_terms = Vec::with_capacity(points.len().saturating_sub(1));
    for pair in points.windows(2) {
        let a = &pair[0];
        let b = &pair[1];
        let dt = (b.time_sec - a.time_sec).max(0.0001);
        seg_terms.push(format!(
            "(between(t,{a_t:.5},{b_t:.5})*({a_val:.5}+({b_val:.5}-{a_val:.5})*((t-{a_t:.5})/{dt:.5})))",
            a_t = a.time_sec,
            b_t = b.time_sec,
            a_val = a.center_x_ratio.clamp(0.0, 1.0),
            b_val = b.center_x_ratio.clamp(0.0, 1.0),
            dt = dt
        ));
    }

    let mid_expr = if seg_terms.is_empty() {
        format!("{first_x:.5}")
    } else {
        seg_terms.join("+")
    };

    format!(
        "if(lt(t,{first_t:.5}),{first_x:.5},if(gte(t,{last_t:.5}),{last_x:.5},({mid})))",
        first_t = first_t,
        first_x = first_x,
        last_t = last_t,
        last_x = last_x,
        mid = mid_expr
    )
}

fn scaled_even_height(src_w: u32, src_h: u32, dst_w: u32) -> u32 {
    if src_w == 0 {
        return 180;
    }
    let mut h = ((src_h as f64 * dst_w as f64) / src_w as f64).round() as u32;
    if h % 2 == 1 {
        h += 1;
    }
    h.max(2)
}

fn load_template_gray(ffmpeg_path: &Path, image_path: &Path, size: u32) -> Result<Vec<u8>> {
    let filter = format!(
        "scale={s}:{s}:force_original_aspect_ratio=increase,crop={s}:{s},format=gray",
        s = size
    );
    let out = Command::new(ffmpeg_path)
        .arg("-v")
        .arg("error")
        .arg("-i")
        .arg(image_path)
        .arg("-vf")
        .arg(filter)
        .arg("-frames:v")
        .arg("1")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("gray")
        .arg("-")
        .output()
        .with_context(|| format!("failed to load target face image: {}", image_path.display()))?;

    if !out.status.success() {
        return Err(anyhow!(
            "ffmpeg failed to decode target face image: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let expected = (size * size) as usize;
    if out.stdout.len() < expected {
        return Err(anyhow!(
            "target face decode returned too little data: got {}, expected {}",
            out.stdout.len(),
            expected
        ));
    }

    Ok(out.stdout[..expected].to_vec())
}

fn sample_video_gray(ffmpeg_path: &Path, input_video: &Path, fps: f64, width: u32) -> Result<Vec<u8>> {
    let filter = format!("fps={fps:.3},scale={width}:-2:flags=bicubic,format=gray");
    let out = Command::new(ffmpeg_path)
        .arg("-v")
        .arg("error")
        .arg("-i")
        .arg(input_video)
        .arg("-vf")
        .arg(filter)
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("gray")
        .arg("-")
        .output()
        .with_context(|| format!("failed to sample video for tracking: {}", input_video.display()))?;

    if !out.status.success() {
        return Err(anyhow!(
            "ffmpeg failed while sampling video for tracking: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    Ok(out.stdout)
}

fn detect_faces_track_points_ffmpeg(
    ffmpeg_path: &Path,
    input_video: &Path,
    sample_width: u32,
    sample_fps: f64,
) -> Result<Vec<ReframeTrackPoint>> {
    #[derive(Clone, Copy)]
    struct FaceRect {
        x: f64,
        w: f64,
        h: f64,
    }

    let vf = format!(
        "fps={fps:.3},scale={w}:-2:flags=bicubic,facedetect,metadata=mode=print:file=-",
        fps = sample_fps,
        w = sample_width
    );

    let out = Command::new(ffmpeg_path)
        .arg("-v")
        .arg("error")
        .arg("-i")
        .arg(input_video)
        .arg("-vf")
        .arg(vf)
        .arg("-an")
        .arg("-f")
        .arg("null")
        .arg("-")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .with_context(|| format!("failed to run facedetect on {}", input_video.display()))?;

    if !out.status.success() {
        return Err(anyhow!(
            "facedetect run failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    if !out.stderr.is_empty() {
        text.push('\n');
        text.push_str(&String::from_utf8_lossy(&out.stderr));
    }

    let mut points = Vec::new();
    let mut frame_idx: usize = 0;
    let mut current_frame: Option<usize> = None;
    let mut frame_rects: Vec<FaceRect> = Vec::new();

    let mut rx: Option<f64> = None;
    let mut ry: Option<f64> = None;
    let mut rw: Option<f64> = None;
    let mut rh: Option<f64> = None;

    let mut prev_center_x: Option<f64> = None;

    let flush_rect = |frame_rects: &mut Vec<FaceRect>, rx: &mut Option<f64>, ry: &mut Option<f64>, rw: &mut Option<f64>, rh: &mut Option<f64>| {
        if let (Some(x), Some(_y), Some(w), Some(h)) = (*rx, *ry, *rw, *rh) {
            if w > 2.0 && h > 2.0 {
                frame_rects.push(FaceRect { x, w, h });
            }
        }
        *rx = None;
        *ry = None;
        *rw = None;
        *rh = None;
    };

    let flush_frame = |points: &mut Vec<ReframeTrackPoint>,
                       frame_rects: &mut Vec<FaceRect>,
                       current_frame: Option<usize>,
                       prev_center_x: &mut Option<f64>| {
        if frame_rects.is_empty() {
            return;
        }

        let chosen = if let Some(prev) = *prev_center_x {
            frame_rects
                .iter()
                .copied()
                .min_by(|a, b| {
                    let ca = a.x + a.w * 0.5;
                    let cb = b.x + b.w * 0.5;
                    let da = (ca - prev).abs() - a.w * 0.10;
                    let db = (cb - prev).abs() - b.w * 0.10;
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                })
                .unwrap_or(frame_rects[0])
        } else {
            frame_rects
                .iter()
                .copied()
                .max_by(|a, b| {
                    let aa = a.w * a.h;
                    let bb = b.w * b.h;
                    aa.partial_cmp(&bb).unwrap_or(std::cmp::Ordering::Equal)
                })
                .unwrap_or(frame_rects[0])
        };

        let cx = chosen.x + chosen.w * 0.5;
        *prev_center_x = Some(cx);

        let fi = current_frame.unwrap_or(points.len());
        points.push(ReframeTrackPoint {
            time_sec: fi as f64 / sample_fps,
            center_x_ratio: (cx / sample_width as f64).clamp(0.1, 0.9),
        });

        frame_rects.clear();
    };

    for line in text.lines() {
        let l = line.trim();

        if let Some(rest) = l.strip_prefix("frame:") {
            flush_rect(&mut frame_rects, &mut rx, &mut ry, &mut rw, &mut rh);
            flush_frame(&mut points, &mut frame_rects, current_frame, &mut prev_center_x);

            let num = rest
                .split_whitespace()
                .next()
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(frame_idx);
            current_frame = Some(num);
            frame_idx += 1;
            continue;
        }

        if let Some((k, v)) = l.split_once('=') {
            let parsed = v.trim().parse::<f64>();
            if parsed.is_err() {
                continue;
            }
            let val = parsed.unwrap_or(0.0);

            let is_x = k == "lavfi.rect.x" || k.ends_with(".rect.x") || k.ends_with(".x");
            let is_y = k == "lavfi.rect.y" || k.ends_with(".rect.y") || k.ends_with(".y");
            let is_w = k == "lavfi.rect.w" || k.ends_with(".rect.w") || k.ends_with(".w");
            let is_h = k == "lavfi.rect.h" || k.ends_with(".rect.h") || k.ends_with(".h");

            if is_x {
                rx = Some(val);
            } else if is_y {
                ry = Some(val);
            } else if is_w {
                rw = Some(val);
            } else if is_h {
                rh = Some(val);
                flush_rect(&mut frame_rects, &mut rx, &mut ry, &mut rw, &mut rh);
            }
        }
    }

    flush_rect(&mut frame_rects, &mut rx, &mut ry, &mut rw, &mut rh);
    flush_frame(&mut points, &mut frame_rects, current_frame, &mut prev_center_x);

    if points.is_empty() {
        return Err(anyhow!("facedetect produced no usable face boxes"));
    }

    Ok(points)
}
fn template_match_best(
    frame: &[u8],
    frame_w: usize,
    frame_h: usize,
    templ: &[u8],
    templ_size: usize,
) -> Option<(usize, usize, f64)> {
    if frame_w < templ_size || frame_h < templ_size {
        return None;
    }

    let stride = 4usize;
    let mut best_score = f64::INFINITY;
    let mut best_x = 0usize;
    let mut best_y = 0usize;

    let max_x = frame_w - templ_size;
    let max_y = frame_h - templ_size;

    let mut y = 0usize;
    while y <= max_y {
        let mut x = 0usize;
        while x <= max_x {
            let mut sad: u64 = 0;
            for ty in 0..templ_size {
                let f_row = (y + ty) * frame_w + x;
                let t_row = ty * templ_size;
                for tx in 0..templ_size {
                    let a = frame[f_row + tx] as i32;
                    let b = templ[t_row + tx] as i32;
                    sad += (a - b).unsigned_abs() as u64;
                }
            }

            let norm = sad as f64 / (templ_size * templ_size) as f64 / 255.0;
            if norm < best_score {
                best_score = norm;
                best_x = x;
                best_y = y;
            }

            x += stride;
        }
        y += stride;
    }
    let confidence = (1.0 - best_score).clamp(0.0, 1.0);
    Some((best_x, best_y, confidence))
}

fn compress_track_points(
    points: &[ReframeTrackPoint],
    max_points: usize,
    alpha: f64,
    stability: f64,
) -> Vec<ReframeTrackPoint> {
    if points.is_empty() {
        return Vec::new();
    }

    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.time_sec.partial_cmp(&b.time_sec).unwrap_or(std::cmp::Ordering::Equal));

    // Velocity clamp first: prevents sudden jumps that appear as odd inserted frames.
    let max_speed = (0.10 + 0.55 * (1.0 - stability.clamp(0.0, 1.0))).clamp(0.10, 0.65);
    let mut clamped = Vec::with_capacity(sorted.len());
    clamped.push(sorted[0].clone());
    for p in sorted.iter().skip(1) {
        let prev = clamped.last().expect("has prev");
        let dt = (p.time_sec - prev.time_sec).max(1.0 / 120.0);
        let max_delta = max_speed * dt;
        let delta = p.center_x_ratio - prev.center_x_ratio;
        let x = if delta.abs() > max_delta {
            prev.center_x_ratio + delta.signum() * max_delta
        } else {
            p.center_x_ratio
        }
        .clamp(0.0, 1.0);

        clamped.push(ReframeTrackPoint {
            time_sec: p.time_sec,
            center_x_ratio: x,
        });
    }

    // Resample to fixed time grid for smoother expression and fewer visual glitches.
    let start_t = clamped.first().map(|p| p.time_sec).unwrap_or(0.0);
    let end_t = clamped.last().map(|p| p.time_sec).unwrap_or(start_t);
    let step = 1.0 / 12.0;

    let mut resampled = Vec::new();
    let mut idx = 0usize;
    let mut t = start_t;
    while t <= end_t + 1e-6 {
        while idx + 1 < clamped.len() && clamped[idx + 1].time_sec < t {
            idx += 1;
        }

        let x = if idx + 1 < clamped.len() {
            let a = &clamped[idx];
            let b = &clamped[idx + 1];
            let dt = (b.time_sec - a.time_sec).max(1e-6);
            let u = ((t - a.time_sec) / dt).clamp(0.0, 1.0);
            a.center_x_ratio + (b.center_x_ratio - a.center_x_ratio) * u
        } else {
            clamped[idx].center_x_ratio
        };

        resampled.push(ReframeTrackPoint {
            time_sec: t,
            center_x_ratio: x.clamp(0.0, 1.0),
        });

        t += step;
    }

    let smoothed = smooth_track_points(&resampled, alpha);

    if smoothed.len() <= max_points {
        return smoothed;
    }

    let step_down = (smoothed.len() as f64 / max_points as f64).ceil() as usize;
    let mut out = Vec::with_capacity(max_points + 1);
    for i in (0..smoothed.len()).step_by(step_down.max(1)) {
        out.push(smoothed[i].clone());
    }
    if let Some(last) = smoothed.last() {
        if out.last().map(|p| p.time_sec) != Some(last.time_sec) {
            out.push(last.clone());
        }
    }

    out
}

fn smooth_track_points(points: &[ReframeTrackPoint], alpha: f64) -> Vec<ReframeTrackPoint> {
    if points.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(points.len());
    let mut ema = points[0].center_x_ratio;
    let alpha = alpha.clamp(0.05, 0.90);
    for p in points {
        ema = (alpha * p.center_x_ratio + (1.0 - alpha) * ema).clamp(0.0, 1.0);
        out.push(ReframeTrackPoint {
            time_sec: p.time_sec,
            center_x_ratio: ema,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filtergraph_includes_crop_and_scale() {
        let g = build_filtergraph(&ZoomMode::ZoomIn, 0.4, None, 0.0, "0", 1080, 1920);
        assert!(g.contains("crop=1080:1920"));
        assert!(g.contains("scale=1080:1920"));
    }

    #[test]
    fn filtergraph_accepts_beat_zoom_expression() {
        let g = build_filtergraph(
            &ZoomMode::ZoomInOutBeat,
            0.7,
            Some("max(1.0,1.05+(0.05*between(t,0.2,0.3)))"),
            0.0,
            "0",
            1080,
            1920,
        );
        assert!(g.contains("max(1.0,1.05"));
    }

    #[test]
    fn filtergraph_supports_loop_zoom_expression() {
        let g = build_filtergraph(&ZoomMode::ZoomInOutLoop, 0.6, None, 0.0, "0", 1080, 1920);
        assert!(g.contains("sin(2*PI*t/2.20)"));
    }

    #[test]
    fn filtergraph_supports_sine_smooth_post_fx() {
        let g = build_filtergraph(&ZoomMode::ZoomSineSmooth, 0.6, None, 0.5, "0", 1080, 1920);
        assert!(g.contains("sin(t*2)"));
        assert!(g.contains("tmix=frames=3"));
        assert!(!g.contains("eq=saturation"));
    }

    #[test]
    fn rational_parser_works() {
        assert_eq!(parse_rational("30000/1001").map(|v| v.round() as i32), Some(30));
    }

    #[test]
    fn reframe_filtergraph_uses_dynamic_crop_x() {
        let points = vec![
            ReframeTrackPoint {
                time_sec: 0.0,
                center_x_ratio: 0.4,
            },
            ReframeTrackPoint {
                time_sec: 1.0,
                center_x_ratio: 0.6,
            },
        ];
        let g = build_reframe_filtergraph(1080, 1920, &points);
        assert!(g.contains("crop=1080:1920"));
        assert!(g.contains("if(lt(t,1.00000)"));
    }
}





























