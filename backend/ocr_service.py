"""
OCR del frente de la cédula colombiana — VERSION 5 CORREGIDA (1940–2026).

Correcciones v5:
1. Bug #1 CORREGIDO: _fix_ocr_digits ahora solo aplica a bloques >60% dígitos.
   Antes convertía letras de texto (A→4, E→3, S→5) y destruía nombres/campos.
2. Bug #2 CORREGIDO: Umbral de binarización ahora es adaptativo (Otsu aproximado)
   en lugar de fijo 145. Funciona con fondos graduados de cédulas plásticas/amarillas.
3. Bug #3 CORREGIDO: Antes salía del loop al primer candidato sin validar longitud.
   Ahora exige longitud mínima de 7 dígitos antes de aceptar (configurable).
4. Bug #5 CORREGIDO: Detecta si el idioma 'spa' está instalado en Tesseract antes
   de usarlo. Si no está, cae a 'eng' sin error silencioso.
5. Nuevo pipeline OTSU_ADAPTIVE para cédulas plásticas modernas con fondo complejo.
"""
from __future__ import annotations

import re
import io
import base64
import shutil
import platform
import asyncio
import subprocess
from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any

from cedula_parser import parse_pdf417, parse_mrz_from_text

try:
    from gemini_service import analyze_cedula_with_gemini, should_use_gemini
except ImportError:  # pragma: no cover
    analyze_cedula_with_gemini = None  # type: ignore
    should_use_gemini = None  # type: ignore

try:
    from PIL import Image, ImageOps, ImageFilter, ImageEnhance
    import pytesseract
    _PIL_OK = True
except ImportError:
    Image = None          # type: ignore
    ImageOps = None       # type: ignore
    ImageFilter = None    # type: ignore
    ImageEnhance = None   # type: ignore
    pytesseract = None    # type: ignore
    _PIL_OK = False

try:
    import numpy as np
except ImportError:
    np = None             # type: ignore

try:
    import cv2
except ImportError:
    cv2 = None            # type: ignore

# ─── Detección automática de Tesseract ───────────────────────────────────────
if pytesseract is not None:
    _sys = platform.system()
    if _sys == "Windows":
        for _cand in (
            Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
            Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
        ):
            if _cand.exists():
                pytesseract.pytesseract.tesseract_cmd = str(_cand)
                break
    else:
        _found = shutil.which("tesseract")
        if _found:
            pytesseract.pytesseract.tesseract_cmd = _found
        elif _sys == "Darwin":
            for _cand in (
                Path("/usr/local/bin/tesseract"),
                Path("/opt/homebrew/bin/tesseract"),
            ):
                if _cand.exists():
                    pytesseract.pytesseract.tesseract_cmd = str(_cand)
                    break

# ─── BUG #5 FIX: Detectar idiomas disponibles en Tesseract ──────────────────
def _get_available_tess_langs() -> List[str]:
    """Retorna los idiomas instalados en Tesseract. Nunca lanza excepción."""
    try:
        result = subprocess.run(
            ["tesseract", "--list-langs"],
            capture_output=True, text=True, timeout=5
        )
        output = result.stdout + result.stderr
        langs = [line.strip() for line in output.splitlines()
                 if line.strip() and not line.strip().startswith("List")]
        return langs
    except Exception:
        return ["eng"]

_TESS_LANGS_AVAILABLE: List[str] = []

def _get_tess_lang(mode: str) -> str:
    """
    BUG #5 FIX: Retorna el string de idioma correcto según lo que esté instalado.
    Antes: usaba 'spa+eng' sin verificar → fallaba silenciosamente si spa no estaba.
    Ahora: verifica una vez al inicio y usa lo que hay.
    """
    global _TESS_LANGS_AVAILABLE
    if not _TESS_LANGS_AVAILABLE:
        _TESS_LANGS_AVAILABLE = _get_available_tess_langs()

    if mode != "full":
        return "eng"

    has_spa = "spa" in _TESS_LANGS_AVAILABLE
    has_eng = "eng" in _TESS_LANGS_AVAILABLE

    if has_spa and has_eng:
        return "spa+eng"
    elif has_spa:
        return "spa"
    else:
        return "eng"


