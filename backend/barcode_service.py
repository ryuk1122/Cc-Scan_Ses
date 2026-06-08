from __future__ import annotations

import base64
import io
import re
import urllib.parse
from typing import Any, Dict, List

from PIL import Image, ImageOps, ImageEnhance, ImageFilter

from cedula_parser import extract_cedula, parse_pdf417, parse_pdf417_bytes

QR_IDENTITY_HINT_RE = re.compile(
    r"REGISTRADURIA|WSP\.REGISTRADURIA|CEDULADIGITAL|C[EÉ]DULA|CC|NUIP|DOCUMENTO|DOC|NUMERO|NÚMERO|IDENTIFIC|DOCUMENT_NUMBER|DOCUMENTNUMBER|NUMERO_DOCUMENTO",
    re.IGNORECASE,
)
QR_ID_KEY_RE = re.compile(
    r"(?:^|[?&#;,\s{\[\"'])\s*"
    r"(?:nuip|cedula|c[eé]dula|cc|doc|documento|document_number|documentnumber|numero_documento|n[uú]mero|numero|nro|no|identificacion|identificaci[oó]n|id)"
    r"\s*[\"']?\s*[:=/#-]\s*[\"']?([0-9][0-9\s.,-]{3,20}[0-9])",
    re.IGNORECASE,
)
QR_PREFIX_RE = re.compile(
    r"(?:^|[^A-Z0-9])(?:CC|NUIP|DOC|CEDULA|DOCUMENTO|ID)\s*[:#-]?\s*([0-9][0-9\s.,-]{3,20}[0-9])(?:[^0-9]|$)",
    re.IGNORECASE,
)
QR_DIGIT_RUN_RE = re.compile(r"(?<!\d)(\d[\d\s.,-]{3,20}\d)(?!\d)")

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


def _clean_qr_digits(value: str) -> str:
    digits = re.sub(r"\D", "", str(value or "")).lstrip("0")
    if not re.fullmatch(r"\d{5,11}", digits or ""):
        return ""
    if re.fullmatch(r"(?:19|20)\d{2}", digits) or re.fullmatch(r"(?:19|20)\d{6}", digits):
        return ""
    return digits


def _best_qr_digit_candidate(value: str) -> str:
    candidates: List[tuple[str, float]] = []
    for match in QR_DIGIT_RUN_RE.finditer(value or ""):
        digits = _clean_qr_digits(match.group(1))
        if not digits:
            continue
        length_score = {10: 12, 9: 11, 8: 10, 7: 9, 11: 7, 6: 5, 5: 4}.get(len(digits), 1)
        candidates.append((digits, length_score + match.start() / max(len(value), 1)))
    candidates.sort(key=lambda item: item[1], reverse=True)
    return candidates[0][0] if candidates else ""


def extract_qr_identity_number(raw: str) -> str:
    original = str(raw or "").strip()
    if not original:
        return ""

    variants: List[str] = []
    for value in (
        original,
        urllib.parse.unquote(original),
        original.replace("&amp;", "&"),
        urllib.parse.unquote(original.replace("&amp;", "&")),
    ):
        if value and value not in variants:
            variants.append(value)

    for value in variants:
        direct = _clean_qr_digits(value)
        if direct:
            return direct

        key_match = QR_ID_KEY_RE.search(value)
        if key_match:
            digits = _clean_qr_digits(key_match.group(1))
            if digits:
                return digits

        prefixed = QR_PREFIX_RE.search(value)
        if prefixed:
            digits = _clean_qr_digits(prefixed.group(1))
            if digits:
                return digits

        if re.search(r"registraduria\.gov\.co|wsp\.registraduria|ceduladigital|cedula", value, re.IGNORECASE):
            digits = _best_qr_digit_candidate(value)
            if digits:
                return digits

    return ""


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


