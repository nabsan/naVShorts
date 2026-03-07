use std::f32;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatPoint {
    pub time_sec: f64,
    pub intensity: f64,
}

pub fn analyze_beats_from_video(ffmpeg_path: &Path, input: &Path, sensitivity: f64) -> Result<Vec<BeatPoint>> {
    let mut cmd = Command::new(ffmpeg_path);
    cmd.arg("-v")
        .arg("error")
        .arg("-i")
        .arg(input)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("8000")
        .arg("-f")
        .arg("f32le")
        .arg("-")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().context("failed to start ffmpeg for beat analysis")?;
    let mut raw = Vec::new();
    if let Some(mut stdout) = child.stdout.take() {
        stdout.read_to_end(&mut raw)?;
    }

    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg beat analysis failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let samples = bytes_to_f32(&raw);
    Ok(extract_beats(&samples, 8000, sensitivity))
}

fn bytes_to_f32(raw: &[u8]) -> Vec<f32> {
    raw.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

fn extract_beats(samples: &[f32], sample_rate: usize, sensitivity: f64) -> Vec<BeatPoint> {
    if samples.is_empty() {
        return Vec::new();
    }

    let frame_size = 512;
    let hop = 256;

    let mut energy = Vec::new();
    let mut i = 0;
    while i + frame_size <= samples.len() {
        let mut sum = 0.0f64;
        for s in &samples[i..i + frame_size] {
            let v = *s as f64;
            sum += v * v;
        }
        energy.push((sum / frame_size as f64).sqrt());
        i += hop;
    }

    if energy.len() < 3 {
        return Vec::new();
    }

    let mut diffs = Vec::with_capacity(energy.len());
    diffs.push(0.0);
    for w in energy.windows(2) {
        diffs.push((w[1] - w[0]).max(0.0));
    }

    let mean = diffs.iter().sum::<f64>() / diffs.len() as f64;
    let std = (diffs.iter().map(|d| (d - mean) * (d - mean)).sum::<f64>() / diffs.len() as f64).sqrt();
    let threshold = mean + (0.4 + (1.0 - sensitivity.clamp(0.0, 1.0)) * 1.2) * std;

    let min_gap = (sample_rate as f64 * 0.14 / hop as f64) as isize;
    let mut beats = Vec::new();
    let mut last_idx: isize = -10_000;

    for idx in 1..diffs.len() - 1 {
        let current = diffs[idx];
        if current < threshold {
            continue;
        }
        if current < diffs[idx - 1] || current < diffs[idx + 1] {
            continue;
        }
        if idx as isize - last_idx < min_gap {
            continue;
        }

        let time_sec = (idx * hop) as f64 / sample_rate as f64;
        beats.push(BeatPoint {
            time_sec,
            intensity: current,
        });
        last_idx = idx as isize;
    }

    beats
}

pub fn normalize_beat_map(points: &[BeatPoint]) -> Vec<BeatPoint> {
    if points.is_empty() {
        return Vec::new();
    }

    let max = points
        .iter()
        .map(|p| p.intensity)
        .fold(f64::NEG_INFINITY, f64::max)
        .max(0.000001);

    points
        .iter()
        .map(|p| BeatPoint {
            time_sec: p.time_sec,
            intensity: (p.intensity / max).clamp(0.0, 1.0),
        })
        .collect()
}

pub fn decay_envelope(points: &[BeatPoint], strength: f64, decay_sec: f64) -> String {
    if points.is_empty() || strength <= 0.0 {
        return "0".to_string();
    }

    let strength = strength.clamp(0.0, 1.0);
    let mut terms = Vec::new();

    for p in points.iter().take(240) {
        let start = p.time_sec;
        let end = p.time_sec + decay_sec;
        let amp = (p.intensity * strength).clamp(0.0, 1.0);

        terms.push(format!(
            "({amp:.5}*max(0,1-(t-{start:.5})/{decay_sec:.5})*between(t,{start:.5},{end:.5}))"
        ));
    }

    terms.join("+")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_scales_to_one() {
        let input = vec![
            BeatPoint { time_sec: 0.1, intensity: 2.0 },
            BeatPoint { time_sec: 0.2, intensity: 4.0 },
        ];

        let out = normalize_beat_map(&input);
        assert!((out[1].intensity - 1.0).abs() < 1e-6);
        assert!((out[0].intensity - 0.5).abs() < 1e-6);
    }

    #[test]
    fn decay_expression_contains_terms() {
        let input = vec![BeatPoint { time_sec: 1.0, intensity: 1.0 }];
        let expr = decay_envelope(&input, 0.6, 0.2);
        assert!(expr.contains("between(t,1.00000,1.20000)"));
    }

    #[test]
    fn extract_beats_handles_empty() {
        let beats = extract_beats(&[], 8000, 0.5);
        assert!(beats.is_empty());
    }
}