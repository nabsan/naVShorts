# Shorts/Reels Maker (Windows)

A Windows desktop app for creating **9:16 vertical videos** for **YouTube Shorts** and **Instagram Reels**.
Built with **Tauri + Rust + FFmpeg**.

## Screenshot Walkthrough
![Main UI](docs/screenshots/01_main_ui.png)

## What This App Does
- Opens one local video file.
- Auto-fits/crops it to vertical 9:16.
- Adds motion effects (Zoom + Beat Bounce).
- Detects audio beats from the source video.
- Exports MP4 (H.264 + AAC).
- Supports software and hardware encoding (CPU/NVIDIA/Intel/AMD).
- Shows live render progress and ETA.
- Writes export run logs as JSON next to exported file.
- Persists FFmpeg filter script next to exported file for debugging.

## Current Specs (v1)
- Single-clip workflow (no multi-clip timeline yet).
- Output canvas:
  - Final export presets: `1080x1920` and `2160x3840 (Vertical 4K)`
  - Preview export: `540x960`
- Export presets:
  - `YouTube Shorts (1080x1920)`
  - `Instagram Reels (1080x1920)`
  - `Vertical 4K (2160x3840)`
- Encoder options:
  - `Auto` (recommended, auto-select available GPU encoder)
  - `CPU`
  - `NVIDIA (NVENC)`, `Intel (QSV)`, `AMD (AMF)` when available
- Supported input picker filter: `mp4, mov, mkv, avi, webm`
- Output default naming:
  - Same folder as input file
  - `<original_name>_exported_yymmddhhmmss.<ext>`
  - Example: `hoge.mp4` -> `hoge_exported_260307154512.mp4`
- Export artifacts:
  - Log JSON: `<output_basename>.json`
  - Filter script: `<output_basename>.filter_script.txt`

## Zoom Modes
- `None`: no zoom animation.
- `Zoom In`: gradually zooms in over time.
- `Zoom Out`: gradually zooms out over time.
- `Zoom In & Out (Beat Sync)`: alternates in/out on each detected beat.
  - Best used after `Analyze Beats`.
- `Zoom In & Out (Loop)`: smooth loop by elapsed time.
  - Smooth asymmetric cycle (roughly in 4s + out 5s).
  - If beat data exists, strength changes subtly by song energy.
- `Zoom Sine Smooth (tmix optional)`: sine-based smooth zoom with optional frame blend.
  - Saturation boost removed.
  - Use `Motion blur strength` to control tmix (0.00 = off).

## Slider Behavior (Important)
All sliders range from `0.00` to `1.00`.

### Zoom strength
- Increase: stronger zoom motion.
- Decrease: softer zoom motion.

### Bounce strength
- Increase: bigger pulse on beats.
- Decrease: gentler bounce.

### Beat sensitivity
- Increase: detects more beat points.
- Decrease: detects only stronger peaks.

### Motion blur strength
- `0.00`: no tmix blur.
- `0.01 - 0.33`: light blur.
- `0.34 - 0.66`: medium blur.
- `0.67 - 1.00`: stronger blur.

![Effects Sliders](docs/screenshots/04_effects_sliders.png)

## Step-by-Step (Beginner Friendly)
1. Launch app.
2. Click `Verify FFmpeg`.
3. Click `Select & Open Video` and choose source.
4. Confirm `Output path` auto-filled.
5. Set `Zoom mode` and sliders.
6. Click `Apply Effects`.
7. If using `Zoom In & Out (Beat Sync)`, click `Analyze Beats`.
8. (Optional) Click `Render Preview`.
9. Choose `Preset` and `Encoder`.
10. Click `Export Final`.
11. Check generated files in output folder:
   - exported video `.mp4`
   - export log `.json`
   - filter script `.filter_script.txt`

## UI and Buttons
- `Select & Open Video`: Open file picker and load selected video.
- `Verify FFmpeg`: Checks ffmpeg/ffprobe path + version.
- `Apply Effects`: Saves slider and mode settings.
- `Analyze Beats`: Runs beat detection from input audio.
- `Render Preview`: Low-resolution quick render.
- `Export Final`: Final export using selected preset/encoder.

Right panel:
- `Status` on top (progress + ETA).
- `Project` JSON below.

## Development
```powershell
npm install
npm.cmd run tauri dev
```

## Notes
- Screenshot naming guide: `docs/screenshots/README.md`
- v1 focuses on a reliable single-clip flow.