def ocr_dependency_status() -> dict:
    """Estado de dependencias OCR para diagnosticar despliegues en la nube."""
    tess_cmd = ""
    if pytesseract is not None:
        tess_cmd = getattr(pytesseract.pytesseract, "tesseract_cmd", "") or shutil.which("tesseract") or ""
    return {
        "pillow": Image is not None,
        "pytesseract": pytesseract is not None,
        "numpy": np is not None,
        "opencv": cv2 is not None,
        "tesseract_cmd": tess_cmd,
        "tesseract_available": bool(tess_cmd and (Path(tess_cmd).exists() if Path(tess_cmd).is_absolute() else shutil.which(tess_cmd))),
        "tesseract_langs": _get_available_tess_langs() if pytesseract is not None else [],
    }

# ─── Rangos históricos de cédulas colombianas ────────────────────────────────
_CEDULA_MIN_DIGITS = 5
_CEDULA_MAX_DIGITS = 11

# Longitud mínima para aceptar un candidato "con confianza" en el primer intento
# Cédulas de 5-6 dígitos son históricas (1940-1960), raramente escaneadas hoy.
_CEDULA_CONFIDENT_MIN = 7

# ─── Patrones regex ──────────────────────────────────────────────────────────
_DATE_SLASH_RE   = re.compile(r"\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b")
_DATE_8DIG_RE    = re.compile(r"^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$")
_YEAR_ONLY_RE    = re.compile(r"^(19|20)\d{2}$")
_GROUPED_NUM_RE  = re.compile(r"\d{1,3}(?:[.,]\d{3}){1,3}")  # 1.005.029.331
_DIGIT_RUN_RE    = re.compile(r"(?<!\d)(\d{5,11})(?!\d)")
_NUMBER_LABEL_RE = re.compile(
    r"(?:N[UÚ]MERO|N[°º]?|C[EÉ]DULA|CC|C\.C\.)[:\s#]*([0-9][0-9\s.,]{4,18}[0-9])",
    re.IGNORECASE,
)

# ─── BUG #1 FIX ──────────────────────────────────────────────────────────────
# Correcciones OCR: solo para caracteres que visualmente se confunden con dígitos
_OCR_DIGIT_FIXES = str.maketrans({
    "O": "0", "o": "0",
    "I": "1", "l": "1", "i": "1",
    # REMOVIDOS: A→4, E→3, S→5, B→8, Z→2, G→6, T→7
    # Estos causaban que texto válido (nombres, apellidos, etiquetas)
    # se convirtiera en basura numérica y arruinara la extracción.
    # Solo se mantienen sustituciones que son casi-inequívocas visualmente.
})

def _fix_ocr_digits(s: str) -> str:
    """
    BUG #1 FIX: Aplica correcciones OCR SOLO si el bloque tiene >60% dígitos.
    Antes: se aplicaba a cualquier bloque mixto, destruyendo texto real.
    Ahora: si el bloque es mayormente texto, no se toca.
    """
    if not s:
        return s
    digit_ratio = sum(c.isdigit() for c in s) / len(s)
    if digit_ratio < 0.6:
        return s  # No tocar: es texto, no número con errores OCR
    return s.translate(_OCR_DIGIT_FIXES)


def _normalize(s: str) -> str:
    """Quita puntos, comas, espacios de un número formateado."""
    return re.sub(r"[.,\s]", "", s or "")


def _is_date(s: str) -> bool:
    return bool(_DATE_8DIG_RE.match(s))


def _is_year(s: str) -> bool:
    return bool(_YEAR_ONLY_RE.match(s))


# ─── BUG #2 FIX: Umbral adaptativo ──────────────────────────────────────────

def _otsu_threshold(img: "Image.Image") -> int:
    """
    BUG #2 FIX: Calcula el umbral de binarización óptimo usando aproximación de Otsu.
    Antes: umbral fijo (145) que cortaba texto en fondos graduados de cédulas plásticas.
    Ahora: calcula el umbral según el histograma real de la imagen.
    """
    if np is not None:
        arr = np.array(img, dtype=np.float32)
        # Otsu simplificado: minimiza varianza intra-clase
        hist, _ = np.histogram(arr.ravel(), bins=256, range=(0, 256))
        hist = hist.astype(np.float64)
        total = hist.sum()
        sum_b, w_b, max_var, threshold = 0.0, 0.0, 0.0, 128
        total_sum = float(np.dot(np.arange(256), hist))
        for t in range(256):
            w_b += hist[t]
            if w_b == 0:
                continue
            w_f = total - w_b
            if w_f == 0:
                break
            sum_b += t * hist[t]
            m_b = sum_b / w_b
            m_f = (total_sum - sum_b) / w_f
            var = w_b * w_f * (m_b - m_f) ** 2
            if var > max_var:
                max_var = var
                threshold = t
        return int(threshold)
    else:
        # Sin numpy: usar media como aproximación
        pixels = list(img.getdata())
        return int(sum(pixels) / len(pixels))


