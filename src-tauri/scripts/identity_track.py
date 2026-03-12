import argparse
import json
import os
import sys

import cv2
import numpy as np
import onnxruntime as ort


def iou(a, b):
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    w = max(0.0, x2 - x1)
    h = max(0.0, y2 - y1)
    inter = w * h
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 1e-6 else 0.0


def nms(boxes, scores, iou_thr=0.3, top_k=100):
    idxs = np.argsort(scores)[::-1]
    keep = []
    while idxs.size > 0 and len(keep) < top_k:
        i = idxs[0]
        keep.append(i)
        rest = idxs[1:]
        filtered = []
        for j in rest:
            if iou(boxes[i], boxes[j]) <= iou_thr:
                filtered.append(j)
        idxs = np.array(filtered, dtype=np.int64)
    return keep


def preprocess_detector(frame_bgr, in_w, in_h):
    img = cv2.resize(frame_bgr, (in_w, in_h), interpolation=cv2.INTER_LINEAR)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32)
    img = (img - 127.0) / 128.0
    img = np.transpose(img, (2, 0, 1))[None, :, :, :]
    return img


def decode_ultraface(frame_bgr, scores, boxes, score_thr=0.6):
    h, w = frame_bgr.shape[:2]
    conf = scores[0, :, 1]
    b = boxes[0]

    mask = conf > score_thr
    conf = conf[mask]
    b = b[mask]

    if conf.size == 0:
        return []

    xyxy = np.zeros_like(b)
    xyxy[:, 0] = np.clip(b[:, 0] * w, 0, w - 1)
    xyxy[:, 1] = np.clip(b[:, 1] * h, 0, h - 1)
    xyxy[:, 2] = np.clip(b[:, 2] * w, 0, w - 1)
    xyxy[:, 3] = np.clip(b[:, 3] * h, 0, h - 1)

    keep = nms(xyxy, conf, iou_thr=0.35, top_k=40)
    out = []
    for k in keep:
        x1, y1, x2, y2 = xyxy[k]
        if x2 <= x1 or y2 <= y1:
            continue
        out.append((float(x1), float(y1), float(x2), float(y2), float(conf[k])))
    return out


def crop_face(frame_bgr, box, margin=0.15):
    h, w = frame_bgr.shape[:2]
    x1, y1, x2, y2 = box[:4]
    bw = x2 - x1
    bh = y2 - y1
    x1 = max(0, int(x1 - bw * margin))
    y1 = max(0, int(y1 - bh * margin))
    x2 = min(w - 1, int(x2 + bw * margin))
    y2 = min(h - 1, int(y2 + bh * margin))
    if x2 <= x1 or y2 <= y1:
        return None
    return frame_bgr[y1:y2, x1:x2]


def preprocess_arcface(face_bgr):
    img = cv2.resize(face_bgr, (112, 112), interpolation=cv2.INTER_LINEAR)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32)
    img = (img - 127.5) / 127.5
    img = np.transpose(img, (2, 0, 1))[None, :, :, :]
    return img


def l2_norm(v):
    n = np.linalg.norm(v)
    if n < 1e-8:
        return v
    return v / n


def cosine(a, b):
    return float(np.dot(a, b))


def get_single_embedding(arc_sess, face_bgr):
    inp_name = arc_sess.get_inputs()[0].name
    out_name = arc_sess.get_outputs()[0].name
    x = preprocess_arcface(face_bgr)
    y = arc_sess.run([out_name], {inp_name: x})[0]
    emb = y.reshape(-1).astype(np.float32)
    return l2_norm(emb)


def detect_faces(det_sess, frame_bgr):
    inp = det_sess.get_inputs()[0]
    in_h, in_w = int(inp.shape[2]), int(inp.shape[3])
    x = preprocess_detector(frame_bgr, in_w, in_h)
    out_names = [o.name for o in det_sess.get_outputs()]
    outs = det_sess.run(out_names, {inp.name: x})

    if len(outs) < 2:
        return []

    a, b = outs[0], outs[1]
    if a.ndim == 3 and a.shape[-1] == 2:
        scores, boxes = a, b
    elif b.ndim == 3 and b.shape[-1] == 2:
        scores, boxes = b, a
    else:
        return []

    return decode_ultraface(frame_bgr, scores, boxes, score_thr=0.60)


def open_sessions(detector_path, arcface_path):
    providers = ["CPUExecutionProvider"]
    det = ort.InferenceSession(detector_path, providers=providers)
    arc = ort.InferenceSession(arcface_path, providers=providers)
    return det, arc


def is_image_file(path):
    ext = os.path.splitext(path)[1].lower()
    return ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp"]


