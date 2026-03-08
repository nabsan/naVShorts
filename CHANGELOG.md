# Changelog

## 2026-03-07

### Added
- 4K vertical export preset: `2160x3840`.
- Video encoder selection in UI: `Auto`, `CPU`, `NVIDIA (NVENC)`, `Intel (QSV)`, `AMD (AMF)`.
- Hardware encoder auto-detection (`ffmpeg -encoders`) and automatic fallback in `Auto` mode.
- Export execution log output next to exported media as JSON (`.json`).
- New zoom modes:
  - `Zoom In & Out (Beat Sync)`
  - `Zoom In & Out (Loop)`
  - `Zoom Sine Smooth (tmix optional)`
- Optional motion blur control for `Zoom Sine Smooth` via `Motion blur strength` slider.
- Debug filter script persistence next to export output (`<output_basename>.filter_script.txt`).

### Changed
- Render pipeline now switches encoder arguments by selected backend.
- Render option payload includes encoder selection.
- `Zoom In & Out (Loop)` tuned to smooth asymmetric movement (roughly in ~4s / out ~5s).
- `Zoom Sine Smooth` no longer applies saturation boost; blur is optional and adjustable.
- README docs (EN/JP) updated to reflect current behavior and output artifacts.

### Fixed
- `Select & Open Video` not responding due to frontend script parsing issue.
- Path-move related build-cache issues after relocating project folder.
- Long FFmpeg filter command handling stabilized via filter script file.
- `README_JP.md` mojibake issue fixed by re-saving as UTF-8 with BOM.

### Notes
- V1 policy remains intentionally simple: no platform-specific bitrate split for Shorts/Reels/TikTok.
- Quality remains encoder-driven with current defaults.

## 2026-03-08

### Added
- New dedicated `Reframe Workspace` page and navigation flow from/to Effects workspace.
- Reframe actions:
  - `Select Source Video`
  - `Select Target Face Image`
  - `Render Reframe Preview`
  - `Export Reframed Video`
  - `Send Reframed Video To Effects`
- New backend command `render_reframe` for isolated reframe rendering pipeline.
- New `Face tracking strength` slider (`0.00-1.00`) wired from UI to Rust backend.

### Changed
- Reframe pipeline now supports detector-first tracking behavior:
  - Prefer FFmpeg `facedetect` based tracking path.
  - Auto fallback to template-matching path using selected face image.
- Tracking parameters now adapt by slider strength (sampling, thresholds, smoothing, point density).
- Reframe status messages now include tracking context (points/strength).

### Fixed
- Reframe target-face UI no longer shows "coming soon"; file picker is active.
- Long-running render stall issue addressed by consuming FFmpeg `stderr` in parallel.
- Reframe expression stability improved to reduce invalid/overlong filter failure cases.