def _qr_crop_candidates(image: Image.Image) -> List[Image.Image]:
    w, h = image.size
    boxes = [
        (int(w * 0.48), 0, w, int(h * 0.48)),
        (int(w * 0.42), 0, w, int(h * 0.58)),
        (int(w * 0.55), int(h * 0.04), int(w * 0.98), int(h * 0.45)),
        (int(w * 0.55), int(h * 0.45), int(w * 0.98), int(h * 0.98)),
        (int(w * 0.40), int(h * 0.25), int(w * 0.98), int(h * 0.78)),
        (int(w * 0.05), int(h * 0.05), int(w * 0.50), int(h * 0.50)),
        (int(w * 0.05), int(h * 0.45), int(w * 0.50), int(h * 0.98)),
        (int(w * 0.20), int(h * 0.20), int(w * 0.80), int(h * 0.80)),
        (0, 0, w, int(h * 0.62)),
        (int(w * 0.35), 0, w, h),
        (0, 0, w, h),
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
    for crop in _crop_candidates(base)[:4]:
        variants.append(crop)
        gray = ImageOps.autocontrast(ImageOps.grayscale(crop), cutoff=2)
        variants.append(gray)
        high = ImageEnhance.Contrast(gray).enhance(2.3)
        variants.append(high)
        threshold = high.point(lambda x: 0 if x < 145 else 255, "1").convert("L")
        variants.append(threshold)
    return variants


def _decode_qr_from_image(image: Image.Image) -> dict:
    if zxingcpp is None:
        return {"ok": False, "error": "zxing-cpp no instalado", "raw": "", "cedula": "", "parsed": {}, "candidates": []}

    seen: set[str] = set()
    all_raw: List[str] = []
    base = ImageOps.exif_transpose(image).convert("RGB")
    fast_variants: List[Image.Image] = []
    for crop in _qr_crop_candidates(base):
        fast_variants.append(crop)
        fast_variants.append(ImageOps.autocontrast(ImageOps.grayscale(crop), cutoff=2))

    for variant in [*fast_variants, *_variants(base)]:
        try:
            results = zxingcpp.read_barcodes(
                variant,
                formats=zxingcpp.BarcodeFormat.QRCode,
                try_rotate=True,
                try_downscale=True,
            )
        except Exception:
            continue

        for result in results:
            raw, _raw_bytes = _barcode_raw(result)
            raw = (raw or "").strip()
            if not raw or raw in seen:
                continue
            seen.add(raw)
            all_raw.append(raw)
            qr_cedula = extract_qr_identity_number(raw)
            parsed = parse_pdf417(raw)
            cedula = parsed.get("cedula") or qr_cedula or extract_cedula(raw) or ""
            has_identity_hint = (
                bool(qr_cedula)
                or "IDCOL" in raw
                or "<<" in raw
                or "|" in raw
                or QR_IDENTITY_HINT_RE.search(raw)
                or str(parsed.get("formato_detectado") or "") not in ("", "desconocido", "numero_puro")
            )
            if cedula and has_identity_hint:
                if qr_cedula and not parsed.get("cedula"):
                    parsed["cedula"] = qr_cedula
                parsed["formato_detectado"] = parsed.get("formato_detectado") or "qr"
                return {
                    "ok": True,
                    "raw": raw,
                    "cedula": cedula,
                    "parsed": parsed,
                    "format": str(getattr(result, "format", "QRCode")),
                    "source": "qr",
                    "candidates": all_raw[:5],
                }

    return {"ok": False, "error": "No se detecto QR con cedula", "raw": "", "cedula": "", "parsed": {}, "candidates": all_raw[:5]}


def decode_qr_from_base64(image_base64: str) -> dict:
    try:
        img_bytes = _decode_b64(image_base64)
        image = Image.open(io.BytesIO(img_bytes))
        image.load()
    except Exception as exc:
        return {"ok": False, "error": f"No se pudo abrir la imagen: {exc}", "raw": "", "cedula": "", "parsed": {}}

    max_width = 1600
    if image.width > max_width:
        ratio = max_width / float(image.width)
        image = image.resize((max_width, int(float(image.height) * ratio)), Image.Resampling.LANCZOS)
    return _decode_qr_from_image(image)


def _decode_mrz_from_base64(image_base64: str) -> dict:
    try:
        from ocr_service import ocr_mrz_cedula

        img_bytes = _decode_b64(image_base64)
        mrz = ocr_mrz_cedula(img_bytes)
    except Exception as exc:
        mrz = {"ok": False, "error": f"Error OCR MRZ: {exc}", "cedula": "", "parsed": {}, "raw_mrz": []}

    if mrz.get("cedula"):
        parsed = mrz.get("parsed") or {}
        raw_mrz = parsed.get("raw_mrz") or mrz.get("raw_mrz") or []
        return {
            "ok": True,
            "raw": "\n".join(raw_mrz) if raw_mrz else (mrz.get("texto_completo") or ""),
            "cedula": mrz.get("cedula") or "",
            "parsed": parsed,
            "format": "MRZ",
            "source": "mrz_ocr",
            "candidates": [],
            "raw_mrz": raw_mrz,
            "mrz_valido": bool(parsed.get("mrz_valido")),
        }
    return mrz


def decode_identity_document_from_base64(image_base64: str, prefer_mrz: bool = False) -> dict:
    qr = decode_qr_from_base64(image_base64)
    if qr.get("cedula"):
        return qr

    mrz = _decode_mrz_from_base64(image_base64)
    if mrz.get("cedula"):
        return mrz

    pdf417 = decode_barcode_from_base64(image_base64)
    if pdf417.get("cedula"):
        pdf417["source"] = "pdf417"
        return pdf417

    return {
        "ok": False,
        "error": qr.get("error") or pdf417.get("error") or mrz.get("error") or "No se detecto PDF417, QR ni MRZ",
        "raw": "",
        "cedula": "",
        "parsed": mrz.get("parsed") or {},
        "format": "",
        "source": "",
        "candidates": (pdf417.get("candidates") or [])[:3] + (qr.get("candidates") or [])[:3],
        "raw_mrz": mrz.get("raw_mrz") or [],
        "mrz_valido": False,
    }


def decode_barcode_from_base64(image_base64: str) -> dict:
    try:
        img_bytes = _decode_b64(image_base64)
        image = Image.open(io.BytesIO(img_bytes))
        image.load()
    except Exception as exc:
        return {"ok": False, "error": f"No se pudo abrir la imagen: {exc}", "raw": "", "cedula": "", "parsed": {}}

    # Reducir fotos grandes evita lecturas lentas e inestables en ZXing.
    # Las fotos de cámaras modernas (3000px o más) saturan y confunden a ZXing.
    # Una anchura máxima de 1000px a 1200px es el punto dulce para PDF417.
    MAX_WIDTH = 1200
    if image.width > MAX_WIDTH:
        ratio = MAX_WIDTH / float(image.width)
        new_height = int(float(image.height) * ratio)
        image = image.resize((MAX_WIDTH, new_height), Image.Resampling.LANCZOS)

    seen: set[str] = set()
    all_raw: List[str] = []

    # 1. Intento rápido sobre la imagen normalizada.
    try:
        results = zxingcpp.read_barcodes(
            image,
            formats=zxingcpp.BarcodeFormat.PDF417,
            try_rotate=True,       
            try_downscale=True,  # Activamos el escalado interno de ZXing
        )
    except Exception as e:
        results = []

    if results:
        for result in results:
            raw, raw_bytes = _barcode_raw(result)
            if raw:
                parsed = parse_pdf417_bytes(raw_bytes, raw) if raw_bytes else parse_pdf417(raw)
                cedula = parsed.get("cedula") or extract_cedula(raw) or ""
                if cedula:
                    return {
                        "ok": True, "raw": raw, "cedula": cedula, "parsed": parsed,
                        "format": str(getattr(result, "format", "")), "candidates": [raw]
                    }

    # 2. Pipeline de filtros ultraligero (solo si el primero falla)
    for i, variant in enumerate(_variants(image)):
        # Si la variante es muy grande, también la controlamos
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
                    "ok": True, "raw": raw, "cedula": cedula, "parsed": parsed,
                    "format": str(getattr(result, "format", "")), "candidates": all_raw[:5],
                }

    return {
        "ok": False, "error": "No se detectó PDF417 válido", "raw": "", "cedula": "", "parsed": {}, "candidates": all_raw[:5]
    }
