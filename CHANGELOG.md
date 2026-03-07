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
