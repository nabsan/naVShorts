# naVShorts (Windows)

naVShorts is a Windows desktop app for building vertical social videos.  
It is built with **Tauri + Rust + FFmpeg**.

## RC1 Status
This repository state is the current `rc1` baseline.
`rc1` means the main end-to-end workflow is stable enough for regular use while future polish and smaller refinements may still continue.

## Workflow
- `1. Pre Reframe`: place manual face-box anchors and prepare Assist JSON
- `2. Reframe`: convert horizontal video into vertical `9:16` with tracking
- `3. Effects`: add zoom / beat / motion effects and export the final video
- `4. Settings`: manage shared folders, runtime checks, and startup defaults

## Main Features
- Horizontal-to-vertical `9:16` conversion
- Person tracking with `Target face folder path`
- Multiple Reframe tracking engines
  - `Face Identity (ONNX)`
  - `Person YOLO + DeepSORT`
  - `Person YOLO + ByteTrack + ArcFace`
  - `Manual Assist JSON`
- `Pre Reframe` preview playback with manual face-box anchors
- Hybrid Assist tracking
  - manual anchors remain the base
  - auto tracking assists between anchors
  - supported assist engines:
    - `Manual only`
    - `Assist with Face Identity (ONNX)`
    - `Assist with YOLO + ByteTrack + ArcFace`
    - `Assist with YOLO + DeepSORT`
- Effects workspace
  - zoom modes
  - beat bounce
  - motion blur
- Render progress + ETA
- Export log (`.json`) and FFmpeg filter script (`.filter_script.txt`) saved next to the output file
- `Settings` page for shared folders, startup defaults, and FFmpeg / ONNX verification
- `Reset Remembered UI State` with backup export before clearing remembered workspace selections

## Reframe Quality
- Assist preview playback uses a lightweight proxy video
- Final Reframe output is chosen automatically from source resolution
  - 4K-class input (`width >= 3000` or `height >= 1700`): `2160x3840`
  - otherwise: `1080x1920`
- Final export quality is tuned higher than preview output

## Tracking Tuning Guide
Recommended starting values by tracking engine:
- `Face Identity (ONNX)`: `tracking 0.78 / id 0.58 / stability 0.76`
- `Person YOLO + DeepSORT`: `tracking 0.80 / id 0.60 / stability 0.74`
- `Person YOLO + ByteTrack + ArcFace`: `tracking 0.84 / id 0.66 / stability 0.82`
- `Manual Assist JSON`: `tracking 0.72 / id 0.58 / stability 0.84`

Adjustment rules:
1. Tracking is weak or loses the target often.
- Increase `Face tracking strength` by `+0.05`.
2. Movement is too nervous or jittery.
- Increase `Stability` by `+0.05`.
3. Tracking jumps to another person.
- Increase `Identity threshold` by `+0.03` to `+0.05`.
4. Face is missed too often.
- Slightly lower `Identity threshold`, or raise `Face tracking strength`.

## Pre Reframe Usage
1. Open `1. Pre Reframe`.
2. Select the source video.
3. Select `Target face folder path` if you want hybrid assist tracking.
4. Choose `Assist tracking engine`.
5. Play the preview and pause only where tracking would drift.
6. Place manual face rectangles at those drift points.
7. Save Assist JSON.
8. Send Assist JSON to `2. Reframe`.
9. In `2. Reframe`, keep `Tracking engine = Manual Assist JSON` and export.

Notes:
- Manual anchors are always respected.
- Auto assist is blended mainly between anchors.
- If auto assist fails, manual anchors still remain the fallback path.
- Opening the same source video again reuses the cached Assist preview proxy when path / size / modified time match.
- By default, `1. Pre Reframe` shows the current interpolated box only. Enable `Show all saved anchors` if you want to inspect every anchor.
- Keyboard shortcuts in `1. Pre Reframe`:
  - `Space`: play / pause
  - `J`: jump back 3 seconds
  - `L`: jump forward 3 seconds
  - `Left / Right`: move by about 1 frame

## Effects Usage
- Before both `Render Preview` and `Export Final`, the app now auto-runs:
  - `Analyze Beats`
  - `Apply Effects`
- Preview output uses a `_preview` postfix in the file name.
- Preview output is intentionally lighter and faster than final export.

## Effects Export Presets
- YouTube Shorts `1080x1920`
- Instagram Reels `1080x1920`
- Vertical 4K `2160x3840`

## Runtime Assets Not Pushed To Git
Large runtime assets are excluded from git because of repository size limits.  
Place them under:
- `src-tauri/resources/models/`

### Face detector model
- Source: UltraFace ONNX
- URL: https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/tree/master/models/onnx
- Original filename used: `version-RFB-320-int8.onnx`
- Local filename required by the app: `face_detector.onnx`

### Face embedding model (ArcFace)
- Source: ONNX Model Zoo ArcFace
- URL: https://github.com/onnx/models/tree/main/validated/vision/body_analysis/arcface
- Original filename used: `arcfaceresnet100-8.onnx`
- Local filename required by the app: `arcface.onnx`

### YOLO model file
- Runtime model: `src-tauri/yolov8n.pt`
- Source: Ultralytics default `yolov8n.pt` download on first run

### Ultralytics runtime cache
- Folder: `Ultralytics/`
- Purpose: local runtime cache/settings generated by Ultralytics

## Development
```powershell
npm install
npm.cmd run tauri dev
```

## Recent Updates
- Reorganized workspaces into `1. Pre Reframe / 2. Reframe / 3. Effects / 4. Settings`
- Added Settings-based defaults for shared folders and startup modes
- Added `Reset Remembered UI State` with backup export before clearing remembered UI selections
- Stabilized Assist preview playback by switching to blob-based preview loading instead of direct `asset.localhost` playback
- Added Assist JSON save/load flow
- Added `Manual Assist JSON` tracking mode in `2. Reframe`
- Added hybrid assist tracking using `Target face folder path` plus auto engines between manual anchors
- `2. Reframe` now auto-loads target face folder info from Assist JSON when available
- `1. Pre Reframe` now reuses cached preview proxies, shows the current box by default, and supports keyboard shortcuts
- `3. Effects` now auto-runs `Analyze Beats -> Apply Effects` before both Preview and Final export
- Effects Preview now writes a `_preview` file and uses lighter preview render settings for speed