def collect_target_images(target, target_dir):
    out = []
    if target:
        out.append(target)
    if target_dir:
        for name in sorted(os.listdir(target_dir)):
            p = os.path.join(target_dir, name)
            if os.path.isfile(p) and is_image_file(p):
                out.append(p)
    dedup = []
    seen = set()
    for p in out:
        ap = os.path.abspath(p)
        if ap in seen:
            continue
        seen.add(ap)
        dedup.append(ap)
    return dedup


def build_target_profile(det_sess, arc_sess, image_paths):
    embs = []
    for img_path in image_paths:
        img = cv2.imread(img_path)
        if img is None:
            continue
        faces = detect_faces(det_sess, img)
        if faces:
            faces = sorted(faces, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
            crop = crop_face(img, faces[0])
            if crop is None:
                crop = img
        else:
            crop = img

        try:
            emb = get_single_embedding(arc_sess, crop)
            embs.append(emb)
        except Exception:
            continue

    if not embs:
        raise RuntimeError("failed to build target embedding from selected image(s)")

    emb_mat = np.stack(embs, axis=0).astype(np.float32)
    proto = l2_norm(np.mean(emb_mat, axis=0).astype(np.float32))
    return {"prototype": proto, "embeddings": emb_mat, "count": int(emb_mat.shape[0])}


def identity_similarity(profile, emb):
    proto = profile["prototype"]
    refs = profile["embeddings"]
    sim_proto = cosine(proto, emb)
    sims = refs @ emb
    sim_max = float(np.max(sims))
    if sims.shape[0] >= 3:
        topk = min(3, sims.shape[0])
        sim_top = float(np.mean(np.sort(sims)[-topk:]))
    else:
        sim_top = float(np.mean(sims))
    return 0.45 * sim_proto + 0.35 * sim_max + 0.20 * sim_top


def bbox_center_ratio(box, w):
    cx = (box[0] + box[2]) * 0.5
    return max(0.05, min(0.95, cx / max(1.0, w)))


def clip_bbox(box, w, h):
    x1, y1, x2, y2 = box
    x1 = max(0.0, min(x1, w - 2.0))
    y1 = max(0.0, min(y1, h - 2.0))
    x2 = max(x1 + 1.0, min(x2, w - 1.0))
    y2 = max(y1 + 1.0, min(y2, h - 1.0))
    return (x1, y1, x2, y2)


def shift_bbox(box, dx, dy, w, h):
    x1, y1, x2, y2 = box
    return clip_bbox((x1 + dx, y1 + dy, x2 + dx, y2 + dy), w, h)


def track_bbox_optical_flow(prev_gray, gray, box):
    h, w = gray.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in box]
    x1 = max(0, min(x1, w - 2))
    y1 = max(0, min(y1, h - 2))
    x2 = max(x1 + 1, min(x2, w - 1))
    y2 = max(y1 + 1, min(y2, h - 1))

    mask = np.zeros_like(prev_gray)
    mask[y1:y2, x1:x2] = 255
    p0 = cv2.goodFeaturesToTrack(prev_gray, maxCorners=60, qualityLevel=0.01, minDistance=3, mask=mask)
    if p0 is None or len(p0) < 6:
        return None

    p1, st, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, p0, None)
    if p1 is None or st is None:
        return None

    good_old = p0[st.reshape(-1) == 1]
    good_new = p1[st.reshape(-1) == 1]
    if len(good_old) < 6:
        return None

    delta = good_new - good_old
    dx = float(np.median(delta[:, 0]))
    dy = float(np.median(delta[:, 1]))
    return shift_bbox(box, dx, dy, w, h)


def kalman_predict(x, P, dt, q):
    F = np.array([[1.0, dt], [0.0, 1.0]], dtype=np.float32)
    Q = np.array([[q * dt * dt, 0.0], [0.0, q]], dtype=np.float32)
    x = F @ x
    P = F @ P @ F.T + Q
    return x, P


