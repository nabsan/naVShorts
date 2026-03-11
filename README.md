# naVShorts (Windows)

Windows desktop app for vertical social videos.
Built with **Tauri + Rust + FFmpeg**.

## What It Does
- Creates 9:16 videos for Shorts/Reels/TikTok style delivery.
- Keeps editing simple with two separated workspaces:
  - **Reframe Workspace**: horizontal -> vertical conversion with person tracking.
  - **Effects Workspace**: zoom/bounce effects + final export.
- Shows export progress and ETA.
- Saves export logs (`.json`) and FFmpeg filter script (`.filter_script.txt`) next to output.

## Current Workspaces

### 1) Reframe Workspace (Step 1)
- Select source video.
- Select **target face folder** (multiple reference photos of the same person).
- Tune:
  - `Face tracking strength` (default `0.72`)
  - `Identity threshold` (default `0.58`)
  - `Stability` (default `0.68`)
- Render preview or final reframed export.
- Send reframed output to Effects workspace.

### 2) Effects Workspace (Step 2)
- Open input video (or receive from Reframe workspace).
- Apply effects:
  - `None`
  - `Zoom In`
  - `Zoom Out`
  - `Zoom In & Out (Beat Sync)`
  - `Zoom In & Out (Loop)`
  - `Zoom Sine Smooth`
- Tune sliders:
  - `Zoom strength`
  - `Bounce strength`
  - `Beat sensitivity`
  - `Motion blur strength`
- Analyze beats (optional) and export final video.

## Export Specs
- Presets:
  - `YouTube Shorts (1080x1920)`
  - `Instagram Reels (1080x1920)`
  - `Vertical 4K (2160x3840)`
- Preview: `540x960`
- Video/audio: `H.264 + AAC` (MP4/MOV output depending on extension)
- Encoder choice:
  - `Auto` (recommended)
  - `CPU`
  - `NVIDIA (NVENC)` / `Intel (QSV)` / `AMD (AMF)` when available

## Beginner Step-by-Step
1. `Verify FFmpeg/ONNX`.
2. Open **Reframe Workspace**.
3. `Select Source Video`.
4. `Select Target Face Folder` (folder should contain only the target person).
5. Adjust tracking sliders (start from defaults).
6. `Export Reframed Video`.
7. `Send Reframed Video To Effects`.
8. In Effects workspace, choose zoom mode and slider values.
9. (Optional) `Analyze Beats`.
10. Set output path / preset / encoder.
11. `Export Final`.
12. Check output folder:
   - video file
   - `.json` log
   - `.filter_script.txt`

## Slider Meaning (Quick)
- Increase `Face tracking strength`: denser/faster tracking updates.
- Increase `Identity threshold`: stricter person matching (too high may miss frames).
- Increase `Stability`: smoother camera path (less jitter, slower reaction).
- Increase `Zoom strength`: stronger zoom effect.
- Increase `Bounce strength`: larger beat bounce.
- Increase `Beat sensitivity`: more beat points detected.
- Increase `Motion blur strength`: stronger blend blur.

## Required Large Model Files (NOT pushed to Git)
These ONNX files are intentionally not committed because GitHub has file-size limits (100MB/file).
Place files under:

- `src-tauri/resources/models/`

### A) Face detector
- **Download source**:
  - UltraFace ONNX (`version-RFB-320*.onnx`)
  - [https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/tree/master/models/onnx](https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/tree/master/models/onnx)
- **Original filename used**: `version-RFB-320-int8.onnx`
- **Local app name** (required by app): `face_detector.onnx`
- In this repo setup, `face_detector.onnx` is a renamed copy of `version-RFB-320-int8.onnx`.

### B) Face embedding model (ArcFace)
- **Download source**:
  - ONNX Model Zoo ArcFace
  - [https://github.com/onnx/models/tree/main/validated/vision/body_analysis/arcface](https://github.com/onnx/models/tree/main/validated/vision/body_analysis/arcface)
- **Original filename used**: `arcfaceresnet100-8.onnx`
- **Local app name** (required by app): `arcface.onnx`
- In this repo setup, `arcface.onnx` is a renamed copy of `arcfaceresnet100-8.onnx`.

## Why push skipped large files
- `.onnx` files are excluded in `.gitignore`.
- Reason: keep repository lightweight and avoid GitHub large-file push errors.

## Development
```powershell
npm install
npm.cmd run tauri dev
```