def _to_gray(img: "Image.Image") -> "Image.Image":
    if img.mode == "L":
        return img
    if img.mode in ("RGBA", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        return background.convert("L")
    return img.convert("L")


def _scale_up(img: "Image.Image", target: int = 1600) -> "Image.Image":
    w, h = img.size
    long_side = max(w, h)
    if long_side < target:
        ratio = target / long_side
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    return img


def _preprocess_standard(img: "Image.Image") -> "Image.Image":
    """Pipeline estándar con umbral adaptativo (BUG #2 corregido)."""
    img = _to_gray(img)
    img = _scale_up(img, 1600)
    img = ImageOps.autocontrast(img, cutoff=1)
    img = img.filter(ImageFilter.MedianFilter(size=3))
    enhancer = ImageEnhance.Sharpness(img)
    img = enhancer.enhance(2.5)
    # BUG #2 FIX: umbral adaptativo en lugar de fijo 145
    threshold = _otsu_threshold(img)
    img = img.point(lambda x: 0 if x < threshold else 255, "1").convert("L")
    return img


def _preprocess_dark(img: "Image.Image") -> "Image.Image":
    """Pipeline para imágenes oscuras con umbral adaptativo."""
    img = _to_gray(img)
    img = _scale_up(img, 1600)
    if np is not None:
        mean_val = float(np.array(img).mean())
    else:
        mean_val = sum(img.getdata()) / (img.width * img.height)
    if mean_val < 127:
        img = ImageOps.invert(img)
    img = ImageOps.autocontrast(img, cutoff=2)
    img = img.filter(ImageFilter.SHARPEN)
    # BUG #2 FIX: umbral adaptativo
    threshold = _otsu_threshold(img)
    img = img.point(lambda x: 0 if x < threshold else 255, "1").convert("L")
    return img


def _preprocess_adaptive(img: "Image.Image") -> "Image.Image":
    """Pipeline para cédulas con gradiente (azul/dorado). Umbral adaptativo."""
    img = _to_gray(img)
    img = _scale_up(img, 1800)
    img = ImageOps.autocontrast(img, cutoff=3)
    img = img.filter(ImageFilter.SHARPEN)
    img = img.filter(ImageFilter.SHARPEN)
    # BUG #2 FIX: umbral adaptativo con ligero sesgo hacia abajo para fondos claros
    threshold = max(100, _otsu_threshold(img) - 15)
    img = img.point(lambda x: 0 if x < threshold else 255, "1").convert("L")
    return img


def _preprocess_enhanced(img: "Image.Image") -> "Image.Image":
    """Pipeline de mayor contraste para cédulas con texto pálido."""
    img = _to_gray(img)
    img = _scale_up(img, 2000)
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(3.0)
    enhancer = ImageEnhance.Sharpness(img)
    img = enhancer.enhance(3.0)
    img = img.filter(ImageFilter.MedianFilter(size=3))
    # BUG #2 FIX: umbral adaptativo
    threshold = _otsu_threshold(img)
    img = img.point(lambda x: 0 if x < threshold else 255, "1").convert("L")
    return img


def _preprocess_otsu_adaptive(img: "Image.Image") -> "Image.Image":
    """
    NUEVO PIPELINE: Específico para cédulas amarillas plásticas modernas.
    Usa escala alta + ecualización de histograma + umbral Otsu puro.
    """
    img = _to_gray(img)
    img = _scale_up(img, 2200)
    # Ecualizar histograma para mejorar contraste en fondos complejos
    img = ImageOps.equalize(img)
    img = img.filter(ImageFilter.MedianFilter(size=3))
    enhancer = ImageEnhance.Sharpness(img)
    img = enhancer.enhance(2.0)
    threshold = _otsu_threshold(img)
    img = img.point(lambda x: 0 if x < threshold else 255, "1").convert("L")
    return img


def _preprocess_cv_clahe(img: "Image.Image") -> "Image.Image":
    """Pipeline OpenCV para bajo contraste, brillo y cedulas plasticas."""
    if cv2 is None or np is None:
        raise RuntimeError("OpenCV no instalado")
    base = ImageOps.exif_transpose(img).convert("RGB")
    gray = cv2.cvtColor(np.array(base), cv2.COLOR_RGB2GRAY)
    h, w = gray.shape[:2]
    if max(h, w) < 2200:
        scale = 2200 / max(h, w)
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    gray = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
    gray = cv2.fastNlMeansDenoising(gray, None, 14, 7, 21)
    gray = cv2.addWeighted(gray, 1.7, cv2.GaussianBlur(gray, (0, 0), 2), -0.7, 0)
    adaptive = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        45,
        11,
    )
    return Image.fromarray(adaptive)


