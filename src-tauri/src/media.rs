use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::{VideoInfo, ZoomMode};

pub fn ffmpeg_binary() -> Result<PathBuf> {
    resolve_binary("ffmpeg")
}

pub fn ffprobe_binary() -> Result<PathBuf> {
    resolve_binary("ffprobe")
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

pub fn build_filtergraph(zoom_mode: &ZoomMode, zoom_strength: f64, bounce_expr: &str, preview: bool) -> String {
    let zoom_strength = zoom_strength.clamp(0.0, 1.0);

    let zoom_expr = match zoom_mode {
        ZoomMode::None => "1.0".to_string(),
        ZoomMode::ZoomIn => format!("1+{:.5}*min(t/8,1)", zoom_strength * 0.22),
        ZoomMode::ZoomOut => format!("1+{:.5}*max(0,1-t/8)", zoom_strength * 0.22),
    };

    let bounce = if bounce_expr.trim().is_empty() { "0" } else { bounce_expr };

    let size = if preview { "540:960" } else { "1080:1920" };

    format!(
        "scale='if(gt(a,9/16),-2,1080)':'if(gt(a,9/16),1920,-2)',crop=1080:1920,scale='ceil(1080*({zoom}+{bounce})/2)*2':'ceil(1920*({zoom}+{bounce})/2)*2':eval=frame,crop=1080:1920,scale={size}:flags=lanczos",
        zoom = zoom_expr,
        bounce = bounce,
        size = size
    )
}

pub fn render_with_ffmpeg<F: FnMut(f64, String)>(
    ffmpeg_path: &Path,
    input: &Path,
    output: &Path,
    filtergraph: &str,
    frame_rate: u32,
    duration_sec: f64,
    mut progress: F,
) -> Result<()> {
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!("failed to create output directory: {}", parent.display())
            })?;
        }
    }

    let filter_script_path = write_filter_script(filtergraph)?;

    let mut cmd = Command::new(ffmpeg_path);
    cmd.arg("-y")
        .arg("-v")
        .arg("error")
        .arg("-progress")
        .arg("pipe:1")
        .arg("-i")
        .arg(input)
        .arg("-filter_script:v")
        .arg(&filter_script_path)
        .arg("-r")
        .arg(frame_rate.to_string())
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("medium")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-movflags")
        .arg("+faststart")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("192k")
        .arg(output)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        anyhow!(
            "failed to start ffmpeg render (exe={}, input={}, output={}, filter_len={}): {}",
            ffmpeg_path.display(),
            input.display(),
            output.display(),
            filtergraph.len(),
            e
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("failed to capture ffmpeg progress stream"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("failed to capture ffmpeg stderr stream"))?;

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
                    progress(
                        (ms / 1_000_000.0 / duration_sec).clamp(0.0, 0.999),
                        "Rendering".to_string(),
                    );
                }
            }
        }
    }

    let status = child.wait()?;
    let mut stderr_buf = Vec::new();
    let _ = stderr.read_to_end(&mut stderr_buf);

    let _ = fs::remove_file(&filter_script_path);

    if !status.success() {
        return Err(anyhow!(
            "ffmpeg render failed (status={}): {}",
            status,
            String::from_utf8_lossy(&stderr_buf)
        ));
    }

    progress(1.0, "Finishing".to_string());
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filtergraph_includes_crop_and_scale() {
        let g = build_filtergraph(&ZoomMode::ZoomIn, 0.4, "0", false);
        assert!(g.contains("crop=1080:1920"));
        assert!(g.contains("scale=1080:1920"));
    }

    #[test]
    fn rational_parser_works() {
        assert_eq!(parse_rational("30000/1001").map(|v| v.round() as i32), Some(30));
    }
}
