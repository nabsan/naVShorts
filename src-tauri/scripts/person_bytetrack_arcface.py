import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

import cv2

# Avoid permission issues under %APPDATA%\Ultralytics on some Windows setups.
_ultra_dir = str((Path(__file__).resolve().parents[2] / "Ultralytics"))
os.makedirs(_ultra_dir, exist_ok=True)
os.environ.setdefault("ULTRALYTICS_SETTINGS_DIR", _ultra_dir)
os.environ.setdefault("YOLO_CONFIG_DIR", _ultra_dir)

from ultralytics import YOLO


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def load_identity_module():
    script_path = Path(__file__).resolve().parent / "identity_track.py"
    spec = importlib.util.spec_from_file_location("identity_track", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load identity_track.py: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def person_crop_from_box(frame, box):
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = box
    x1 = max(0, min(int(x1), w - 2))
    y1 = max(0, min(int(y1), h - 2))
    x2 = max(x1 + 1, min(int(x2), w - 1))
    y2 = max(y1 + 1, min(int(y2), h - 1))
    return x1, y1, x2, y2


def pick_best_track(candidates, width, preferred_id=None):
    if not candidates:
        return None

    if preferred_id is not None:
        for c in candidates:
            if c["track_id"] == preferred_id:
                return c

    cx_screen = width * 0.5
    best = None
    best_score = -1e9
    for c in candidates:
        x1, y1, x2, y2 = c["box"]
        bw = max(1.0, float(x2 - x1))
        bh = max(1.0, float(y2 - y1))
        area = bw * bh
        cx = (x1 + x2) * 0.5
        center_pen = abs(cx - cx_screen) / max(1.0, width)
        score = area - (center_pen * area * 0.55)
        if c["similarity"] is not None:
            score += c["similarity"] * area * 0.45
        if score > best_score:
            best_score = score
            best = c
    return best


def compute_similarity(frame, box, id_mod, det_sess, arc_sess, target_profile):
    x1, y1, x2, y2 = person_crop_from_box(frame, box)
    person = frame[y1:y2, x1:x2]
    if person.size == 0:
        return None

    faces = id_mod.detect_faces(det_sess, person)
    if not faces:
        return None

    faces = sorted(faces, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
    fx1, fy1, fx2, fy2, _ = faces[0]
    full_box = (x1 + fx1, y1 + fy1, x1 + fx2, y1 + fy2)
    crop = id_mod.crop_face(frame, full_box)
    if crop is None or crop.size == 0:
        return None

    emb = id_mod.get_single_embedding(arc_sess, crop)
    return float(id_mod.identity_similarity(target_profile, emb))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--sample-width", type=int, default=640)
    ap.add_argument("--sample-fps", type=float, default=6.0)
    ap.add_argument("--tracking-strength", type=float, default=0.72)
    ap.add_argument("--stability", type=float, default=0.68)
    ap.add_argument("--yolo-model", default="yolov8n.pt")
    ap.add_argument("--target")
    ap.add_argument("--target-dir")
    ap.add_argument("--detector", required=True)
    ap.add_argument("--arcface", required=True)
    ap.add_argument("--identity-threshold", type=float, default=0.58)
    args = ap.parse_args()

    trk = float(clamp(args.tracking_strength, 0.0, 1.0))
    stab = float(clamp(args.stability, 0.0, 1.0))
    id_thr = float(clamp(args.identity_threshold, 0.0, 1.0))

    conf_thr = 0.16 + (1.0 - trk) * 0.08
    sample_fps = max(1.0, float(args.sample_fps))
    sim_base = float(0.18 + 0.20 * id_thr)
    enter_threshold = sim_base + 0.02
    keep_threshold = max(0.10, sim_base - 0.04)
    sim_alpha = 0.38 + trk * 0.14

    id_mod = load_identity_module()
    det_sess, arc_sess = id_mod.open_sessions(args.detector, args.arcface)
    target_images = id_mod.collect_target_images(args.target, args.target_dir)
    if len(target_images) == 0:
        raise RuntimeError("target face folder contains no usable images")
    target_profile = id_mod.build_target_profile(det_sess, arc_sess, target_images)

    model = YOLO(args.yolo_model)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise RuntimeError("failed to open video")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0

    detect_interval = max(1, int(round(fps / sample_fps)))
    lost_limit = int(round(4 + trk * 18))

    points = []
    target_id = None
    lost_count = 0
    frame_idx = 0
    track_similarity = {}

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if frame_idx % detect_interval != 0:
            frame_idx += 1
            continue

        h0, w0 = frame.shape[:2]
        if args.sample_width > 0 and w0 > args.sample_width:
            scale = args.sample_width / float(w0)
            frame = cv2.resize(
                frame,
                (args.sample_width, int(h0 * scale)),
                interpolation=cv2.INTER_LINEAR,
            )

        h, w = frame.shape[:2]

        res = model.track(
            frame,
            persist=True,
            tracker="bytetrack.yaml",
            classes=[0],
            conf=conf_thr,
            iou=0.55,
            verbose=False,
            device="cpu",
        )

        candidates = []
        active_ids = set()
        if len(res) > 0 and res[0].boxes is not None and len(res[0].boxes) > 0:
            boxes = res[0].boxes
            if boxes.id is not None:
                xyxy = boxes.xyxy.cpu().numpy()
                ids = boxes.id.cpu().numpy()
                for i in range(len(xyxy)):
                    track_id = int(ids[i])
                    box = [float(v) for v in xyxy[i]]
                    active_ids.add(track_id)
                    sim = compute_similarity(frame, box, id_mod, det_sess, arc_sess, target_profile)
                    if sim is not None:
                        prev = track_similarity.get(track_id, sim)
                        track_similarity[track_id] = (1.0 - sim_alpha) * prev + sim_alpha * sim
                    candidates.append(
                        {
                            "track_id": track_id,
                            "box": box,
                            "similarity": track_similarity.get(track_id),
                        }
                    )

        for stale_id in list(track_similarity.keys()):
            if stale_id not in active_ids:
                del track_similarity[stale_id]

        gated = []
        for c in candidates:
            sim = c["similarity"]
            threshold = keep_threshold if (target_id is not None and c["track_id"] == target_id) else enter_threshold
            if sim is not None and sim >= threshold:
                gated.append(c)

        chosen = pick_best_track(gated, w, preferred_id=target_id)

        if chosen is None:
            lost_count += 1
            if lost_count > lost_limit:
                target_id = None
        else:
            target_id = chosen["track_id"]
            lost_count = 0
            x1, _, x2, _ = chosen["box"]
            cx = (x1 + x2) * 0.5
            if points and stab > 0.01:
                prev = points[-1]["center_x_ratio"]
                cur = clamp(cx / max(1.0, w), 0.1, 0.9)
                alpha = 0.35 + (1.0 - stab) * 0.45
                smooth = clamp(prev * (1.0 - alpha) + cur * alpha, 0.1, 0.9)
            else:
                smooth = clamp(cx / max(1.0, w), 0.1, 0.9)

            points.append(
                {
                    "time_sec": float(frame_idx / fps),
                    "center_x_ratio": float(smooth),
                    "similarity": float(track_similarity.get(target_id, 0.0)),
                }
            )

        frame_idx += 1

    cap.release()

    if not points:
        raise RuntimeError(
            "YOLO+ByteTrack+ArcFace produced no track points. Check face folder quality and subject visibility."
        )

    print(json.dumps({"points": points, "count": len(points)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)