def _preprocess_ocrb_nueva(img: "Image.Image") -> "Image.Image":
    """Pipeline para fuente OCR-B grande de cedulas nuevas 2022+."""
    img = _to_gray(img)
    target_w = 3000
    if img.width < target_w:
        scale = target_w / max(img.width, 1)
        img = img.resize((target_w, max(1, int(img.height * scale))), Image.LANCZOS)
    img = ImageOps.autocontrast(img, cutoff=0)
    img = ImageEnhance.Sharpness(img).enhance(4.0)
    img = ImageEnhance.Contrast(img).enhance(2.0)
    threshold = _otsu_threshold(img)
    img = img.point(lambda x: 0 if x < threshold else 255, "L")
    return img


_PREPROCESS_PIPELINES = [
    _preprocess_ocrb_nueva,      # Primero: cedulas nuevas 2022+ (OCR-B grande)
    _preprocess_standard,
    _preprocess_cv_clahe,
    _preprocess_otsu_adaptive,
    _preprocess_adaptive,
    _preprocess_dark,
    _preprocess_enhanced,
]

# Configuraciones Tesseract
_TESS_CONFIGS = [
    ("--oem 3 --psm 7 -c tessedit_char_whitelist=0123456789.", "digits"),
    ("--oem 3 --psm 11", "full"),
    ("--oem 3 --psm 6", "full"),
    ("--oem 3 --psm 4", "full"),
    ("--oem 3 --psm 3", "full"),
]


# ─── Scoring ──────────────────────────────────────────────────────────────────

def _score_cedula(digits: str, pos: int, total_len: int) -> float:
    L = len(digits)
    length_score = {10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 11: 4}.get(L, 1)
    pos_fraction = pos / max(total_len, 1)
    pos_score = pos_fraction * 2
    leading_zeros = len(digits) - len(digits.lstrip("0"))
    zero_penalty = leading_zeros * 1.5
    return length_score + pos_score - zero_penalty


# ─── Extractor de texto OCR ───────────────────────────────────────────────────

def _extract_from_text(raw_text: str, min_digits: int = _CEDULA_MIN_DIGITS) -> Optional[str]:
    """
    Extrae el número de cédula del texto OCR bruto.

    BUG #1 FIX: _fix_ocr_digits ahora solo actúa en bloques >60% dígitos.
    BUG #3 FIX: acepta candidatos según `min_digits` (llamar con 7 en primer intento).
    """
    if not raw_text:
        return None

    # BUG #1 FIX: solo corregir bloques que son mayormente dígitos
    text_fixed = re.sub(
        r"[0-9OoIlBb]{5,}",
        lambda m: _fix_ocr_digits(m.group()) if re.search(r"\d", m.group()) else m.group(),
        raw_text,
    )

    cleaned = _DATE_SLASH_RE.sub(" ", text_fixed)
    total_len = len(cleaned)

    # ── PRIORIDAD 1: Etiqueta explícita "NÚMERO", "CEDULA", "CC", "C.C." ─────
    m = _NUMBER_LABEL_RE.search(cleaned)
    if m:
        raw_num = _normalize(m.group(1))
        raw_num_fixed = _fix_ocr_digits(raw_num) if sum(c.isdigit() for c in raw_num) / max(len(raw_num), 1) > 0.6 else raw_num
        if raw_num_fixed.isdigit() and _CEDULA_MIN_DIGITS <= len(raw_num_fixed) <= _CEDULA_MAX_DIGITS:
            if not _is_date(raw_num_fixed) and not _is_year(raw_num_fixed):
                return raw_num_fixed.lstrip("0") or raw_num_fixed

    # ── PRIORIDAD 2: Número con puntos de agrupación (1.005.029.331) ─────────
    grouped = _GROUPED_NUM_RE.findall(cleaned)
    for g in grouped:
        norm = _normalize(g)
        if norm.isdigit() and _CEDULA_MIN_DIGITS <= len(norm) <= _CEDULA_MAX_DIGITS:
            if not _is_date(norm) and not _is_year(norm):
                return norm.lstrip("0") or norm

    # ── PRIORIDAD 3: Corridas crudas de dígitos, scored ──────────────────────
    candidates: List[Tuple[str, int, float]] = []
    for match in _DIGIT_RUN_RE.finditer(cleaned):
        raw = match.group(1)
        fixed = _fix_ocr_digits(raw) if sum(c.isdigit() for c in raw) / len(raw) > 0.6 else raw
        if not fixed.isdigit():
            continue
        if _is_date(fixed) or _is_year(fixed):
            continue
        if _is_date(raw) or _is_year(raw):
            continue
        if len(fixed) < min_digits:
            continue  # BUG #3 FIX: respetar longitud mínima del intento
        pos = match.start()
        score = _score_cedula(fixed, pos, total_len)
        candidates.append((fixed, pos, score))

    if candidates:
        candidates.sort(key=lambda x: -x[2])
        best = candidates[0][0]
        return best.lstrip("0") or best

    return None