def kalman_update(x, P, z, r):
    H = np.array([[1.0, 0.0]], dtype=np.float32)
    R = np.array([[r]], dtype=np.float32)
    y = np.array([[z]], dtype=np.float32) - (H @ x.reshape(2, 1))
    S = H @ P @ H.T + R
    K = P @ H.T @ np.linalg.inv(S)
    x_new = x.reshape(2, 1) + K @ y
    P_new = (np.eye(2, dtype=np.float32) - K @ H) @ P
    return x_new.reshape(2), P_new


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--target", required=False)
    ap.add_argument("--target-dir", required=False)
    ap.add_argument("--detector", required=True)
    ap.add_argument("--arcface", required=True)
    ap.add_argument("--sample-fps", type=float, default=4.0)
    ap.add_argument("--sample-width", type=int, default=384)
    ap.add_argument("--sim-threshold", type=float, default=0.28)
    ap.add_argument("--tracking-strength", type=float, default=0.72)
    ap.add_argument("--stability", type=float, default=0.68)
    args = ap.parse_args()

    if not args.target and not args.target_dir:
        raise RuntimeError("--target or --target-dir is required")

    det_sess, arc_sess = open_sessions(args.detector, args.arcface)

    target_images = collect_target_images(args.target, args.target_dir)
    if not target_images:
        raise RuntimeError("no target face images found")
    target_profile = build_target_profile(det_sess, arc_sess, target_images)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise RuntimeError("failed to open video")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0

    detect_interval = max(1, int(round(fps / max(0.5, args.sample_fps))))
    detect_interval_unlocked = max(1, detect_interval // 2)
    points = []

    prev_gray = None
    frame_idx = 0
    tracked_box = None
    last_center_ratio = None
    lost_frames = 0

    st = float(max(0.0, min(1.0, args.stability)))
    q = 0.001 + (1.0 - st) * 0.02
    r = 0.004 + st * 0.03
    outlier_gate = 0.10 + (1.0 - st) * 0.12

    x = np.array([0.5, 0.0], dtype=np.float32)
    P = np.array([[0.05, 0.0], [0.0, 0.05]], dtype=np.float32)

    trk = float(max(0.0, min(1.0, args.tracking_strength)))
    max_lost_frames = int(round(4 + 14 * trk))
    enter_threshold = float(args.sim_threshold + 0.02)
    keep_threshold = float(max(0.10, args.sim_threshold - 0.04))

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        h0, w0 = frame.shape[:2]
        if args.sample_width > 0 and w0 > args.sample_width:
            scale = args.sample_width / float(w0)
            frame = cv2.resize(frame, (args.sample_width, int(h0 * scale)), interpolation=cv2.INTER_LINEAR)

        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        measured_center = None
        force_detect = tracked_box is None
        current_detect_interval = detect_interval if tracked_box is not None else detect_interval_unlocked
        do_detect = force_detect or (frame_idx % current_detect_interval == 0)

        if do_detect:
            faces = detect_faces(det_sess, frame)
            best = None
            best_sim = -1.0
            best_score = -1e9

            for face in faces:
                crop = crop_face(frame, face)
                if crop is None:
                    continue

                emb = get_single_embedding(arc_sess, crop)
                sim = identity_similarity(target_profile, emb)

                cx_ratio = bbox_center_ratio(face, w)
                if last_center_ratio is not None:
                    sim -= min(0.20, abs(cx_ratio - last_center_ratio) * 0.8)

                score = sim
                if tracked_box is not None:
                    t_cx = (tracked_box[0] + tracked_box[2]) * 0.5
                    t_cy = (tracked_box[1] + tracked_box[3]) * 0.5
                    f_cx = (face[0] + face[2]) * 0.5
                    f_cy = (face[1] + face[3]) * 0.5
                    dist = np.hypot(f_cx - t_cx, f_cy - t_cy) / max(1.0, np.hypot(w, h))
                    iou_v = iou(face[:4], tracked_box)
                    score += iou_v * 0.15
                    score -= dist * 0.22

                if score > best_score:
                    best_score = score
                    best_sim = sim
                    best = face

            if best is not None:
                locked = tracked_box is not None
                threshold = keep_threshold if locked else enter_threshold
                if best_sim >= threshold:
                    tracked_box = clip_bbox(best[:4], w, h)
                    measured_center = bbox_center_ratio(tracked_box, w)
                    lost_frames = 0
                else:
                    lost_frames += 1
                    if lost_frames > max_lost_frames:
                        tracked_box = None
        else:
            if tracked_box is not None and prev_gray is not None:
                moved = track_bbox_optical_flow(prev_gray, gray, tracked_box)
                if moved is not None:
                    tracked_box = moved
                    measured_center = bbox_center_ratio(tracked_box, w)
                    lost_frames = 0
                else:
                    lost_frames += 1
                    if lost_frames > max_lost_frames:
                        tracked_box = None

        dt = 1.0 / max(1.0, fps)
        x, P = kalman_predict(x, P, dt, q)

        if measured_center is not None:
            pred = float(x[0])
            if abs(measured_center - pred) <= outlier_gate:
                x, P = kalman_update(x, P, measured_center, r)
                last_center_ratio = measured_center

        cx = max(0.1, min(0.9, float(x[0])))
        points.append({
            "time_sec": frame_idx / fps,
            "center_x_ratio": cx,
            "similarity": None,
        })

        prev_gray = gray
        frame_idx += 1

    cap.release()

    print(json.dumps({"points": points, "count": len(points)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)
