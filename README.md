# naVShorts (Windows)

Windows desktop app for vertical social videos.
Built with **Tauri + Rust + FFmpeg**.

## Workflow
- `1. Reframe` (first step, default startup tab)
- `2. Effects` (second step)

## Main Features
- Horizontal-to-vertical 9:16 conversion.
- Face-reference tracking (target face folder).
- Effects (zoom / beat bounce / motion blur).
- Progress + ETA during render.
- Export log (`.json`) and filter script (`.filter_script.txt`) next to output.

## UI Notes
- Top tabs clearly show active workspace.
- App branding shows `naVShorts` and custom icon.
- Last-used values are remembered and restored on next launch.
- Effects settings persisted: zoom mode/strength, bounce, beat sensitivity, motion blur, preset, encoder.
- Reframe settings persisted: tracking strength, identity threshold, stability, encoder.
- Status panel is fixed-size with internal scroll to avoid layout break on long logs.

## Reframe Quality (Current)
- Preview: `540x960`
- Final reframe output is automatic by source resolution:
- 4K-class source (>=3000 width or >=1700 height): `2160x3840`
- otherwise: `1080x1920`
- Reframe encoder quality was raised for final output.
- CPU x264: lower CRF + slower preset on HQ path.
- NVIDIA/Intel/AMD: lower CQ/QP/quality values on HQ path.

## Face Tracking Tuning Guide
Recommended starting point:
- `Face tracking strength`: `0.72`
- `Stability`: `0.68`
- `Identity threshold`: `0.58`

Adjustment rules:
1. Tracking is weak or often loses the target.
- Increase `Face tracking strength` by `+0.05` steps (up to about `0.80-0.90`).
2. Frame movement is too nervous or jittery.
- Increase `Stability` by `+0.05` steps (up to about `0.75-0.85`).
3. Tracking jumps to another person.
- Increase `Identity threshold` by `+0.03` to `+0.05`.
4. The face is missed too often.
- Slightly decrease `Identity threshold`, or raise `Face tracking strength`.

Practical preset for dance videos:
- `tracking 0.78 / stability 0.76 / identity threshold 0.58`

## Export Presets (Effects)
- YouTube Shorts `1080x1920`
- Instagram Reels `1080x1920`
- Vertical 4K `2160x3840`

## Large Model Files (NOT pushed)
ONNX files are excluded from git due GitHub size limits.
Place under:
- `src-tauri/resources/models/`

### Face detector
- Source: UltraFace ONNX
- URL: https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/tree/master/models/onnx
- Original filename used: `version-RFB-320-int8.onnx`
- Local filename required by app: `face_detector.onnx`

### Face embedding model (ArcFace)
- Source: ONNX Model Zoo ArcFace
- URL: https://github.com/onnx/models/tree/main/validated/vision/body_analysis/arcface
- Original filename used: `arcfaceresnet100-8.onnx`
- Local filename required by app: `arcface.onnx`

## Development
```powershell
npm install
npm.cmd run tauri dev
```

## Recent Updates
- Reframe render startup no longer appears frozen:
- `render_reframe` now returns a job immediately and updates staged status messages (`Starting pipeline`, `Reading metadata`, `Detecting encoders`, `Analyzing face track`, `Preparing filtergraph`, `Starting FFmpeg render`).
- Added face folder scoring workflow:
- `Score Face Folder` for ONNX-based quality scoring.
- `Score + Move Excluded (botu)` to move exclude-recommended images into sibling `botu` folder, with move logs shown in `Status`.
- UI compact layout updates (both workspaces):
- `Verify FFmpeg` button placed at top.
- Forms use horizontal rows for `label + input` and `label + input + button` to reduce vertical height.
- Sliders remain horizontal as `label | value | slider`.
- Identity tracking was strengthened with multi-reference matching:
- Target identity now uses a profile score (`prototype + max + top-k mean`) instead of simple single-mean cosine.
- Added hysteresis gating (`enter threshold` / `keep threshold`) to reduce ID flapping.
- Added motion-consistency scoring (IoU bonus + distance penalty to previous tracked box).
- Added temporary loss tolerance (`max_lost_frames`) to avoid frequent relock jitter.
- `tracking_strength` and `stability` are now forwarded to ONNX identity tracking process.