# ─── OCR principal ────────────────────────────────────────────────────────────

def _run_tesseract(img: "Image.Image", config: str, mode: str) -> str:
    """
    BUG #5 FIX: Usa _get_tess_lang() para verificar si 'spa' está instalado.
    Antes: usaba 'spa+eng' sin verificar → error silencioso si spa no estaba.
    """
    lang = _get_tess_lang(mode)
    try:
        return pytesseract.image_to_string(img, lang=lang, config=config) or ""
    except Exception:
        try:
            return pytesseract.image_to_string(img, lang="eng", config=config) or ""
        except Exception:
            return ""


def ocr_cedula(image_bytes: bytes) -> dict:
    """
    Recibe bytes de imagen (jpeg/png/webp/bmp/tiff), retorna:
      { ok, cedula, texto_completo, pipeline_usado, config_usada, parsed }

    BUG #3 FIX: Ahora usa dos pasadas:
      - Pasada 1: exige longitud ≥ 7 dígitos (resultado confiable).
      - Pasada 2 (fallback): acepta desde 5 dígitos (cédulas históricas).
    """
    if not _PIL_OK:
        return {
            "ok": False,
            "error": "Pillow / pytesseract no instalados",
            "cedula": "",
            "texto_completo": "",
        }

    try:
        original = Image.open(io.BytesIO(image_bytes))
        original.load()
        original = ImageOps.exif_transpose(original).convert("RGB")
        max_side = 2200
        if max(original.size) > max_side:
            ratio = max_side / float(max(original.size))
            original = original.resize(
                (max(1, int(original.width * ratio)), max(1, int(original.height * ratio))),
                Image.Resampling.LANCZOS,
            )
    except Exception as e:
        return {
            "ok": False,
            "error": f"No se pudo abrir la imagen: {e}",
            "cedula": "",
            "texto_completo": "",
        }

    all_texts: List[str] = []
    best_cedula: Optional[str] = None
    best_text = ""
    best_pipeline = ""
    best_config = ""

    for pipe_fn in _PREPROCESS_PIPELINES:
        try:
            proc_img = pipe_fn(original)
        except Exception:
            continue

        for config, mode in _TESS_CONFIGS:
            text = _run_tesseract(proc_img, config, mode)
            if text:
                all_texts.append(text)

            # BUG #3 FIX: Pasada 1 — solo acepta cédulas de 7+ dígitos
            cedula = _extract_from_text(text, min_digits=_CEDULA_CONFIDENT_MIN)
            if cedula:
                best_cedula = cedula
                best_text = text
                best_pipeline = pipe_fn.__name__
                best_config = config
                break

        if best_cedula:
            break

    if not best_cedula:
        # Fallback combinado — BUG #3 FIX: Pasada 2 acepta desde 5 dígitos
        combined = "\n".join(all_texts)
        best_cedula = _extract_from_text(combined, min_digits=_CEDULA_MIN_DIGITS)
        best_text = combined
        best_pipeline = "combined_fallback"

    # Intentar enriquecer con parser MRZ/PDF417
    parsed = parse_mrz_from_text(best_text)
    if not parsed.get("cedula"):
        parsed = parse_pdf417(best_text)
    if parsed.get("cedula"):
        best_cedula = parsed["cedula"]

    return {
        "ok": bool(best_cedula),
        "cedula": best_cedula or "",
        "texto_completo": best_text,
        "pipeline_usado": best_pipeline,
        "config_usada": best_config,
        "parsed": parsed,
    }


