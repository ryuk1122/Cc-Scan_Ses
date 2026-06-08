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
Eres un extractor visual experto en cedulas de ciudadania colombianas.
Tu prioridad es leer el NUIP/cedula real, nombres, apellidos y fechas reales.
Analiza una o dos imagenes: frente, reverso o ambos. Responde SOLO JSON valido, sin markdown.
Version interna: cedula_colombia_v3_ia_primero_confianza_040.

Si la imagen no es una cedula/documento colombiano, responde exactamente:
{"ok":false,"error":"no_es_documento_colombiano","confianza":0}

Si si es documento colombiano, responde exactamente este esquema:
{
  "ok": true,
  "cedula": "solo digitos del NUIP real",
  "nombres": "NOMBRES EN MAYUSCULA o null",
  "primer_apellido": "PRIMER APELLIDO EN MAYUSCULA o null",
  "segundo_apellido": "SEGUNDO APELLIDO EN MAYUSCULA o null",
  "fecha_nacimiento": "YYYYMMDD o null",
  "fecha_expedicion": "YYYYMMDD o null",
  "fecha_expiracion": "YYYYMMDD o null",
  "genero": "M o F o null",
  "tipo_sangre": "O+ / O- / A+ / A- / B+ / B- / AB+ / AB- o null",
  "lugar_nacimiento": "CIUDAD o null",
  "lugar_expedicion": "CIUDAD o null",
  "confianza": 0.0
}

Reglas obligatorias para cedula/NUIP:
- El NUIP real tiene entre 5 y 11 digitos. No uses puntos, espacios ni guiones.
- Nunca devuelvas fechas, seriales, consecutivos, QR, codigos internos, digitos de control ni numeros parciales.
- En el frente, usa el numero que este junto a NUIP, C.C., Cedula, Numero, Documento o Identificacion.
- Si hay frente y reverso, valida que el numero coincida. Si no coincide, prioriza el NUIP/Cedula impreso en el frente.

Reglas MRZ/ICCOL para reverso:
- Acepta MRZ de 3 lineas con IDCOL, ID<COL, ICCOL o IC<COL.
- En cedulas nuevas con ICCOL, la primera linea puede traer un consecutivo interno. NO lo uses como cedula.
- Si ves algo como "ICCOL000000012", NO devuelvas "12" ni "000000012".
- En cedula colombiana moderna, el NUIP real suele estar en la segunda linea despues de "COL".
- Ejemplo: "8808213F3101300COL1234567890<9" => cedula correcta "1234567890".
- Quita caracteres "<" y no incluyas el ultimo digito verificador MRZ.
- La tercera linea MRZ trae apellidos y nombres: apellidos antes de "<<", nombres despues de "<<".

Reglas de calidad y costo:
- Revisa visualmente el numero dos veces antes de responder.
- Si lees el numero pero no lees nombres o fechas, conserva la cedula y deja esos campos en null.
- Si el numero no es legible, responde {"ok":false,"error":"cedula_no_legible","confianza":0.39}.
- Confianza 0.40-0.60 significa lectura util pero no perfecta; 0.70+ solo si el numero esta claro.
- No inventes datos. No expliques. No agregues campos fuera del esquema.
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
        "min_confidence": float(os.environ.get("GEMINI_MIN_CONFIDENCE", "0.40")),
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
    if len(text) == 8 and text[4:] and text[4:6] in {"19", "20"}:
        return f"{text[4:]}{text[2:4]}{text[:2]}"
    return ""


def _clean_text(value: Any) -> str:
    text = str(value or "").upper()
    text = re.sub(r"[^A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00DC\u00D1\s.'-]", " ", text)
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
    if max_side > 1600:
        scale = 1600 / max_side
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=80, optimize=True)
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


def _first_non_empty(payload: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = payload.get(key)
        if value not in (None, ""):
            return value
    return ""


def _parsed_from_gemini(payload: Dict[str, Any]) -> Dict[str, str]:
    return {
        "cedula": clean_cedula(_first_non_empty(
            payload,
            "cedula", "cc", "nuip", "documento", "numero_documento",
            "numero_cedula", "document_number", "documentNumber",
        )) or "",
        "nombres": _clean_text(_first_non_empty(payload, "nombres", "nombre", "given_names", "givenNames", "first_name", "firstName")),
        "primer_apellido": _clean_text(_first_non_empty(payload, "primer_apellido", "primerApellido", "apellido1", "surname1", "last_name_1")),
        "segundo_apellido": _clean_text(_first_non_empty(payload, "segundo_apellido", "segundoApellido", "apellido2", "surname2", "last_name_2")),
        "genero": _clean_text(_first_non_empty(payload, "genero", "sexo", "sex"))[:1],
        "fecha_nacimiento": _normalize_date(_first_non_empty(payload, "fecha_nacimiento", "fechaNacimiento", "birth_date", "birthDate")),
        "fecha_expedicion": _normalize_date(_first_non_empty(payload, "fecha_expedicion", "fechaExpedicion", "issue_date", "issueDate")),
        "fecha_expiracion": _normalize_date(_first_non_empty(payload, "fecha_expiracion", "fechaExpiracion", "fecha_vencimiento", "expiry_date", "expiryDate")),
        "tipo_sangre": _clean_blood(_first_non_empty(payload, "tipo_sangre", "rh", "blood_type", "bloodType")),
        "lugar_nacimiento": _clean_text(_first_non_empty(payload, "lugar_nacimiento", "lugarNacimiento", "birth_place", "birthPlace")),
        "lugar_expedicion": _clean_text(_first_non_empty(payload, "lugar_expedicion", "lugarExpedicion", "issue_place", "issuePlace")),
        "formato_detectado": "gemini_vision",
    }




def analyze_cedula_with_gemini(
    image_bytes: bytes,
    image_bytes_reverso: Optional[bytes] = None,
) -> Dict[str, Any]:
    cfg = gemini_config()
    if not cfg["enabled"]:
        return {"ok": False, "error": "gemini_no_configurado", "cedula": "", "parsed": {}}

    inline_data, mime_type = _prepare_image(image_bytes)

    # Frente siempre presente; reverso opcional, ambos en una sola llamada.
    parts: list[Dict[str, Any]] = [
        {"text": PROMPT},
        {"inline_data": {"mime_type": mime_type, "data": inline_data}},
    ]
    if image_bytes_reverso:
        inline_data_r, mime_type_r = _prepare_image(image_bytes_reverso)
        parts.append({"inline_data": {"mime_type": mime_type_r, "data": inline_data_r}})

    body = {
        "contents": [
            {
                "role": "user",
                "parts": parts,
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 512,
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

    parsed = _parsed_from_gemini(parsed_json)
    cedula = parsed.get("cedula") or ""
    confidence_raw = parsed_json.get("confianza", parsed_json.get("confidence", None))
    try:
        confidence = float(str(confidence_raw).replace(",", ".")) if confidence_raw not in (None, "") else (1.0 if cedula else 0.0)
    except Exception:
        confidence = 1.0 if cedula else 0.0
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
