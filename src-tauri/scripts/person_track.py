import argparse
import json
import os
import sys
from pathlib import Path
import importlib.util

import cv2
import numpy as np

# Avoid permission issues under %APPDATA%\Ultralytics on some Windows setups.
_ultra_dir = str((Path(__file__).resolve().parents[2] / "Ultralytics"))
os.makedirs(_ultra_dir, exist_ok=True)
os.environ.setdefault("ULTRALYTICS_SETTINGS_DIR", _ultra_dir)
os.environ.setdefault("YOLO_CONFIG_DIR", _ultra_dir)

from ultralytics import YOLO
from deep_sort_realtime.deepsort_tracker import DeepSort


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


def pick_best_track(tracks, width, preferred_id=None, similarities=None, min_similarity=None):
    confirmed = [t for t in tracks if t.is_confirmed() and t.time_since_update <= 1]
    if not confirmed:
        return None

    if similarities:
        picked = []
        for t in confirmed:
            sim = similarities.get(t.track_id)
            if sim is None:
                continue
            if min_similarity is not None and sim < min_similarity:
                continue
            bonus = 0.03 if preferred_id is not None and t.track_id == preferred_id else 0.0
            picked.append((sim + bonus, t))
        if picked:
            picked.sort(key=lambda x: x[0], reverse=True)
            return picked[0][1]

    if preferred_id is not None:
        for t in confirmed:
            if t.track_id == preferred_id:
                return t

    cx_screen = width * 0.5
    best = None
    best_score = -1e9
    for t in confirmed:
        l, t0, r, b = t.to_ltrb()
        w = max(1.0, float(r - l))
        h = max(1.0, float(b - t0))
        area = w * h
        cx = (l + r) * 0.5
        center_pen = abs(cx - cx_screen) / max(1.0, width)
        score = area - (center_pen * area * 0.55)
        if score > best_score:
            best_score = score
            best = t
    return best


def person_crop_from_track(frame, track):
    h, w = frame.shape[:2]
    l, t0, r, b = track.to_ltrb()
    x1 = max(0, min(int(l), w - 2))
    y1 = max(0, min(int(t0), h - 2))
    x2 = max(x1 + 1, min(int(r), w - 1))
    y2 = max(y1 + 1, min(int(b), h - 1))
    return x1, y1, x2, y2


def compute_track_similarity(frame, track, id_mod, det_sess, arc_sess, target_profile):
    x1, y1, x2, y2 = person_crop_from_track(frame, track)
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
    ap.add_argument("--sample-width", type=int, default=512)
    ap.add_argument("--sample-fps", type=float, default=6.0)
    ap.add_argument("--tracking-strength", type=float, default=0.72)
    ap.add_argument("--stability", type=float, default=0.68)
    ap.add_argument("--yolo-model", default="yolov8n.pt")
    ap.add_argument("--target")
    ap.add_argument("--target-dir")
    ap.add_argument("--detector")
    ap.add_argument("--arcface")
    ap.add_argument("--identity-threshold", type=float, default=0.58)
    args = ap.parse_args()

    trk = float(clamp(args.tracking_strength, 0.0, 1.0))
    stab = float(clamp(args.stability, 0.0, 1.0))

    conf_thr = 0.18 + (1.0 - trk) * 0.10
    max_age = int(round(10 + trk * 25))
    n_init = 2

    model = YOLO(args.yolo_model)
    tracker = DeepSort(max_age=max_age, n_init=n_init, max_iou_distance=0.70)

    use_identity = bool(args.target or args.target_dir)
    id_mod = None
    det_sess = None
    arc_sess = None
    target_profile = None
    sim_enter = None
    sim_keep = None
    track_similarity = {}
    sim_alpha = 0.42

    if use_identity:
        if not args.detector or not args.arcface:
            raise RuntimeError("target face matching requires --detector and --arcface")
        id_mod = load_identity_module()
        det_sess, arc_sess = id_mod.open_sessions(args.detector, args.arcface)
        target_images = id_mod.collect_target_images(args.target, args.target_dir)
        if len(target_images) == 0:
            raise RuntimeError("target face folder contains no usable images")
        target_profile = id_mod.build_target_profile(det_sess, arc_sess, target_images)
        thr = float(clamp(args.identity_threshold, 0.0, 1.0))
        sim_base = float(0.18 + 0.20 * thr)
        sim_enter = sim_base + 0.02
        sim_keep = max(0.10, sim_base - 0.04)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise RuntimeError("failed to open video")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0

    detect_interval = max(1, int(round(fps / max(0.5, args.sample_fps))))
    lost_limit = int(round(4 + trk * 18))

    points = []
    target_id = None
    lost_count = 0
    frame_idx = 0

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
            frame = cv2.resize(frame, (args.sample_width, int(h0 * scale)), interpolation=cv2.INTER_LINEAR)

        h, w = frame.shape[:2]

        res = model.predict(frame, classes=[0], conf=conf_thr, iou=0.55, verbose=False, device="cpu")
        dets = []
        if len(res) > 0 and res[0].boxes is not None and len(res[0].boxes) > 0:
            boxes = res[0].boxes
            xyxy = boxes.xyxy.cpu().numpy()
            confs = boxes.conf.cpu().numpy()
            for i in range(len(xyxy)):
                x1, y1, x2, y2 = [float(v) for v in xyxy[i]]
                bw = max(1.0, x2 - x1)
                bh = max(1.0, y2 - y1)
                dets.append(([x1, y1, bw, bh], float(confs[i]), "person"))

        tracks = tracker.update_tracks(dets, frame=frame)

        if use_identity and id_mod is not None and det_sess is not None and arc_sess is not None and target_profile is not None:
            active_ids = set()
            confirmed = [t for t in tracks if t.is_confirmed() and t.time_since_update <= 1]
            for tr in confirmed:
                active_ids.add(tr.track_id)
                sim = compute_track_similarity(frame, tr, id_mod, det_sess, arc_sess, target_profile)
                if sim is None:
                    continue
                prev = track_similarity.get(tr.track_id, sim)
                track_similarity[tr.track_id] = (1.0 - sim_alpha) * prev + sim_alpha * sim

            for tid in list(track_similarity.keys()):
                if tid not in active_ids:
                    del track_similarity[tid]

        min_sim = sim_keep if (use_identity and target_id is not None) else sim_enter
        chosen = pick_best_track(
            tracks,
            w,
            preferred_id=target_id,
            similarities=track_similarity if use_identity else None,
            min_similarity=min_sim if use_identity else None,
        )

        if chosen is None:
            lost_count += 1
            if lost_count > lost_limit:
                target_id = None
        else:
            target_id = chosen.track_id
            lost_count = 0
            l, t0, r, b = chosen.to_ltrb()
            cx = (l + r) * 0.5
            if points and stab > 0.01:
                prev = points[-1]["center_x_ratio"]
                cur = clamp(cx / max(1.0, w), 0.1, 0.9)
                alpha = 0.35 + (1.0 - stab) * 0.45
                smooth = clamp(prev * (1.0 - alpha) + cur * alpha, 0.1, 0.9)
            else:
                smooth = clamp(cx / max(1.0, w), 0.1, 0.9)

            points.append({
                "time_sec": float(frame_idx / fps),
                "center_x_ratio": float(smooth),
                "similarity": float(track_similarity.get(target_id, 0.0)) if use_identity else None,
            })

        frame_idx += 1

    cap.release()

    if not points:
        raise RuntimeError(
            "YOLO+DeepSORT produced no track points. Install dependencies and ensure person is visible."
        )

    print(json.dumps({"points": points, "count": len(points)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)