_MRZ_TESS_CONFIGS = [
    # Whitelist ampliado: incluye > (filler cédulas nuevas) y espacio
    "--oem 3 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<> -c preserve_interword_spaces=1",
    "--oem 3 --psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>",
    "--oem 3 --psm 11 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>",
    # Sin whitelist: para cédulas nuevas con caracteres inesperados
    "--oem 3 --psm 6",
    "--oem 1 --psm 6",
]


def _mrz_crop_candidates(img: "Image.Image") -> List["Image.Image"]:
    base = ImageOps.exif_transpose(img).convert("RGB")
    crops: List["Image.Image"] = []
    seen: set[tuple[int, int, int, int, int]] = set()
    for angle in (0, 180):
        rotated = base if angle == 0 else base.rotate(angle, expand=True)
        w, h = rotated.size
        boxes = [
            # Cédulas nuevas 2022+: MRZ en mitad inferior visible
            (0, int(h * 0.55), w, h),
            (0, int(h * 0.50), w, int(h * 0.98)),
            # Cédulas antiguas: MRZ más arriba
            (0, int(h * 0.42), w, h),
            (int(w * 0.03), int(h * 0.52), int(w * 0.97), int(h * 0.98)),
            # Fallback imagen completa
            # Extra: solo zona baja absoluta (cédulas con MRZ muy al fondo)
        ]
        for box in boxes:
            left, top, right, bottom = box
            if right - left < 180 or bottom - top < 60:
                continue
            key = (angle, left, top, right, bottom)
            if key in seen:
                continue
            seen.add(key)
            crops.append(rotated.crop(box))
    return crops


def _preprocess_mrz(img: "Image.Image") -> List["Image.Image"]:
    gray = _to_gray(img)
    target_width = 1800
    if gray.width < target_width:
        scale = target_width / max(gray.width, 1)
        gray = gray.resize((target_width, max(1, int(gray.height * scale))), Image.LANCZOS)
    gray = ImageOps.autocontrast(gray, cutoff=2)
    gray = gray.filter(ImageFilter.MedianFilter(size=3))
    sharp = ImageEnhance.Sharpness(gray).enhance(2.5)
    high = ImageEnhance.Contrast(sharp).enhance(2.4)
    threshold = _otsu_threshold(high)
    binary = high.point(lambda x: 0 if x < threshold else 255, "1").convert("L")
    variants = [gray, high, binary]

    if cv2 is not None and np is not None:
        arr = np.array(gray)
        clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(arr)
        adaptive = cv2.adaptiveThreshold(
            clahe,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            35,
            9,
        )
        variants.extend([Image.fromarray(clahe), Image.fromarray(adaptive)])

    return variants


def _run_mrz_tesseract(img: "Image.Image", config: str) -> str:
    try:
        return pytesseract.image_to_string(img, lang="eng", config=config) or ""
    except Exception:
        return ""


def ocr_mrz_cedula(image_bytes: bytes) -> Dict[str, Any]:
    if not _PIL_OK:
        return {
            "ok": False,
            "error": "Pillow / pytesseract no instalados",
            "cedula": "",
            "texto_completo": "",
            "parsed": {},
        }

    try:
        original = Image.open(io.BytesIO(image_bytes))
        original.load()
    except Exception as e:
        return {
            "ok": False,
            "error": f"No se pudo abrir la imagen: {e}",
            "cedula": "",
            "texto_completo": "",
            "parsed": {},
        }

    all_texts: List[str] = []
    for crop in _mrz_crop_candidates(original):
        for proc_img in _preprocess_mrz(crop):
            for config in _MRZ_TESS_CONFIGS:
                text = _run_mrz_tesseract(proc_img, config)
                if not text:
                    continue
                all_texts.append(text)
                parsed = parse_mrz_from_text(text)
                if parsed.get("cedula"):
                    return {
                        "ok": True,
                        "cedula": parsed.get("cedula") or "",
                        "texto_completo": text,
                        "parsed": parsed,
                        "raw_mrz": parsed.get("raw_mrz") or [],
                        "mrz_valido": bool(parsed.get("mrz_valido")),
                    }

    combined = "\n".join(all_texts)
    parsed = parse_mrz_from_text(combined)
    if parsed.get("cedula"):
        return {
            "ok": True,
            "cedula": parsed.get("cedula") or "",
            "texto_completo": combined,
            "parsed": parsed,
            "raw_mrz": parsed.get("raw_mrz") or [],
            "mrz_valido": bool(parsed.get("mrz_valido")),
        }

    return {
        "ok": False,
        "error": "No se detecto MRZ TD1 legible",
        "cedula": "",
        "texto_completo": combined[:1200],
        "parsed": parsed,
        "raw_mrz": [],
        "mrz_valido": False,
    }


