"""
Parser de cédula colombiana — VERSION 5 CORREGIDA (1940–2026).

Soporta TODOS los formatos históricos de código de barras PDF417
y QR del respaldo de la cédula colombiana, incluyendo:

  ① Cédulas de papel/cartón (1940–1985):
      Sin código de barras. Solo OCR del frente.

  ② Primera generación plástica (1985–2000):
      Código de barras Code-39 o PDF417 simple.
      Payload: número de cédula puro, a veces con nombre.

  ③ Segunda generación (2000–2010):
      PDF417 con formato:
        {CEDULA}|{APELLIDOS}|{NOMBRES}|{SEXO}|{FECHA_NAC}|{LUGAR}

  ④ Tercera generación (2010–2018) — formato estándar vigente:
      PDF417 con guiones:
        P-{formulario}-{serie}-{M|F}-{CEDULA}-{YYYYMMDD}
        Ej: P-2510000-01090492-M-1005029331-20190801

  ⑤ Cédula digital moderna (2018–2026) — formato MRZ:
      {CEDULA}
      {FECHANAC_YYYYMMDD}
      {M|F}
      {APELLIDO1}<{APELLIDO2}<{NOMBRE1}<{NOMBRE2}
      (el número de cédula aparece PRIMERO)

Correcciones v5 (BUG #4):
  - _NUMBER_LABEL_RE ampliado: ahora captura "C.C.", "Cédula de Ciudadanía",
    "Identificación", y el número sin etiqueta (número grande aislado en el frente).
  - Nueva función _extract_standalone_number: detecta el número de cédula
    cuando aparece impreso en la cédula SIN etiqueta previa (caso frecuente
    en fotos del frente donde el OCR no detectó la etiqueta "NÚMERO").
  - Prioridad corregida: el número más largo y aislado gana sobre secuencias cortas.
  - Sin re.IGNORECASE en AFTER_GENDER_RE para evitar falsos positivos con
    iniciales de nombres (MARIA FERNANDA tiene muchas F y M).
  - Soporte de cédulas de 5-6 dígitos (personas nacidas antes de 1950).
  - Detección de formato MRZ moderno (cédula al inicio, separador '<').
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple

# ─── Rangos válidos ───────────────────────────────────────────────────────────
_MIN_DIGITS = 5
_MAX_DIGITS = 11

# ─── Patrones de código de barras ────────────────────────────────────────────

DIGIT_RUN_RE = re.compile(r"(?<!\d)(\d{5,11})(?!\d)")

AFTER_GENDER_RE = re.compile(
    r"(?:^|[-_\s|;,])([MF])[-_\s]*(\d{5,11})(?!\d)"
)

DASH_GENDER_RE = re.compile(
    r"-([MF])-(\d{5,11})-"
)

COLOMBIAN_DASH_PAYLOAD_RE = re.compile(
    r"(?:^|[^A-Z0-9])([A-Z])-\d{5,8}-\d{5,10}-([MF])-(\d{5,11})-((?:19|20)\d{6})(?:[^0-9]|$)"
)

PIPE_FORMAT_RE = re.compile(
    r"^(\d{5,11})\|"
)

MRZ_FIRST_LINE_RE = re.compile(
    r"^(\d{5,11})[\r\n]"
)

DATE_YYYYMMDD_RE = re.compile(
    r"^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$"
)

DATE_DDMMYYYY_RE = re.compile(
    r"^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d{2}$"
)

YEAR_ONLY_RE = re.compile(r"^(19|20)\d{2}$")

SEPS_RE = re.compile(r"[|;,\t\r\n\s]+")

GENERO_RE = re.compile(r"(?:^|[^A-Za-z0-9])([MF])(?=[^A-Za-z]|$)")

FECHA_NAC_RE = re.compile(
    r"(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)"
)

SANGRE_RE = re.compile(r"(?<![A-Z])(AB|O|A|B)\s*([+\-])(?![A-Z0-9])")

MRZ_NAME_RE = re.compile(r"([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ<\s]{4,})")
TEXT_FIELD_RE = re.compile(r"[^A-ZÁÉÍÓÚÜÑ\s.'-]")

MRZ_LINE_RE = re.compile(r"^[A-Z0-9<]{24,32}$")
MRZ_CHAR_VALUES = {"<": 0, **{str(i): i for i in range(10)}}
MRZ_CHAR_VALUES.update({chr(ord("A") + i): 10 + i for i in range(26)})
MRZ_WEIGHTS = (7, 3, 1)
MRZ_FILLER_CHARS = str.maketrans({
    "«": "<",
    "‹": "<",
    "›": "<",
    ">": "<",
    " ": "",
})
MRZ_DIGIT_FIXES = str.maketrans({
    "O": "0",
    "Q": "0",
    "D": "0",
    "I": "1",
    "L": "1",
    "B": "8",
    "S": "5",
    "Z": "2",
})

# ─── BUG #4 FIX: Regex de etiqueta ampliado ──────────────────────────────────
# Antes solo buscaba: NÚMERO, N°, CEDULA, CC
# Ahora también: C.C., Cédula de Ciudadanía, Identificación, No., Nro.
NUMBER_LABEL_RE = re.compile(
    r"(?:"
    r"N[UÚ]MERO\s+DE\s+C[EÉ]DULA"
    r"|C[EÉ]DULA\s+DE\s+CIUDADAN[IÍ]A"
    r"|IDENTIFICACI[OÓ]N"
    r"|C\.?\s*C\.?"
    r"|N[UÚ]MERO"
    r"|N[°º]"
    r"|NRO\.?"
    r"|NO\.?"
    r"|C[EÉ]DULA"
    r")[:\s#]*([0-9][0-9\s.,]{4,18}[0-9])",
    re.IGNORECASE,
)

# ─── BUG #4 FIX: Patrón para número aislado (sin etiqueta) ──────────────────
# En el frente de la cédula colombiana el número aparece impreso grande,
# a veces el OCR no detecta la etiqueta y devuelve solo el número.
# Este patrón busca una corrida de 7-10 dígitos en una línea propia.
STANDALONE_NUMBER_RE = re.compile(
    r"(?:^|\n)\s*(\d{7,10})\s*(?:\n|$)"
)

# Número con puntos de agrupación: 1.005.029.331
GROUPED_NUMBER_RE = re.compile(r"\d{1,3}(?:[.,]\d{3}){1,3}")
KEY_VALUE_ID_RE = re.compile(
    r"(?:NUIP|DOCUMENTO|DOCUMENT_NUMBER|CEDULA|C[EÉ]DULA|IDENTIFICACION|IDENTIFICACI[OÓ]N)"
    r'["\']?\s*[:=]\s*["\']?([0-9][0-9\s.,]{4,18}[0-9])',
    re.IGNORECASE,
)

PDF417_MARKER = b"PubDSK_"
PDF417_ENCODING = "latin-1"
PDF417_MIN_CLASSIC_LEN = 168

PDF417_FIELD_RANGES = {
    "afis_code": (2, 10),
    "finger_card": (40, 48),
    "document_number": (48, 58),
    "last_name": (58, 80),
    "second_last_name": (81, 104),
    "first_name": (104, 127),
    "middle_name": (127, 150),
    "gender": (151, 152),
    "birth_year": (152, 156),
    "birth_month": (156, 158),
    "birth_day": (158, 160),
    "municipality_code": (160, 162),
    "department_code": (162, 165),
    "blood_type": (166, 168),
}

SPECIAL_LOCALITIES = {
    ("31", "019"): ("VALLE", "BUENAVENTURA"),
    ("15", "001"): ("CUNDINAMARCA", "BOGOTA, D.C."),
    ("31", "001"): ("VALLE", "CALI"),
    ("01", "001"): ("ANTIOQUIA", "MEDELLIN"),
    ("03", "001"): ("ATLANTICO", "BARRANQUILLA"),
    ("05", "001"): ("BOLIVAR", "CARTAGENA"),
    ("52", "001"): ("META", "VILLAVICENCIO"),
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _is_date(s: str) -> bool:
    return bool(DATE_YYYYMMDD_RE.match(s) or DATE_DDMMYYYY_RE.match(s))


def _is_year(s: str) -> bool:
    return bool(YEAR_ONLY_RE.match(s))


def _strip_zeros(s: str) -> Optional[str]:
    stripped = s.lstrip("0")
    if len(stripped) < 4:
        return None
    return stripped


def _format_mrz_date(yymmdd: str, *, future: bool = False) -> str:
    if not re.fullmatch(r"\d{6}", yymmdd or ""):
        return ""
    yy = int(yymmdd[:2])
    if future:
        yyyy = 2000 + yy
    else:
        current_yy = int(str(datetime.now().year)[2:4])
        yyyy = 1900 + yy if yy > current_yy else 2000 + yy
    return f"{yyyy:04d}-{yymmdd[2:4]}-{yymmdd[4:6]}"


def mrz_check_digit(value: str) -> int:
    total = 0
    for idx, char in enumerate((value or "").upper()):
        total += MRZ_CHAR_VALUES.get(char, 0) * MRZ_WEIGHTS[idx % 3]
    return total % 10


def validate_mrz_field(value: str, check_digit: str) -> bool:
    return bool(check_digit and check_digit.isdigit() and mrz_check_digit(value) == int(check_digit))


def _clean_mrz_candidate(line: str) -> str:
    compact = re.sub(r"[^A-Z0-9<]", "", (line or "").upper().translate(MRZ_FILLER_CHARS))
    if compact.startswith("ID<COL"):
        compact = "IDCOL" + compact[6:]
    if compact.startswith("IC<COL"):
        compact = "ICCOL" + compact[6:]
    if compact.startswith("1D"):
        compact = "ID" + compact[2:]
    if compact.startswith("1C"):
        compact = "IC" + compact[2:]
    if len(compact) >= 5:
        head = compact[:5]
        normalized_head = head.replace("0", "O")
        # Cédulas antiguas: IDCOL
        if normalized_head.startswith("IDCO") and normalized_head[4] in ("1", "I", "L"):
            normalized_head = "IDCOL"
        if normalized_head == "IDCOL":
            compact = "IDCOL" + compact[5:]
        # Cédulas nuevas 2022+: ICCOL
        elif normalized_head.startswith("ICCO") and normalized_head[4] in ("1", "I", "L"):
            compact = "ICCOL" + compact[5:]
    return compact


def _fix_mrz_digits(value: str) -> str:
    return (value or "").upper().translate(MRZ_DIGIT_FIXES)


def _score_mrz_name_suffix(value: str) -> float:
    text = re.sub(r"[^A-ZÁÉÍÓÚÜÑ]", "", (value or "").upper())
    if len(text) < 2:
        return -99.0
    vowels = sum(1 for c in text if c in "AEIOUÁÉÍÓÚÜ")
    score = vowels * 3.0 + min(len(text), 12) * 0.2
    if re.match(r"^[BCDFGHJKLMNPQRSTVWXYZ][AEIOUÁÉÍÓÚÜ]", text):
        score += 0.6
    if re.match(r"^[BCDFGHJKLMNPQRSTVWXYZ]{3,}", text):
        score -= 6.0
    leading_filler = re.match(r"^[TSILKCF]+", text)
    if leading_filler and len(text) > 8:
        score -= len(leading_filler.group(0)) * 2.0
    if re.search(r"(SS|II|LL|TT|KK|CC|FF)", text[:6]):
        score -= 3.0
    if re.search(r"(.)\1{2,}", text):
        score -= 4.0
    return score


def _clean_mrz_name_token(value: str) -> str:
    text = re.sub(r"[^A-ZÁÉÍÓÚÜÑ]", "", (value or "").upper())
    if len(text) <= 8:
        return text
    prefix = text[:10]
    # OCR a veces convierte muchos '<' de relleno antes del nombre en T/S/I/L/K/C/F.
    if not re.match(r"^[TSILKCF]{4,}", prefix) and not re.search(r"([TSILKCF])\1{2,}", prefix):
        return text

    original_score = _score_mrz_name_suffix(text)
    best = text
    best_score = original_score
    for i in range(3, len(text) - 1):
        junk = text[:i]
        suffix = text[i:]
        if len(suffix) < 2 or not all(c in "TSILKCF" for c in junk):
            continue
        score = _score_mrz_name_suffix(suffix) + min(i, 10) * 0.35
        if score > best_score + 0.3:
            best = suffix
            best_score = score
    return best


def _candidate_mrz_lines(raw: str) -> List[str]:
    lines: List[str] = []
    for line in re.split(r"[\r\n]+", (raw or "").upper()):
        compact = _clean_mrz_candidate(line)
        if MRZ_LINE_RE.match(compact):
            lines.append(compact[:30].ljust(30, "<"))
    if len(lines) >= 3:
        return lines[:3]

    compact = _clean_mrz_candidate(raw)
    # Buscar IDCOL (cédulas antiguas) o ICCOL (cédulas nuevas 2022+)
    for prefix in ("IDCOL", "ICCOL"):
        start = compact.find(prefix)
        if start >= 0 and len(compact) - start >= 85:
            chunk = compact[start:start + 90]
            return [chunk[0:30].ljust(30, "<"), chunk[30:60].ljust(30, "<"), chunk[60:90].ljust(30, "<")]
    return []


def parse_mrz_from_text(raw: Optional[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "cedula": "",
        "primer_apellido": "",
        "segundo_apellido": "",
        "nombres": "",
        "genero": "",
        "fecha_nacimiento": "",
        "fecha_expiracion": "",
        "nacionalidad": "",
        "mrz_valido": False,
        "raw_mrz": [],
    }
    if not raw:
        return out

    lines = _candidate_mrz_lines(str(raw))
    if len(lines) < 3:
        return out

    l1, l2, l3 = lines[:3]
    # Aceptar IDCOL (cédulas antiguas) e ICCOL (cédulas nuevas 2022+)
    mrz_prefix = ""
    if l1.startswith("IDCOL"):
        mrz_prefix = "IDCOL"
    elif l1.startswith("ICCOL"):
        mrz_prefix = "ICCOL"
    else:
        return out

    l1_numeric = l1[:5] + _fix_mrz_digits(l1[5:])
    # TD1: posiciones 5-13 = 9 chars del numero, posicion 14 = check digit
    # Para cedulas de 10 digitos, el decimo digito puede estar en pos 15
    doc_field_raw = _fix_mrz_digits(l1[5:14])   # 9 chars
    doc_check_raw = _fix_mrz_digits(l1[14:15])  # 1 char check digit
    # Verificar si el numero desborda al campo opcional (pos 15) - cedulas 10 digitos
    extra_char = _fix_mrz_digits(l1[15:16]) if len(l1) > 15 else ""
    doc_field = doc_field_raw
    doc_check = doc_check_raw

    # Intentar con regex primero (puede capturar numeros cortos directamente)
    doc_match = re.match(r"^(?:IDCOL|ICCOL)(\d{5,9})([0-9])", l1_numeric)
    if doc_match:
        candidate = doc_match.group(1)
        possible_check = doc_match.group(2)
        # Validar con check digit
        if validate_mrz_field(candidate, possible_check):
            doc_field = candidate
            doc_check = possible_check
        elif extra_char.isdigit():
            # Puede ser que el numero tenga 10 digitos (9 en campo + 1 overflow)
            candidate10 = candidate + possible_check
            check10 = extra_char
            if validate_mrz_field(candidate10, check10):
                doc_field = candidate10
                doc_check = check10
            else:
                doc_field = doc_field_raw
                doc_check = doc_check_raw

    cedula = doc_field.replace("<", "").lstrip("0")

    # Colombia (ICCOL/IDCOL) pone el numero COMPLETO en el campo opcional de L2
    # posiciones 18-28 de L2. Si ahi hay un numero mas largo, ese es el real.
    l2_opcional = l2[18:29].replace("<", "").strip()
    l2_opcional_fixed = _fix_mrz_digits(l2_opcional)
    if (l2_opcional_fixed.isdigit()
            and len(l2_opcional_fixed) > len(cedula)
            and 7 <= len(l2_opcional_fixed) <= 11):
        cedula = l2_opcional_fixed.lstrip("0") or l2_opcional_fixed
    birth = _fix_mrz_digits(l2[0:6])
    birth_check = _fix_mrz_digits(l2[6])[:1]
    gender = l2[7]
    expiry = _fix_mrz_digits(l2[8:14])
    expiry_check = _fix_mrz_digits(l2[14])[:1]
    nationality = l2[15:18].upper().replace("0", "O").replace("1", "I")

    name_line = l3.replace("0", "O").rstrip("<")
    if "<<" in name_line:
        last_block, first_block = name_line.split("<<", 1)
        last_parts = [_clean_mrz_name_token(p) for p in last_block.split("<") if p]
        first_parts = [_clean_mrz_name_token(p) for p in first_block.split("<") if p]
        first_parts = [p for p in first_parts if p]
        out["primer_apellido"] = last_parts[0] if last_parts else ""
        out["segundo_apellido"] = " ".join(last_parts[1:])
        out["nombres"] = " ".join(first_parts)
    else:
        name_parts = [_clean_mrz_name_token(p) for p in name_line.split("<") if p]
        name_parts = [p for p in name_parts if p]
        if name_parts:
            out["primer_apellido"] = name_parts[0]
        if len(name_parts) > 1:
            out["segundo_apellido"] = name_parts[1]
        if len(name_parts) > 2:
            out["nombres"] = " ".join(name_parts[2:])

    doc_validation_field = doc_field.lstrip("0") or doc_field
    doc_ok = validate_mrz_field(doc_validation_field, doc_check)
    birth_ok = validate_mrz_field(birth, birth_check)
    expiry_ok = validate_mrz_field(expiry, expiry_check)

    out.update({
        "cedula": cedula,
        "genero": gender if gender in ("M", "F") else "",
        "fecha_nacimiento": _format_mrz_date(birth),
        "fecha_expiracion": _format_mrz_date(expiry, future=True),
        "nacionalidad": nationality,
        "mrz_valido": doc_ok and birth_ok and expiry_ok,
        "raw_mrz": lines[:3],
    })
    return out


def _is_valid_cedula_candidate(s: str) -> bool:
    if not s or not s.isdigit():
        return False
    if _is_date(s):
        return False
    if _is_year(s):
        return False
    stripped = s.lstrip("0")
    return len(stripped) >= 4


def _looks_binary_payload(s: str) -> bool:
    if not s:
        return False
    bad = sum(1 for ch in s if ch == "\ufffd" or (ord(ch) < 32 and ch not in "\r\n\t"))
    odd = sum(1 for ch in s if ord(ch) > 126 and ch not in "ÁÉÍÓÚÜÑáéíóúüñ")
    return (bad + odd) >= 3 or (len(s) > 80 and (bad + odd) / max(len(s), 1) > 0.02)


def _clean_text_field(value: Any) -> str:
    text = str(value or "").upper().replace("<", " ")
    text = TEXT_FIELD_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) >= 2 else ""


def _normalize_num(s: str) -> str:
    return re.sub(r"[.,\s]", "", s or "")


def _raw_to_pdf417_bytes(raw: Any) -> bytes:
    if raw is None:
        return b""
    if isinstance(raw, bytes):
        return raw
    if isinstance(raw, bytearray):
        return bytes(raw)
    return str(raw).encode(PDF417_ENCODING, errors="ignore")


def _field_bytes(data: bytes, key: str) -> bytes:
    start, end = PDF417_FIELD_RANGES[key]
    if len(data) < start:
        return b""
    return data[start:min(end, len(data))]


def _decode_pdf417_field(value: bytes, *, text: bool = False) -> str:
    decoded = value.split(b"\x00", 1)[0].decode(PDF417_ENCODING, errors="ignore")
    decoded = decoded.replace("\x00", " ").strip()
    if text:
        decoded = TEXT_FIELD_RE.sub(" ", decoded.upper())
        decoded = re.sub(r"\s+", " ", decoded).strip()
    return decoded


def _valid_pdf417_date(year: str, month: str, day: str) -> bool:
    if not (year.isdigit() and month.isdigit() and day.isdigit()):
        return False
    yyyy = int(year)
    mm = int(month)
    dd = int(day)
    return 1900 <= yyyy <= 2100 and 1 <= mm <= 12 and 1 <= dd <= 31


def _format_pdf417_date(year: str, month: str, day: str) -> str:
    if not _valid_pdf417_date(year, month, day):
        return ""
    return f"{year}-{month}-{day}"


def _pdf417_location(municipality_code: str, department_code: str) -> Dict[str, str]:
    department, municipality = SPECIAL_LOCALITIES.get((municipality_code, department_code), ("", ""))
    return {
        "department": department,
        "department_code": department_code,
        "municipality": municipality,
        "municipality_code": municipality_code,
    }


def _classic_pdf417_out(raw: Any) -> Dict[str, Any]:
    return {
        "cedula": "",
        "primer_apellido": "",
        "segundo_apellido": "",
        "nombres": "",
        "genero": "",
        "fecha_nacimiento": "",
        "fecha_expiracion": "",
        "nacionalidad": "",
        "tipo_sangre": "",
        "formato_detectado": "",
        "mrz_valido": False,
        "raw_mrz": [],
        "raw": raw.decode(PDF417_ENCODING, errors="ignore") if isinstance(raw, (bytes, bytearray)) else (raw or ""),
    }


def _is_plausible_classic_pdf417(data: bytes, doc_number: str, gender: str, year: str, month: str, day: str) -> bool:
    if not doc_number.isdigit() or not _is_valid_cedula_candidate(doc_number):
        return False
    if gender and gender not in ("M", "F"):
        return False
    if _valid_pdf417_date(year, month, day):
        return True
    return PDF417_MARKER in data


def _parse_classic_pdf417_fixed(data: bytes, raw: Any = "") -> Dict[str, Any]:
    out = _classic_pdf417_out(raw)
    if len(data) < PDF417_MIN_CLASSIC_LEN and PDF417_MARKER not in data:
        return out

    afis_code = _decode_pdf417_field(_field_bytes(data, "afis_code"))
    finger_card = _decode_pdf417_field(_field_bytes(data, "finger_card"))
    document_number_raw = _decode_pdf417_field(_field_bytes(data, "document_number"))
    document_number = (document_number_raw.lstrip("0") or document_number_raw).strip()
    last_name = _decode_pdf417_field(_field_bytes(data, "last_name"), text=True)
    second_last_name = _decode_pdf417_field(_field_bytes(data, "second_last_name"), text=True)
    first_name = _decode_pdf417_field(_field_bytes(data, "first_name"), text=True)
    middle_name = _decode_pdf417_field(_field_bytes(data, "middle_name"), text=True)
    gender = _decode_pdf417_field(_field_bytes(data, "gender")).upper()
    birth_year = _decode_pdf417_field(_field_bytes(data, "birth_year"))
    birth_month = _decode_pdf417_field(_field_bytes(data, "birth_month"))
    birth_day = _decode_pdf417_field(_field_bytes(data, "birth_day"))
    municipality_code = _decode_pdf417_field(_field_bytes(data, "municipality_code"))
    department_code = _decode_pdf417_field(_field_bytes(data, "department_code"))
    blood_type = _decode_pdf417_field(_field_bytes(data, "blood_type")).upper()

    if not _is_plausible_classic_pdf417(data, document_number, gender, birth_year, birth_month, birth_day):
        return out

    out.update({
        "cedula": document_number,
        "primer_apellido": last_name,
        "segundo_apellido": second_last_name,
        "nombres": " ".join(part for part in (first_name, middle_name) if part).strip(),
        "genero": gender if gender in ("M", "F") else "",
        "fecha_nacimiento": _format_pdf417_date(birth_year, birth_month, birth_day),
        "tipo_sangre": blood_type if re.fullmatch(r"(AB|O|A|B)[+\-]", blood_type or "") else "",
        "formato_detectado": "pdf417_binario_posicional",
        "afis_code": afis_code,
        "finger_card": finger_card,
        "document_info": {
            "document_number": document_number,
            "afis_code": afis_code,
            "finger_card": finger_card,
        },
        "location": _pdf417_location(municipality_code, department_code),
    })
    return out


def _parse_classic_pdf417_split(data: bytes, raw: Any = "") -> Dict[str, Any]:
    out = _classic_pdf417_out(raw)
    if PDF417_MARKER not in data:
        return out
    compact = re.sub(b"(\x00){2,}", b"\x00", data)
    parts = compact.split(b"\x00")
    try:
        if len(parts) < 7:
            return out
        afis_code = parts[0].decode(PDF417_ENCODING, errors="ignore")[2:]
        finger_card = parts[2].decode(PDF417_ENCODING, errors="ignore")[:8]
        if len(parts[2]) > 8:
            joined = parts[2].decode(PDF417_ENCODING, errors="ignore")
            document_number = joined[10:20].lstrip("0") or joined[10:20]
            last_name = joined[20:] or joined[18:]
        else:
            parts = parts[1:]
            joined = parts[2].decode(PDF417_ENCODING, errors="ignore")
            document_number = joined[:10].lstrip("0") or joined[:10]
            last_name = joined[10:]
        second_last_name = parts[3].decode(PDF417_ENCODING, errors="ignore")
        first_name = parts[4].decode(PDF417_ENCODING, errors="ignore")
        middle_name = parts[5].decode(PDF417_ENCODING, errors="ignore")
        meta = parts[6].decode(PDF417_ENCODING, errors="ignore")
    except Exception:
        return out

    if middle_name.endswith(("-", "+")):
        middle_name = ""
    document_number = re.sub(r"\D", "", document_number).lstrip("0")
    if not _is_valid_cedula_candidate(document_number):
        return out
    gender = meta[1:2].upper() if len(meta) > 1 else ""
    birth_year = meta[2:6]
    birth_month = meta[6:8]
    birth_day = meta[8:10]
    municipality_code = meta[10:12]
    department_code = meta[12:15]
    blood_type = meta[16:18].upper()

    out.update({
        "cedula": document_number,
        "primer_apellido": _clean_text_field(last_name),
        "segundo_apellido": _clean_text_field(second_last_name),
        "nombres": _clean_text_field(" ".join(part for part in (first_name, middle_name) if part)),
        "genero": gender if gender in ("M", "F") else "",
        "fecha_nacimiento": _format_pdf417_date(birth_year, birth_month, birth_day),
        "tipo_sangre": blood_type if re.fullmatch(r"(AB|O|A|B)[+\-]", blood_type or "") else "",
        "formato_detectado": "pdf417_binario_compacto",
        "afis_code": afis_code,
        "finger_card": finger_card,
        "document_info": {
            "document_number": document_number,
            "afis_code": afis_code,
            "finger_card": finger_card,
        },
        "location": _pdf417_location(municipality_code, department_code),
    })
    return out


def parse_pdf417_bytes(data: bytes, raw_text: Optional[str] = None) -> Dict[str, Any]:
    raw = raw_text if raw_text is not None else data
    fixed = _parse_classic_pdf417_fixed(data, raw)
    if fixed.get("cedula"):
        return fixed
    return _parse_classic_pdf417_split(data, raw)


def _score_candidate(digits: str, pos: int, total_len: int) -> float:
    stripped = digits.lstrip("0")
    L = len(stripped)

    length_score: float = {
        10: 10.0, 9: 9.0, 8: 8.0, 7: 7.0,
        6: 5.0, 5: 4.0, 11: 3.0,
    }.get(L, 1.0)

    pos_frac = pos / max(total_len, 1)
    pos_late = pos_frac * 1.5
    pos_early = (1 - pos_frac) * 1.5
    pos_score = max(pos_late, pos_early)

    leading = len(digits) - len(stripped)
    zero_penalty = leading * 1.0

    return length_score + pos_score - zero_penalty


# ─── Extractor principal ──────────────────────────────────────────────────────

def extract_cedula(raw: Optional[str]) -> Optional[str]:
    """
    Extrae el número de cédula de cualquier payload de código de barras,
    QR, texto manual o resultado OCR.

    BUG #4 FIX: ahora también detecta:
    - Etiquetas ampliadas: "C.C.", "Cédula de Ciudadanía", "No.", "Nro."
    - Número sin etiqueta (standalone) en una línea propia.
    - Número con puntos de agrupación: 1.005.029.331
    """
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None

    classic = parse_pdf417_bytes(_raw_to_pdf417_bytes(raw), s)
    if classic.get("cedula"):
        return classic["cedula"]

    # Caso trivial: ya es un número puro
    if s.isdigit() and _MIN_DIGITS <= len(s) <= _MAX_DIGITS:
        if not _is_date(s) and not _is_year(s):
            return _strip_zeros(s) or s

    total_len = len(s)

    # ── PRIORIDAD 0: Payload colombiano completo con género y fecha ─────────
    cm = COLOMBIAN_DASH_PAYLOAD_RE.search(s.upper())
    if cm:
        digits = cm.group(3)
        if _is_valid_cedula_candidate(digits):
            return _strip_zeros(digits) or digits

    # ── PRIORIDAD 1: Formato con guión explícito -M-CEDULA- ─────────────────
    for m in DASH_GENDER_RE.finditer(s):
        digits = m.group(2)
        if _is_valid_cedula_candidate(digits):
            return _strip_zeros(digits) or digits

    # ── PRIORIDAD 2: Formato pipe — primer campo {CEDULA}|... ────────────────
    pm = PIPE_FORMAT_RE.match(s)
    if pm:
        digits = pm.group(1)
        if _is_valid_cedula_candidate(digits):
            return _strip_zeros(digits) or digits

    # ── PRIORIDAD 3: Formato MRZ — primera línea es la cédula ───────────────
    mm = MRZ_FIRST_LINE_RE.match(s)
    if mm:
        digits = mm.group(1)
        if _is_valid_cedula_candidate(digits):
            return _strip_zeros(digits) or digits

    # ── PRIORIDAD 4: BUG #4 FIX — Etiqueta explícita (ampliada) ────────────
    km = KEY_VALUE_ID_RE.search(s)
    if km:
        raw_num = _normalize_num(km.group(1))
        if raw_num.isdigit() and _MIN_DIGITS <= len(raw_num) <= _MAX_DIGITS:
            if not _is_date(raw_num) and not _is_year(raw_num):
                return raw_num.lstrip("0") or raw_num

    lm = NUMBER_LABEL_RE.search(s)
    if lm:
        raw_num = _normalize_num(lm.group(1))
        if raw_num.isdigit() and _MIN_DIGITS <= len(raw_num) <= _MAX_DIGITS:
            if not _is_date(raw_num) and not _is_year(raw_num):
                return raw_num.lstrip("0") or raw_num

    # ── PRIORIDAD 5: BUG #4 FIX — Número con puntos (1.005.029.331) ─────────
    grouped = GROUPED_NUMBER_RE.findall(s)
    for g in grouped:
        norm = _normalize_num(g)
        if norm.isdigit() and _MIN_DIGITS <= len(norm) <= _MAX_DIGITS:
            if not _is_date(norm) and not _is_year(norm):
                return norm.lstrip("0") or norm

    # ── PRIORIDAD 6: BUG #4 FIX — Número standalone en línea propia ─────────
    for m in STANDALONE_NUMBER_RE.finditer(s):
        digits = m.group(1)
        if _is_valid_cedula_candidate(digits):
            return _strip_zeros(digits) or digits

    # ── PRIORIDAD 7: Número después de marcador género M/F ──────────────────
    for m in AFTER_GENDER_RE.finditer(s):
        digits = m.group(2)
        if _is_valid_cedula_candidate(digits):
            return _strip_zeros(digits) or digits

    # ── PRIORIDAD 8: Mejor candidato entre todos los números ─────────────────
    candidates: List[Tuple[str, int, float]] = []
    for match in DIGIT_RUN_RE.finditer(s):
        raw_dig = match.group(1)
        if not _is_valid_cedula_candidate(raw_dig):
            continue
        pos = match.start()
        score = _score_candidate(raw_dig, pos, total_len)
        candidates.append((raw_dig, pos, score))

    if candidates:
        if _looks_binary_payload(s):
            return None
        candidates.sort(key=lambda x: -x[2])
        best = candidates[0][0]
        return _strip_zeros(best) or best

    return None


# ─── Parser completo (nombres, género, fecha, tipo sangre) ────────────────────

def parse_pdf417(raw: Optional[str]) -> Dict[str, Any]:
    """
    Parser completo del payload del código de barras PDF417.
    Extrae: cédula, apellidos, nombres, género, fecha nacimiento, tipo sangre.

    Compatible con formatos ②③④⑤ (1985–2026).
    BUG #4 FIX: usa NUMBER_LABEL_RE ampliado y detección standalone.
    """
    out: Dict[str, Any] = {
        "cedula": "",
        "primer_apellido": "",
        "segundo_apellido": "",
        "nombres": "",
        "genero": "",
        "fecha_nacimiento": "",
        "fecha_expiracion": "",
        "nacionalidad": "",
        "tipo_sangre": "",
        "formato_detectado": "",
        "mrz_valido": False,
        "raw_mrz": [],
        "raw": raw or "",
    }
    if not raw:
        return out

    s = str(raw).strip()
    classic = parse_pdf417_bytes(_raw_to_pdf417_bytes(raw), s)
    if classic.get("cedula"):
        out.update(classic)
        return out

    mrz = parse_mrz_from_text(s)
    colombian_dash = COLOMBIAN_DASH_PAYLOAD_RE.search(s.upper())
    if mrz.get("cedula"):
        out.update({k: v for k, v in mrz.items() if k in out and v})
        out["formato_detectado"] = "mrz_td1"
        out["raw"] = raw or ""
    elif colombian_dash:
        out["cedula"] = _strip_zeros(colombian_dash.group(3)) or colombian_dash.group(3)
        out["genero"] = colombian_dash.group(2)
        out["fecha_expiracion"] = (
            f"{colombian_dash.group(4)[0:4]}-{colombian_dash.group(4)[4:6]}-{colombian_dash.group(4)[6:8]}"
        )
        out["formato_detectado"] = "cedula_amarilla_guiones"

    if out["formato_detectado"]:
        pass
    elif re.match(r"^P-\d", s):
        out["formato_detectado"] = "clasico_guiones"
    elif PIPE_FORMAT_RE.match(s):
        out["formato_detectado"] = "pipe_separado"
    elif "<" in s and re.search(r"\d{5,11}\r?\n", s):
        out["formato_detectado"] = "mrz_moderno"
    elif s.isdigit():
        out["formato_detectado"] = "numero_puro"
    else:
        out["formato_detectado"] = "desconocido"

    # ── Cédula (usa extract_cedula con BUG #4 FIX) ───────────────────────────
    ced = extract_cedula(s)
    if ced and not out["cedula"]:
        out["cedula"] = ced

    # ── Nombres — formato MRZ con separador "<" ──────────────────────────────
    if "<" in s and not out["primer_apellido"]:
        mrz_blocks = re.findall(r"[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ<]{3,}", s)
        for block in mrz_blocks:
            parts = [p.strip() for p in block.split("<") if p.strip()]
            parts = [p for p in parts if not (len(p) == 1 and p in "MF")]
            if len(parts) >= 1:
                out["primer_apellido"] = parts[0]
            if len(parts) >= 2:
                out["segundo_apellido"] = parts[1]
            if len(parts) >= 3:
                out["nombres"] = " ".join(parts[2:])
            if out["primer_apellido"]:
                break

    elif "|" in s:
        pipe_parts = [p.strip() for p in s.split("|")]
        name_parts = [p for p in pipe_parts if p and not p.isdigit()]
        if len(name_parts) >= 1:
            out["primer_apellido"] = name_parts[0]
        if len(name_parts) >= 2:
            out["segundo_apellido"] = name_parts[1]
        if len(name_parts) >= 3:
            out["nombres"] = " ".join(name_parts[2:3])

    # ── Género ────────────────────────────────────────────────────────────────
    gm = re.search(r"[-_]([MF])[-_]", s)
    if gm:
        out["genero"] = gm.group(1)
    else:
        gm2 = GENERO_RE.search(s)
        if gm2:
            out["genero"] = gm2.group(1)

    # ── Fecha de nacimiento ───────────────────────────────────────────────────
    fm = FECHA_NAC_RE.search(s)
    if fm and not colombian_dash:
        fecha_str = f"{fm.group(1)}{fm.group(2)}{fm.group(3)}"
        if fecha_str != out["cedula"]:
            out["fecha_nacimiento"] = f"{fm.group(1)}-{fm.group(2)}-{fm.group(3)}"

    # ── Tipo de sangre ────────────────────────────────────────────────────────
    sm = SANGRE_RE.search(s.upper())
    if sm:
        out["tipo_sangre"] = f"{sm.group(1)}{sm.group(2)}"

    out["primer_apellido"] = _clean_text_field(out.get("primer_apellido"))
    out["segundo_apellido"] = _clean_text_field(out.get("segundo_apellido"))
    out["nombres"] = _clean_text_field(out.get("nombres"))

    return out


# ─── Limpieza genérica ────────────────────────────────────────────────────────

def clean_cedula(value: Any) -> Optional[str]:
    """
    Limpia y normaliza cualquier valor que represente una cédula.
    Acepta: str, int, float, None.
    """
    if value is None:
        return None

    if isinstance(value, float):
        if value != value:
            return None
        n = str(int(value))
        stripped = n.lstrip("0")
        return stripped or n

    if isinstance(value, int):
        n = str(value)
        return n.lstrip("0") or n

    s = str(value).strip()
    if not s:
        return None

    result = extract_cedula(s)
    if result:
        return result

    digits_only = "".join(c for c in s if c.isdigit())
    if digits_only:
        stripped = digits_only.lstrip("0")
        if len(stripped) >= _MIN_DIGITS:
            return stripped
    return None
