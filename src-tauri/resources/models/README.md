# ONNX Models (Place Here)

Place the following files in this directory:

- face_detector.onnx
- arcface.onnx

Notes:
- `face_detector.onnx` is for face detection in video frames.
- `arcface.onnx` is for identity embedding matching against the selected target face image.
- Current build verifies paths and readiness from the Reframe UI via `Verify FFmpeg/ONNX`.
- Full ONNX identity inference integration is the next implementation step.