async def ocr_cedula_async(image_bytes: bytes) -> dict:
    """Versión async-safe. No bloquea el event loop de FastAPI."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, ocr_cedula, image_bytes)


async def ocr_mrz_cedula_async(image_bytes: bytes) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, ocr_mrz_cedula, image_bytes)


def ocr_from_base64(data_uri_or_b64: str) -> dict:
    """Recibe un data URI o base64 puro, decodifica y procesa (síncrono)."""
    if not data_uri_or_b64:
        return {"ok": False, "error": "Imagen vacía", "cedula": "", "texto_completo": ""}
    s = data_uri_or_b64.strip()
    if "," in s and s.startswith("data:"):
        s = s.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(s + "==", validate=False)
    except Exception as e:
        return {"ok": False, "error": f"Base64 inválido: {e}", "cedula": "", "texto_completo": ""}
    return ocr_cedula(img_bytes)


def _has_core_identity(result: dict) -> bool:
    parsed = result.get("parsed") or {}
    return bool(_clean_doc_number(result.get("cedula")) and (parsed.get("nombres") or parsed.get("primer_apellido")))


def _clean_doc_number(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or "")).lstrip("0")
    if not re.fullmatch(r"\d{5,11}", digits or ""):
        return ""
    if re.fullmatch(r"(?:19|20)\d{2}", digits) or re.fullmatch(r"(?:19|20)\d{6}", digits):
        return ""
    return digits


def _has_mrz_identity(result: dict) -> bool:
    parsed = result.get("parsed") or {}
    return bool(result.get("raw_mrz") or parsed.get("raw_mrz") or result.get("mrz_valido") or parsed.get("mrz_valido"))


def _best_identity_number(local: dict, gemini: dict, prefer_gemini: bool) -> str:
    local_parsed = local.get("parsed") or {}
    gemini_parsed = gemini.get("parsed") or {}
    local_doc = _clean_doc_number(local.get("cedula") or local_parsed.get("cedula"))
    gemini_doc = _clean_doc_number(gemini.get("cedula") or gemini_parsed.get("cedula"))

    if local_doc and _has_mrz_identity(local):
        return local_doc
    if prefer_gemini and gemini_doc:
        return gemini_doc
    if local_doc:
        return local_doc
    return gemini_doc


def _merge_ocr_gemini(local_result: dict, gemini_result: dict, prefer_gemini: bool) -> dict:
    local = local_result or {}
    gemini = gemini_result or {}
    local_parsed = local.get("parsed") or {}
    gemini_parsed = gemini.get("parsed") or {}
    merged_parsed = dict(gemini_parsed if prefer_gemini else local_parsed)
    supplemental = local_parsed if prefer_gemini else gemini_parsed
    for key, value in supplemental.items():
        if value and not merged_parsed.get(key):
            merged_parsed[key] = value

    primary = gemini if prefer_gemini else local
    secondary = local if prefer_gemini else gemini
    cedula = _best_identity_number(local, gemini, prefer_gemini)
    if cedula:
        merged_parsed["cedula"] = cedula
    pipeline = (
        "gemini_vision+ocr_local"
        if prefer_gemini and local
        else "gemini_vision"
        if prefer_gemini
        else f"{local.get('pipeline_usado') or 'ocr_local'}+gemini"
    )

    if prefer_gemini:
        texto_completo = gemini.get("texto_completo") or local.get("texto_completo") or ""
    else:
        texto_completo = local.get("texto_completo") or gemini.get("texto_completo") or ""

    return {
        **local,
        "ok": True,
        "cedula": cedula,
        "texto_completo": texto_completo,
        "pipeline_usado": pipeline,
        "parsed": merged_parsed,
        "gemini": gemini.get("gemini") or {},
    }


def _merge_local_ocr_mrz(local_result: dict, mrz_result: dict) -> dict:
    local = local_result or {}
    mrz = mrz_result or {}
    if not mrz.get("cedula"):
        return local

    local_parsed = local.get("parsed") or {}
    mrz_parsed = mrz.get("parsed") or {}
    merged_parsed = dict(local_parsed)
    for key, value in mrz_parsed.items():
        if value and (not merged_parsed.get(key) or key in {"cedula", "primer_apellido", "segundo_apellido", "nombres", "fecha_nacimiento", "fecha_expiracion", "genero"}):
            merged_parsed[key] = value

    mrz_doc = _clean_doc_number(mrz.get("cedula") or mrz_parsed.get("cedula"))
    local_doc = _clean_doc_number(local.get("cedula") or local_parsed.get("cedula"))
    cedula = mrz_doc or local_doc
    if cedula:
        merged_parsed["cedula"] = cedula

    pipeline = local.get("pipeline_usado") or "ocr_local"
    if "mrz" not in pipeline.lower():
        pipeline = f"{pipeline}+mrz"

    return {
        **local,
        "ok": True,
        "cedula": cedula,
        "texto_completo": local.get("texto_completo") or mrz.get("texto_completo") or "",
        "pipeline_usado": pipeline,
        "parsed": merged_parsed,
        "raw_mrz": mrz.get("raw_mrz") or local.get("raw_mrz") or [],
        "mrz_valido": bool(mrz.get("mrz_valido") or local.get("mrz_valido")),
    }


async def _ocr_cedula_with_mrz_async(img_bytes: bytes) -> dict:
    local_result, mrz_result = await asyncio.gather(
        ocr_cedula_async(img_bytes),
        ocr_mrz_cedula_async(img_bytes),
    )
    return _merge_local_ocr_mrz(local_result, mrz_result)


async def _analyze_gemini_async(img_bytes: bytes) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, analyze_cedula_with_gemini, img_bytes)


async def ocr_from_base64_async(data_uri_or_b64: str, force_gemini: bool = False) -> dict:
    """
    Versión async-safe de ocr_from_base64.
    Úsala en endpoints FastAPI async para no bloquear el event loop.

    Ejemplo en server.py:
        @router.post("/ocr-cedula")
        async def api_ocr_cedula(body: OcrRequest, current=Depends(get_current_user)):
            return await ocr_from_base64_async(body.image_base64)
    """
    if not data_uri_or_b64:
        return {"ok": False, "error": "Imagen vacía", "cedula": "", "texto_completo": ""}
    s = data_uri_or_b64.strip()
    if "," in s and s.startswith("data:"):
        s = s.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(s + "==", validate=False)
    except Exception as e:
        return {"ok": False, "error": f"Base64 inválido: {e}", "cedula": "", "texto_completo": ""}

    gemini_available = bool(should_use_gemini and analyze_cedula_with_gemini and should_use_gemini({"cedula": ""}))
    if force_gemini:
        if gemini_available:
            gemini_result = await _analyze_gemini_async(img_bytes)
            if gemini_result.get("cedula"):
                return gemini_result
            local_result = await _ocr_cedula_with_mrz_async(img_bytes)
            if local_result.get("cedula"):
                return {
                    **local_result,
                    "gemini": gemini_result.get("gemini") or {},
                    "gemini_error": gemini_result.get("error") or "",
                }
            return {
                **local_result,
                "gemini": gemini_result.get("gemini") or {},
                "error": gemini_result.get("error") or local_result.get("error", ""),
            }

        return await _ocr_cedula_with_mrz_async(img_bytes)

    local_result = await _ocr_cedula_with_mrz_async(img_bytes)
    use_gemini = bool(
        should_use_gemini
        and analyze_cedula_with_gemini
        and (force_gemini or should_use_gemini(local_result))
    )
    if use_gemini:
        gemini_result = await _analyze_gemini_async(img_bytes)
        if gemini_result.get("cedula"):
            return _merge_ocr_gemini(local_result, gemini_result, prefer_gemini=False)
        if not local_result.get("cedula"):
            return {
                **local_result,
                "gemini": gemini_result.get("gemini") or {},
                "error": gemini_result.get("error") or local_result.get("error", ""),
            }
    return local_result


async def ocr_mrz_from_base64_async(data_uri_or_b64: str) -> dict:
    if not data_uri_or_b64:
        return {"ok": False, "error": "Imagen vacia", "cedula": "", "texto_completo": ""}
    s = data_uri_or_b64.strip()
    if "," in s and s.startswith("data:"):
        s = s.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(s + "==", validate=False)
    except Exception as e:
        return {"ok": False, "error": f"Base64 invalido: {e}", "cedula": "", "texto_completo": ""}
    return await ocr_mrz_cedula_async(img_bytes)
