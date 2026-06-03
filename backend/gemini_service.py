from __future__ import annotations

import base64
import io
import json
import os
import re
from typing import Any, Dict, Optional

import requests

from cedula_parser import clean_cedula

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - Pillow is already required by OCR
    Image = None  # type: ignore
    ImageOps = None  # type: ignore


GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-2.5-flash"

PROMPT = """
Eres un extractor estricto de documentos de identidad colombianos.
Analiza la imagen y responde UNICAMENTE JSON valido, sin markdown.

Si la imagen no parece una cedula de ciudadania colombiana, tarjeta fisica colombiana,
cedula digital colombiana o pasaporte colombiano, responde:
{"ok":false,"error":"no_es_documento_colombiano","confianza":0}

Si si es documento colombiano, responde con este esquema:
{
  "ok": true,
  "cedula": "numero sin puntos ni espacios",
  "nombres": "NOMBRES EN MAYUSCULA",
  "primer_apellido": "APELLIDO1",
  "segundo_apellido": "APELLIDO2 o null",
  "fecha_nacimiento": "YYYYMMDD o null",
  "fecha_expedicion": "YYYYMMDD o null",
  "fecha_expiracion": "YYYYMMDD o null",
  "genero": "M o F o null",
  "tipo_sangre": "O+ / O- / A+ / A- / B+ / B- / AB+ / AB- o null",
  "lugar_nacimiento": "CIUDAD o null",
  "lugar_expedicion": "CIUDAD o null",
  "confianza": 0.0
}

Reglas:
- No inventes campos. Si no se ve claro, usa null.
- La cedula debe tener 5 a 11 digitos y no debe parecer fecha.
- Usa solo caracteres de texto y numeros; no incluyas explicaciones.
"""


def gemini_config() -> Dict[str, Any]:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    enabled_env = os.environ.get("GEMINI_ENABLED", "auto").strip().lower()
    enabled = bool(api_key) if enabled_env == "auto" else enabled_env in {"1", "true", "yes", "on"}
    return {
        "enabled": enabled and bool(api_key),
        "configured": bool(api_key),
        "model": os.environ.get("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL,
        "timeout_seconds": float(os.environ.get("GEMINI_TIMEOUT_SECONDS", "18")),
        "min_confidence": float(os.environ.get("GEMINI_MIN_CONFIDENCE", "0.55")),
        "mode": os.environ.get("GEMINI_OCR_MODE", "auto").strip().lower() or "auto",
    }


def gemini_dependency_status() -> Dict[str, Any]:
    cfg = gemini_config()
    return {
        "configured": cfg["configured"],
        "enabled": cfg["enabled"],
        "model": cfg["model"],
        "mode": cfg["mode"],
        "min_confidence": cfg["min_confidence"],
        "timeout_seconds": cfg["timeout_seconds"],
    }


def _normalize_date(value: Any) -> str:
    text = re.sub(r"\D", "", str(value or ""))
    if len(text) == 8 and text[:2] in {"19", "20"}:
        return text
    return ""


def _clean_text(value: Any) -> str:
    text = str(value or "").upper()
    text = re.sub(r"[^A-ZÁÉÍÓÚÜÑ\s.'-]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _clean_blood(value: Any) -> str:
    text = str(value or "").upper().replace(" ", "")
    return text if re.fullmatch(r"(A|B|AB|O)[+-]", text) else ""


def _prepare_image(image_bytes: bytes) -> tuple[str, str]:
    if Image is None:
        return base64.b64encode(image_bytes).decode("ascii"), "image/jpeg"

    img = Image.open(io.BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img).convert("RGB")
    max_side = max(img.size)
    if max_side > 1800:
        scale = 1800 / max_side
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=82, optimize=True)
    return base64.b64encode(out.getvalue()).decode("ascii"), "image/jpeg"


def _extract_text(data: Dict[str, Any]) -> str:
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    texts = [part.get("text", "") for part in parts if isinstance(part, dict) and part.get("text")]
    return "\n".join(texts).strip()


def _parse_json_response(text: str) -> Dict[str, Any]:
    cleaned = text.strip().replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except Exception:
        match = re.search(r"\{.*\}", cleaned, re.S)
        if not match:
            raise
        return json.loads(match.group(0))


def _parsed_from_gemini(payload: Dict[str, Any]) -> Dict[str, str]:
    return {
        "cedula": clean_cedula(payload.get("cedula")) or "",
        "nombres": _clean_text(payload.get("nombres")),
        "primer_apellido": _clean_text(payload.get("primer_apellido")),
        "segundo_apellido": _clean_text(payload.get("segundo_apellido")),
        "genero": _clean_text(payload.get("genero"))[:1],
        "fecha_nacimiento": _normalize_date(payload.get("fecha_nacimiento")),
        "fecha_expiracion": _normalize_date(payload.get("fecha_expiracion")),
        "tipo_sangre": _clean_blood(payload.get("tipo_sangre")),
        "formato_detectado": "gemini_vision",
    }


def analyze_cedula_with_gemini(image_bytes: bytes) -> Dict[str, Any]:
    cfg = gemini_config()
    if not cfg["enabled"]:
        return {"ok": False, "error": "gemini_no_configurado", "cedula": "", "parsed": {}}

    inline_data, mime_type = _prepare_image(image_bytes)
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": PROMPT},
                    {"inline_data": {"mime_type": mime_type, "data": inline_data}},
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 768,
            "response_mime_type": "application/json",
        },
    }

    url = GEMINI_API_URL.format(model=cfg["model"])
    try:
        response = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": os.environ.get("GEMINI_API_KEY", "").strip(),
            },
            json=body,
            timeout=cfg["timeout_seconds"],
        )
        if response.status_code >= 400:
            return {
                "ok": False,
                "error": "gemini_http_error",
                "status": response.status_code,
                "cedula": "",
                "parsed": {},
            }
        data = response.json()
        text = _extract_text(data)
        parsed_json = _parse_json_response(text)
    except Exception as exc:
        return {"ok": False, "error": f"gemini_error: {exc}", "cedula": "", "parsed": {}}

    confidence = float(parsed_json.get("confianza") or parsed_json.get("confidence") or 0)
    parsed = _parsed_from_gemini(parsed_json)
    cedula = parsed.get("cedula") or ""
    ok = bool(parsed_json.get("ok", bool(cedula))) and bool(cedula) and confidence >= cfg["min_confidence"]
    return {
        "ok": ok,
        "cedula": cedula if ok else "",
        "texto_completo": json.dumps(parsed_json, ensure_ascii=False),
        "pipeline_usado": "gemini_vision",
        "parsed": parsed if ok else {},
        "gemini": {
            "model": cfg["model"],
            "confidence": confidence,
            "enabled": True,
        },
        "error": "" if ok else (parsed_json.get("error") or "gemini_confianza_baja"),
    }


def should_use_gemini(local_result: Dict[str, Any]) -> bool:
    cfg = gemini_config()
    if not cfg["enabled"] or cfg["mode"] == "off":
        return False
    if cfg["mode"] == "always":
        return True
    parsed = local_result.get("parsed") or {}
    has_name = bool(parsed.get("nombres") or parsed.get("primer_apellido"))
    return not local_result.get("cedula") or not has_name
