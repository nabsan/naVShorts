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


def build_target_embedding(det_sess, arc_sess, image_paths):
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

    mean_emb = np.mean(np.stack(embs, axis=0), axis=0).astype(np.float32)
    return l2_norm(mean_emb)


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
    args = ap.parse_args()

    if not args.target and not args.target_dir:
        raise RuntimeError("--target or --target-dir is required")

    det_sess, arc_sess = open_sessions(args.detector, args.arcface)

    target_images = collect_target_images(args.target, args.target_dir)
    if not target_images:
        raise RuntimeError("no target face images found")
    target_emb = build_target_embedding(det_sess, arc_sess, target_images)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise RuntimeError("failed to open video")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0

    step = max(1, int(round(fps / max(0.1, args.sample_fps))))
    points = []
    frame_idx = 0
    prev_cx = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if frame_idx % step != 0:
            frame_idx += 1
            continue

        h, w = frame.shape[:2]
        if args.sample_width > 0 and w > args.sample_width:
            scale = args.sample_width / float(w)
            frame = cv2.resize(frame, (args.sample_width, int(h * scale)), interpolation=cv2.INTER_LINEAR)
            h, w = frame.shape[:2]

        faces = detect_faces(det_sess, frame)
        best = None
        best_sim = -1.0

        for face in faces:
            crop = crop_face(frame, face)
            if crop is None:
                continue
            emb = get_single_embedding(arc_sess, crop)
            sim = cosine(target_emb, emb)

            cx = (face[0] + face[2]) * 0.5
            if prev_cx is not None:
                sim -= min(0.25, abs(cx - prev_cx) / max(1.0, w) * 0.4)

            if sim > best_sim:
                best_sim = sim
                best = face

        if best is not None and best_sim >= args.sim_threshold:
            cx = (best[0] + best[2]) * 0.5
            prev_cx = cx
            points.append(
                {
                    "time_sec": frame_idx / fps,
                    "center_x_ratio": max(0.1, min(0.9, cx / max(1.0, w))),
                    "similarity": best_sim,
                }
            )

        frame_idx += 1

    cap.release()

    print(json.dumps({"points": points, "count": len(points)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)
