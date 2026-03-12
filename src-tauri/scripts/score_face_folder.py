import argparse
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np


def load_identity_module(script_path: Path):
    spec = importlib.util.spec_from_file_location("identity_track", script_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def score_one(name, path, detector_mod, det_sess):
    img = cv2.imread(str(path))
    if img is None:
        return {
            "name": name,
            "path": str(path),
            "error": "load_failed",
            "score": 0,
            "recommendation": "exclude",
            "reasons": ["image load failed"],
        }

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    brightness = float(np.mean(gray))
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    faces = detector_mod.detect_faces(det_sess, img)
    face_count = len(faces)
    face_ratio = 0.0
    if face_count > 0:
        areas = [max(0.0, (f[2] - f[0]) * (f[3] - f[1])) for f in faces]
        face_ratio = max(areas) / max(1.0, float(w * h))

    score = 100
    reasons = []

    if face_count == 0:
        score -= 60
        reasons.append("face not detected")
    elif face_count > 1:
        score -= 20
        reasons.append("multiple faces detected")

    if face_ratio < 0.06:
        score -= 25
        reasons.append("face too small")
    elif face_ratio < 0.10:
        score -= 10
        reasons.append("face slightly small")

    if brightness < 95:
        score -= 10
        reasons.append("too dark")
    elif brightness > 210:
        score -= 10
        reasons.append("too bright")

    if sharpness < 40:
        score -= 20
        reasons.append("too blurry")
    elif sharpness < 90:
        score -= 10
        reasons.append("slightly blurry")

    score = int(max(0, min(100, score)))
    adopt = face_count >= 1 and face_ratio >= 0.05 and score >= 70

    if not reasons:
        reasons.append("good candidate")

    return {
        "name": name,
        "path": str(path),
        "width": int(w),
        "height": int(h),
        "faceCount": int(face_count),
        "faceRatio": float(face_ratio),
        "brightness": float(brightness),
        "sharpness": float(sharpness),
        "score": score,
        "recommendation": "adopt" if adopt else "exclude",
        "reasons": reasons,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", required=True)
    ap.add_argument("--detector", required=True)
    ap.add_argument("--arcface", required=True)
    ap.add_argument("--identity-script", required=True)
    args = ap.parse_args()

    folder = Path(args.folder)
    if not folder.exists() or not folder.is_dir():
        raise RuntimeError("target folder does not exist or is not a directory")

    detector_mod = load_identity_module(Path(args.identity_script))
    det_sess, arc_sess = detector_mod.open_sessions(args.detector, args.arcface)

    images = sorted([p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp", ".bmp"]])

    items = []
    for p in images:
        items.append(score_one(p.name, p, detector_mod, det_sess))

    adopted = [x for x in items if x.get("recommendation") == "adopt"]
    excluded = [x for x in items if x.get("recommendation") == "exclude"]

    out = {
        "folder": str(folder),
        "total": len(items),
        "recommended": len(adopted),
        "excluded": len(excluded),
        "items": items,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e))
        raise
