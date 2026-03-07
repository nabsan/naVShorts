# Changelog

## 2026-03-07 (V1 update)

### Added
- 4K vertical export preset: `2160x3840`.
- Video encoder selection in UI: `Auto`, `CPU`, `NVIDIA (NVENC)`, `Intel (QSV)`, `AMD (AMF)`.
- Hardware encoder auto-detection (`ffmpeg -encoders`) and automatic fallback in `Auto` mode.
- Export execution log output next to exported media as JSON (`.json`).

### Changed
- Render pipeline now switches encoder arguments by selected backend.
- Render option payload includes encoder selection.
- Frontend initializes encoder availability and marks unavailable options.

### Fixed
- `Select & Open Video` not responding due to frontend script parsing issue.
- Path-move related build-cache issues after relocating project folder.
- Long FFmpeg filter command handling stabilized via filter script file.

### Notes
- V1 policy kept intentionally simple: no platform-specific bitrate split for Shorts/Reels/TikTok.
- Quality remains encoder-driven with current defaults.
