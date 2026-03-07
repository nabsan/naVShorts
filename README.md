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
- Writes export run logs as JSON (default) next to exported file.

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
- Export log output:
  - Default: `<output_basename>.json`
  - Optional: `.log`
  - Includes selected preset/effects/encoder, ffmpeg command, timing, status, stderr.

## Slider Behavior (Important)
All sliders range from `0.00` to `1.00`.

### Zoom strength
- Increase: stronger zoom motion, closer/faster visual push.
- Decrease: softer zoom, more stable framing.

### Bounce strength
- Increase: bigger pulse on beats, stronger music-reactive look.
- Decrease: gentler bounce, calmer motion.

### Beat sensitivity
- Increase: detects more beat points, triggers bounce more often.
- Decrease: detects only stronger peaks, fewer cleaner triggers.

![Effects Sliders](docs/screenshots/04_effects_sliders.png)

## Step-by-Step (Beginner Friendly)
1. Launch app.
2. Click `Verify FFmpeg`.
   - Confirm ffmpeg/ffprobe lines appear in `Status`.
3. Click `Select & Open Video`.
4. Choose your source clip from file picker.
5. Confirm `Output path` is auto-filled.
6. Set `Zoom mode` and sliders.
7. Click `Apply Effects`.
8. Click `Analyze Beats`.
9. (Optional) Click `Render Preview`.
10. Choose `Preset` and `Encoder`.
11. Click `Export Final`.
12. After completion, check the generated export log (`.json`) in the same folder.
13. Watch progress bar and ETA until `completed`.

![Open Video Dialog](docs/screenshots/02_open_video_dialog.png)
![After Open](docs/screenshots/03_after_open_project_status.png)
![Analyze Beats Done](docs/screenshots/05_analyze_beats_done.png)
![Preview Progress](docs/screenshots/06_preview_render_progress.png)
![Export Done](docs/screenshots/07_export_done.png)

## UI and Buttons
- `Select & Open Video`: Open file picker and load selected video.
- `Verify FFmpeg`: Checks ffmpeg/ffprobe path + version.
- `Apply Effects`: Saves slider and mode settings.
- `Analyze Beats`: Runs beat detection from input audio.
- `Render Preview`: Low-resolution quick render.
- `Export Final`: Final export using selected preset/encoder.

Right panel:
- `Status` is shown first (top), with progress bar + ETA.
- `Project` JSON is shown below.

## Recent Changes (2026-03-07)
- Added `Vertical 4K (2160x3840)` export preset.
- Added encoder selector with GPU acceleration support (NVENC/QSV/AMF + auto fallback).
- Added export execution logs written next to output file (`.json` default).
- Fixed file-picker open flow and improved relocated-project build stability.

## Development
```powershell
npm install
npm.cmd run tauri dev
```

## Notes
- Screenshot file naming guide: `docs/screenshots/README.md`
- This is v1 focused on a simple, reliable single-clip flow.
