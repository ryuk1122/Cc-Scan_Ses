from __future__ import annotations

import base64
import io
from typing import Any, Dict, List

from PIL import Image, ImageOps, ImageEnhance, ImageFilter

from cedula_parser import extract_cedula, parse_pdf417, parse_pdf417_bytes

try:
    import zxingcpp
except ImportError:  # pragma: no cover
    zxingcpp = None

try:
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover
    cv2 = None
    np = None


def barcode_dependency_status() -> Dict[str, Any]:
    """Estado de dependencias para lectura PDF417."""
    return {
        "pillow": Image is not None,
        "zxingcpp": zxingcpp is not None,
        "opencv": cv2 is not None,
        "numpy": np is not None,
    }


def _decode_b64(data_uri_or_b64: str) -> bytes:
    data = (data_uri_or_b64 or "").strip()
    if data.startswith("data:") and "," in data:
        data = data.split(",", 1)[1]
    return base64.b64decode(data + "==", validate=False)


def _barcode_raw(result: Any) -> tuple[str, bytes]:
    raw_bytes = bytes(getattr(result, "bytes", b"") or b"")
    raw_text = str(getattr(result, "text", "") or "")
    if raw_bytes:
        raw_from_bytes = raw_bytes.decode("latin-1", errors="ignore")
        if not raw_text or "\x00" in raw_from_bytes or "PubDSK_" in raw_from_bytes:
            raw_text = raw_from_bytes
    return raw_text, raw_bytes


def _crop_candidates(image: Image.Image) -> List[Image.Image]:
    w, h = image.size
    boxes = [
        (0, 0, w, h),
        (0, 0, int(w * 0.65), h),
        (int(w * 0.35), 0, w, h),
        (int(w * 0.15), 0, int(w * 0.85), h),
        (0, int(h * 0.15), int(w * 0.75), int(h * 0.90)),
        (int(w * 0.10), int(h * 0.10), int(w * 0.90), int(h * 0.90)),
        (0, int(h * 0.35), w, h),
        (0, 0, w, int(h * 0.65)),
    ]
    crops: List[Image.Image] = []
    seen: set[tuple[int, int, int, int]] = set()
    for box in boxes:
        left, top, right, bottom = box
        if right - left < 80 or bottom - top < 80:
            continue
        if box in seen:
            continue
        seen.add(box)
        crops.append(image.crop(box))
    return crops


def _pil_from_cv(arr: Any) -> Image.Image:
    if len(arr.shape) == 2:
        return Image.fromarray(arr)
    return Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))


def _opencv_variants(image: Image.Image) -> List[Image.Image]:
    if cv2 is None or np is None:
        return []

    rgb = ImageOps.exif_transpose(image).convert("RGB")
    bgr = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
    out: List[Image.Image] = []

    for crop in _crop_candidates(_pil_from_cv(bgr)):
        arr = cv2.cvtColor(np.array(crop.convert("RGB")), cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]
        if max(h, w) < 1800:
            scale = 1800 / max(h, w)
            gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)

        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
        denoised = cv2.fastNlMeansDenoising(clahe, None, 12, 7, 21)
        sharpened = cv2.addWeighted(denoised, 1.6, cv2.GaussianBlur(denoised, (0, 0), 2), -0.6, 0)
        _, otsu = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        adaptive = cv2.adaptiveThreshold(
            sharpened,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            41,
            9,
        )
        inverted = cv2.bitwise_not(adaptive)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        closed = cv2.morphologyEx(adaptive, cv2.MORPH_CLOSE, kernel)

        for candidate in (gray, clahe, denoised, sharpened, otsu, adaptive, inverted, closed):
            out.append(_pil_from_cv(candidate))
    return out


def _variants(image: Image.Image) -> List[Image.Image]:
    base = ImageOps.exif_transpose(image).convert("RGB")
    variants: List[Image.Image] = []
    for crop in _crop_candidates(base):
        for angle in (0, 90, 180, 270):
            rotated = crop if angle == 0 else crop.rotate(angle, expand=True)
            for scale in (1, 2, 3):
                scaled = rotated
                if scale > 1:
                    if max(rotated.width * scale, rotated.height * scale) > 3600:
                        continue
                    scaled = rotated.resize((rotated.width * scale, rotated.height * scale), Image.Resampling.LANCZOS)
                variants.append(scaled)
                gray = ImageOps.autocontrast(ImageOps.grayscale(scaled), cutoff=2)
                variants.append(gray)
                high = ImageEnhance.Contrast(gray).enhance(2.8)
                variants.append(high)
                sharp = high.filter(ImageFilter.SHARPEN).filter(ImageFilter.SHARPEN)
                variants.append(sharp)
                threshold = sharp.point(lambda x: 0 if x < 145 else 255, "1").convert("L")
                variants.append(threshold)
    variants.extend(_opencv_variants(base))
    return variants


def decode_barcode_from_base64(image_base64: str) -> Dict[str, Any]:
    if zxingcpp is None:
        return {"ok": False, "error": "zxing-cpp no instalado", "raw": "", "cedula": "", "parsed": {}}

    try:
        image = Image.open(io.BytesIO(_decode_b64(image_base64)))
        image.load()
    except Exception as exc:
        return {"ok": False, "error": f"No se pudo abrir la imagen: {exc}", "raw": "", "cedula": "", "parsed": {}}

    seen: set[str] = set()
    all_raw: List[str] = []
    for variant in _variants(image):
        try:
            results = zxingcpp.read_barcodes(
                variant,
                formats=zxingcpp.BarcodeFormat.PDF417,
                try_rotate=True,
                try_downscale=True,
            )
        except Exception:
            continue
        for result in results:
            raw, raw_bytes = _barcode_raw(result)
            if not raw or raw in seen:
                continue
            seen.add(raw)
            all_raw.append(raw)
            parsed = parse_pdf417_bytes(raw_bytes, raw) if raw_bytes else parse_pdf417(raw)
            cedula = parsed.get("cedula") or extract_cedula(raw) or ""
            if cedula:
                return {
                    "ok": True,
                    "raw": raw,
                    "cedula": cedula,
                    "parsed": parsed,
                    "format": str(getattr(result, "format", "")),
                    "candidates": all_raw[:5],
                }

    return {
        "ok": False,
        "error": "No se detectó PDF417 válido",
        "raw": all_raw[0] if all_raw else "",
        "cedula": "",
        "parsed": {},
        "candidates": all_raw[:5],
    }
