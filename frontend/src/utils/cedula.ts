/**
 * Colombian ID parser for camera barcodes, QR/MRZ text, OCR text and manual input.
 */
const DIGIT_RUN_RE = /(?<!\d)(\d{5,11})(?!\d)/g;
const AFTER_GENDER_RE = /(?:^|[-_\s|;,])([MF])[-_\s]*(\d{5,11})(?!\d)/g;
const DASH_GENDER_RE = /-([MF])-(\d{5,11})-/;
const COLOMBIAN_DASH_PAYLOAD_RE = /(?:^|[^A-Z0-9])([A-Z])-\d{5,8}-\d{5,10}-([MF])-(\d{5,11})-((?:19|20)\d{6})(?:[^0-9]|$)/;
const PIPE_FORMAT_RE = /^(\d{5,11})\|/;
const KEY_VALUE_ID_RE = /(?:NUIP|DOCUMENTO|DOCUMENT_NUMBER|CEDULA|C[EÉ]DULA|IDENTIFICACION|IDENTIFICACI[OÓ]N)["']?\s*[:=]\s*["']?([0-9][0-9\s.,]{4,18}[0-9])/i;
const NUMBER_LABEL_RE = /(?:N[U\u00DA]MERO\s+DE\s+C[E\u00C9]DULA|C[E\u00C9]DULA\s+DE\s+CIUDADAN[I\u00CD]A|IDENTIFICACI[O\u00D3]N|C\.?\s*C\.?|N[U\u00DA]MERO|N[\u00B0\u00BA]|NRO\.?|NO\.?|C[E\u00C9]DULA)[:\s#]*([0-9][0-9\s.,]{4,18}[0-9])/i;
const MRZ_FIRST_LINE_RE = /^(\d{5,11})[\r\n]/;
const STANDALONE_NUMBER_RE = /(?:^|\n)\s*(\d{7,10})\s*(?:\n|$)/g;
const GROUPED_NUMBER_RE = /\d{1,3}(?:[.,]\d{3}){1,3}/g;
const DATE_YYYYMMDD_RE = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const DATE_DDMMYYYY_RE = /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d{2}$/;
const DATE_YYMMDD_RE = /^\d{6}$/;
const YEAR_ONLY_RE = /^(19|20)\d{2}$/;
const GENERO_RE = /(?:^|[^A-Za-z0-9])([MF])(?=[^A-Za-z0-9]|$)/;
const GENERO_FLAT_RE = /[-_]([MF])[-_]/;
const FECHA_RE = /(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/;
const SANGRE_RE = /(?<![A-Z])(AB|O|A|B)\s*([+\-])(?![A-Z0-9])/;
const MRZ_LINE_RE = /^[A-Z0-9<]{24,32}$/;
const TEXT_FIELD_RE = /[^A-ZÁÉÍÓÚÜÑ\s.'-]/g;
const MRZ_WEIGHTS = [7, 3, 1];
const MRZ_DIGIT_FIXES: Record<string, string> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  B: "8",
  S: "5",
  Z: "2",
};
const PDF417_MARKER = "PubDSK_";
const PDF417_MIN_CLASSIC_LEN = 168;
const PDF417_FIELD_RANGES = {
  afis_code: [2, 10],
  finger_card: [40, 48],
  document_number: [48, 58],
  last_name: [58, 80],
  second_last_name: [81, 104],
  first_name: [104, 127],
  middle_name: [127, 150],
  gender: [151, 152],
  birth_year: [152, 156],
  birth_month: [156, 158],
  birth_day: [158, 160],
  municipality_code: [160, 162],
  department_code: [162, 165],
  blood_type: [166, 168],
} as const;
const SPECIAL_LOCALITIES: Record<string, { department: string; municipality: string }> = {
  "31-019": { department: "VALLE", municipality: "BUENAVENTURA" },
  "15-001": { department: "CUNDINAMARCA", municipality: "BOGOTA, D.C." },
  "31-001": { department: "VALLE", municipality: "CALI" },
  "01-001": { department: "ANTIOQUIA", municipality: "MEDELLIN" },
  "03-001": { department: "ATLANTICO", municipality: "BARRANQUILLA" },
  "05-001": { department: "BOLIVAR", municipality: "CARTAGENA" },
  "52-001": { department: "META", municipality: "VILLAVICENCIO" },
};

export type ParsedCedula = {
  cedula: string;
  primer_apellido: string;
  segundo_apellido: string;
  nombres: string;
  genero: string;
  fecha_nacimiento: string;
  fecha_expiracion?: string;
  nacionalidad?: string;
  tipo_sangre: string;
  mrz_valido?: boolean;
  raw_mrz?: string[];
  formato_detectado?: string;
  afis_code?: string;
  finger_card?: string;
  document_info?: {
    document_number: string;
    afis_code: string;
    finger_card: string;
  };
  location?: {
    department: string;
    department_code: string;
    municipality: string;
    municipality_code: string;
  };
  raw: string;
};

function isDateLike(s: string): boolean {
  return DATE_YYYYMMDD_RE.test(s) || DATE_DDMMYYYY_RE.test(s) || YEAR_ONLY_RE.test(s);
}

function normalizeNum(s: string): string {
  return String(s || "").replace(/[.,\s]/g, "");
}

function isValidCedulaCandidate(value: string): boolean {
  const normalized = normalizeNum(value);
  if (!/^\d{5,11}$/.test(normalized)) return false;
  const stripped = normalized.replace(/^0+/, "");
  if (stripped.length < 4) return false;
  return !isDateLike(normalized) && !isDateLike(stripped);
}

function normalizeCedulaCandidate(value: string): string | null {
  const normalized = normalizeNum(value);
  if (!isValidCedulaCandidate(normalized)) return null;
  return normalized.replace(/^0+/, "") || normalized;
}

function cleanLeadingZeros(s: string): string | null {
  const cleaned = s.replace(/^0+/, "");
  if (cleaned.length < 4) return null;
  return cleaned;
}

function looksBinaryPayload(value: string): boolean {
  const bad = value.split("").filter((char) => char === "�" || (char.charCodeAt(0) < 32 && !"\r\n\t".includes(char))).length;
  const odd = value.split("").filter((char) => char.charCodeAt(0) > 126 && !/[ÁÉÍÓÚÜÑáéíóúüñ]/.test(char)).length;
  return bad + odd >= 3 || (value.length > 80 && (bad + odd) / Math.max(value.length, 1) > 0.02);
}

function cleanTextField(value: string): string {
  const text = String(value || "").toUpperCase().replace(/</g, " ").replace(TEXT_FIELD_RE, " ").replace(/\s+/g, " ").trim();
  return text.length >= 2 ? text : "";
}

function scoreMrzNameSuffix(value: string): number {
  const text = String(value || "").toUpperCase().replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "");
  if (text.length < 2) return -99;
  const vowels = (text.match(/[AEIOUÁÉÍÓÚÜ]/g) || []).length;
  let score = vowels * 3 + Math.min(text.length, 12) * 0.2;
  if (/^[BCDFGHJKLMNPQRSTVWXYZ][AEIOUÁÉÍÓÚÜ]/.test(text)) score += 0.6;
  if (/^[BCDFGHJKLMNPQRSTVWXYZ]{3,}/.test(text)) score -= 6;
  const leadingFiller = text.match(/^[TSILKCF]+/);
  if (leadingFiller && text.length > 8) score -= leadingFiller[0].length * 2;
  if (/(SS|II|LL|TT|KK|CC|FF)/.test(text.slice(0, 6))) score -= 3;
  if (/(.)\1{2,}/.test(text)) score -= 4;
  return score;
}

function cleanMrzNameToken(value: string): string {
  const text = String(value || "").toUpperCase().replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "");
  if (text.length <= 8) return text;
  const prefix = text.slice(0, 10);
  if (!/^[TSILKCF]{4,}/.test(prefix) && !/([TSILKCF])\1{2,}/.test(prefix)) return text;

  let best = text;
  let bestScore = scoreMrzNameSuffix(text);
  for (let i = 3; i < text.length - 1; i += 1) {
    const junk = text.slice(0, i);
    const suffix = text.slice(i);
    if (suffix.length < 2 || !/^[TSILKCF]+$/.test(junk)) continue;
    const score = scoreMrzNameSuffix(suffix) + Math.min(i, 10) * 0.35;
    if (score > bestScore + 0.3) {
      best = suffix;
      bestScore = score;
    }
  }
  return best;
}

function rawToBytes(raw: string): number[] {
  return String(raw || "").split("").map((char) => char.charCodeAt(0) & 0xff);
}

function bytesIncludeAscii(bytes: number[], marker: string): boolean {
  const needle = marker.split("").map((char) => char.charCodeAt(0));
  for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function fieldBytes(bytes: number[], key: keyof typeof PDF417_FIELD_RANGES): number[] {
  const [start, end] = PDF417_FIELD_RANGES[key];
  return bytes.slice(start, Math.min(end, bytes.length));
}

function decodePdf417Field(bytes: number[], text = false): string {
  const untilNull = bytes.slice(0, Math.max(0, bytes.indexOf(0) >= 0 ? bytes.indexOf(0) : bytes.length));
  let value = untilNull.map((code) => String.fromCharCode(code)).join("").replace(/\u0000/g, " ").trim();
  if (text) value = cleanTextField(value);
  return value;
}

function validPdf417Date(year: string, month: string, day: string): boolean {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return false;
  const yyyy = Number(year);
  const mm = Number(month);
  const dd = Number(day);
  return yyyy >= 1900 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

function formatPdf417Date(year: string, month: string, day: string): string {
  return validPdf417Date(year, month, day) ? `${year}-${month}-${day}` : "";
}

function pdf417Location(municipalityCode: string, departmentCode: string): ParsedCedula["location"] {
  const found = SPECIAL_LOCALITIES[`${municipalityCode}-${departmentCode}`];
  return {
    department: found?.department || "",
    department_code: departmentCode,
    municipality: found?.municipality || "",
    municipality_code: municipalityCode,
  };
}

function parseClassicPdf417(raw: string | null | undefined): ParsedCedula {
  const out = emptyParsed(raw);
  if (!raw) return out;
  const bytes = rawToBytes(raw);
  const hasMarker = bytesIncludeAscii(bytes, PDF417_MARKER);
  if (bytes.length < PDF417_MIN_CLASSIC_LEN && !hasMarker) return out;

  const documentRaw = decodePdf417Field(fieldBytes(bytes, "document_number"));
  const documentNumber = documentRaw.replace(/\D/g, "").replace(/^0+/, "");
  const gender = decodePdf417Field(fieldBytes(bytes, "gender")).toUpperCase();
  const birthYear = decodePdf417Field(fieldBytes(bytes, "birth_year"));
  const birthMonth = decodePdf417Field(fieldBytes(bytes, "birth_month"));
  const birthDay = decodePdf417Field(fieldBytes(bytes, "birth_day"));
  if (!isValidCedulaCandidate(documentNumber) || (gender && !["M", "F"].includes(gender))) return out;
  if (!validPdf417Date(birthYear, birthMonth, birthDay) && !hasMarker) return out;

  const firstName = decodePdf417Field(fieldBytes(bytes, "first_name"), true);
  const middleName = decodePdf417Field(fieldBytes(bytes, "middle_name"), true);
  const municipalityCode = decodePdf417Field(fieldBytes(bytes, "municipality_code"));
  const departmentCode = decodePdf417Field(fieldBytes(bytes, "department_code"));
  const bloodType = decodePdf417Field(fieldBytes(bytes, "blood_type")).toUpperCase();
  const afisCode = decodePdf417Field(fieldBytes(bytes, "afis_code"));
  const fingerCard = decodePdf417Field(fieldBytes(bytes, "finger_card"));

  out.cedula = documentNumber;
  out.primer_apellido = decodePdf417Field(fieldBytes(bytes, "last_name"), true);
  out.segundo_apellido = decodePdf417Field(fieldBytes(bytes, "second_last_name"), true);
  out.nombres = [firstName, middleName].filter(Boolean).join(" ");
  out.genero = ["M", "F"].includes(gender) ? gender : "";
  out.fecha_nacimiento = formatPdf417Date(birthYear, birthMonth, birthDay);
  out.tipo_sangre = /^(AB|O|A|B)[+\-]$/.test(bloodType) ? bloodType : "";
  out.formato_detectado = "pdf417_binario_posicional";
  out.afis_code = afisCode;
  out.finger_card = fingerCard;
  out.document_info = {
    document_number: documentNumber,
    afis_code: afisCode,
    finger_card: fingerCard,
  };
  out.location = pdf417Location(municipalityCode, departmentCode);
  return out;
}

function mrzCharValue(char: string): number {
  if (char === "<") return 0;
  if (/\d/.test(char)) return Number(char);
  const code = char.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 55;
  return 0;
}

export function mrzCheckDigit(value: string): number {
  return String(value || "")
    .toUpperCase()
    .split("")
    .reduce((sum, char, index) => sum + mrzCharValue(char) * MRZ_WEIGHTS[index % 3], 0) % 10;
}

function validateMrzField(value: string, checkDigit: string): boolean {
  return /^\d$/.test(checkDigit || "") && mrzCheckDigit(value) === Number(checkDigit);
}

function cleanMrzCandidate(line: string): string {
  let compact = String(line || "")
    .toUpperCase()
    .replace(/[«‹›>\s]/g, (char) => (char === ">" || char === "«" || char === "‹" || char === "›" ? "<" : ""))
    .replace(/[^A-Z0-9<]/g, "");
  if (compact.startsWith("ID<COL")) compact = `IDCOL${compact.slice(6)}`;
  if (compact.startsWith("IC<COL")) compact = `ICCOL${compact.slice(6)}`;
  if (compact.startsWith("1D")) compact = `ID${compact.slice(2)}`;
  if (compact.startsWith("1C")) compact = `IC${compact.slice(2)}`;
  if (compact.length >= 5) {
    const head = compact.slice(0, 5);
    let normalizedHead = head.replace(/0/g, "O");
    if (normalizedHead.startsWith("IDCO") && ["1", "I", "L"].includes(normalizedHead[4])) {
      normalizedHead = "IDCOL";
    }
    if (normalizedHead === "IDCOL") compact = `IDCOL${compact.slice(5)}`;
    else if (normalizedHead.startsWith("ICCO") && ["1", "I", "L"].includes(normalizedHead[4])) {
      compact = `ICCOL${compact.slice(5)}`;
    }
  }
  return compact;
}

function fixMrzDigits(value: string): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[OQDILBSZ]/g, (char) => MRZ_DIGIT_FIXES[char] || char);
}

function formatMrzDate(yymmdd: string, future = false): string {
  if (!DATE_YYMMDD_RE.test(yymmdd || "")) return "";
  const yy = Number(yymmdd.slice(0, 2));
  const currentYy = Number(new Date().getFullYear().toString().slice(2));
  const yyyy = future ? 2000 + yy : (yy > currentYy ? 1900 + yy : 2000 + yy);
  return `${yyyy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

function candidateMrzLines(raw: string): string[] {
  const lines = String(raw || "")
    .toUpperCase()
    .split(/\r?\n/)
    .map(cleanMrzCandidate)
    .filter((line) => MRZ_LINE_RE.test(line))
    .map((line) => line.slice(0, 30).padEnd(30, "<"));
  if (lines.length >= 3) return lines.slice(0, 3);

  const compact = cleanMrzCandidate(String(raw || ""));
  for (const prefix of ["IDCOL", "ICCOL"]) {
    const start = compact.indexOf(prefix);
    if (start >= 0 && compact.length - start >= 85) {
      const chunk = compact.slice(start, start + 90);
      return [
        chunk.slice(0, 30).padEnd(30, "<"),
        chunk.slice(30, 60).padEnd(30, "<"),
        chunk.slice(60, 90).padEnd(30, "<"),
      ];
    }
  }
  return [];
}

export function parseMrz(raw: string | null | undefined): ParsedCedula {
  const out = emptyParsed(raw);
  if (!raw) return out;
  const lines = candidateMrzLines(raw);
  if (lines.length < 3 || (!lines[0].startsWith("IDCOL") && !lines[0].startsWith("ICCOL"))) return out;

  const [l1, l2, l3] = lines;
  const l1Numeric = `${l1.slice(0, 5)}${fixMrzDigits(l1.slice(5))}`;
  const docFieldRaw = fixMrzDigits(l1.slice(5, 14));
  const docCheckRaw = fixMrzDigits(l1[14]).slice(0, 1);
  const extraChar = fixMrzDigits(l1.slice(15, 16));
  let docField = docFieldRaw;
  let docCheck = docCheckRaw;
  const docMatch = l1Numeric.match(/^(?:IDCOL|ICCOL)(\d{5,9})([0-9])/);
  if (docMatch) {
    const candidate = docMatch[1];
    const possibleCheck = docMatch[2];
    if (validateMrzField(candidate.replace(/^0+/, "") || candidate, possibleCheck)) {
      docField = candidate;
      docCheck = possibleCheck;
    } else if (/^\d$/.test(extraChar)) {
      const candidate10 = candidate + possibleCheck;
      if (validateMrzField(candidate10, extraChar)) {
        docField = candidate10;
        docCheck = extraChar;
      }
    }
  }
  const birth = fixMrzDigits(l2.slice(0, 6));
  const birthCheck = fixMrzDigits(l2[6]).slice(0, 1);
  const expiry = fixMrzDigits(l2.slice(8, 14));
  const expiryCheck = fixMrzDigits(l2[14]).slice(0, 1);
  const optionalNuip = fixMrzDigits(l2.slice(18, 29).replace(/</g, ""));
  const nameLine = l3.replace(/0/g, "O").replace(/<+$/g, "");

  const docCedula = normalizeCedulaCandidate(docField.replace(/</g, ""));
  const nuipCedula = normalizeCedulaCandidate(optionalNuip);
  out.cedula = nuipCedula && (!docCedula || nuipCedula.length >= docCedula.length)
    ? nuipCedula
    : (docCedula || "");
  out.genero = ["M", "F"].includes(l2[7]) ? l2[7] : "";
  out.fecha_nacimiento = formatMrzDate(birth);
  out.fecha_expiracion = formatMrzDate(expiry, true);
  out.nacionalidad = l2.slice(15, 18).replace(/0/g, "O").replace(/1/g, "I");
  if (nameLine.includes("<<")) {
    const [lastBlock, firstBlock] = nameLine.split("<<", 2);
    const lastParts = lastBlock.split("<").map(cleanMrzNameToken).filter(Boolean);
    const firstParts = firstBlock.split("<").map(cleanMrzNameToken).filter(Boolean);
    out.primer_apellido = lastParts[0] || "";
    out.segundo_apellido = lastParts.slice(1).join(" ");
    out.nombres = firstParts.join(" ");
  } else {
    const names = nameLine.split("<").map(cleanMrzNameToken).filter(Boolean);
    out.primer_apellido = names[0] || "";
    out.segundo_apellido = names[1] || "";
    out.nombres = names.slice(2).join(" ");
  }
  out.raw_mrz = lines;
  out.mrz_valido = validateMrzField(docField.replace(/^0+/, "") || docField, docCheck)
    && validateMrzField(birth, birthCheck)
    && validateMrzField(expiry, expiryCheck);
  out.formato_detectado = "mrz_td1";
  return out;
}

function emptyParsed(raw: string | null | undefined): ParsedCedula {
  return {
    cedula: "",
    primer_apellido: "",
    segundo_apellido: "",
    nombres: "",
    genero: "",
    fecha_nacimiento: "",
    tipo_sangre: "",
    mrz_valido: false,
    raw_mrz: [],
    raw: raw || "",
  };
}

export function extractCedula(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const classic = parseClassicPdf417(s);
  if (classic.cedula) return classic.cedula;

  const mrz = parseMrz(s);
  const mrzCedula = normalizeCedulaCandidate(mrz.cedula);
  if (mrzCedula) return mrzCedula;

  const numeric = normalizeCedulaCandidate(s);
  if (numeric && /^\d[\d\s.,]*$/.test(s)) {
    return numeric;
  }

  const colombianDash = s.toUpperCase().match(COLOMBIAN_DASH_PAYLOAD_RE);
  if (colombianDash) {
    const cedula = normalizeCedulaCandidate(colombianDash[3]);
    if (cedula) return cedula;
  }

  const dash = s.match(DASH_GENDER_RE);
  if (dash) {
    const cedula = normalizeCedulaCandidate(dash[2]);
    if (cedula) return cedula;
  }

  const pipe = s.match(PIPE_FORMAT_RE);
  if (pipe) {
    const cedula = normalizeCedulaCandidate(pipe[1]);
    if (cedula) return cedula;
  }

  const mrzFirstLine = s.match(MRZ_FIRST_LINE_RE);
  if (mrzFirstLine) {
    const cedula = normalizeCedulaCandidate(mrzFirstLine[1]);
    if (cedula) return cedula;
  }

  const keyValueId = s.match(KEY_VALUE_ID_RE);
  if (keyValueId) {
    const cedula = normalizeCedulaCandidate(keyValueId[1]);
    if (cedula) return cedula;
  }

  const labelId = s.match(NUMBER_LABEL_RE);
  if (labelId) {
    const cedula = normalizeCedulaCandidate(labelId[1]);
    if (cedula) return cedula;
  }

  const grouped = s.match(GROUPED_NUMBER_RE) || [];
  for (const group of grouped) {
    const cedula = normalizeCedulaCandidate(group);
    if (cedula) return cedula;
  }

  const reStandalone = new RegExp(STANDALONE_NUMBER_RE.source, "g");
  let sm: RegExpExecArray | null;
  while ((sm = reStandalone.exec(s)) !== null) {
    const cedula = normalizeCedulaCandidate(sm[1]);
    if (cedula) return cedula;
  }

  let m: RegExpExecArray | null;
  const reGender = new RegExp(AFTER_GENDER_RE.source, "g");
  while ((m = reGender.exec(s)) !== null) {
    const cedula = normalizeCedulaCandidate(m[2]);
    if (cedula) return cedula;
  }

  const candidates: { value: string; pos: number; score: number }[] = [];
  const reRun = new RegExp(DIGIT_RUN_RE.source, "g");
  let cm: RegExpExecArray | null;
  while ((cm = reRun.exec(s)) !== null) {
    const cleaned = normalizeCedulaCandidate(cm[1]);
    if (!cleaned) continue;
    const lenScore = ({ 10: 10, 9: 9, 8: 8, 7: 7, 6: 5, 5: 4, 11: 3 } as Record<number, number>)[cleaned.length] || 1;
    const posFrac = cm.index / Math.max(s.length, 1);
    const leadingZeros = cm[1].length - cm[1].replace(/^0+/, "").length;
    candidates.push({ value: cleaned, pos: cm.index, score: lenScore + Math.max(posFrac, 1 - posFrac) * 1.5 - leadingZeros });
  }
  if (looksBinaryPayload(s)) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value || null;
}

export function parsePdf417(raw: string | null | undefined): ParsedCedula {
  const out = emptyParsed(raw);
  if (!raw) return out;
  const s = String(raw).trim();

  const classic = parseClassicPdf417(s);
  if (classic.cedula) return classic;

  const mrz = parseMrz(s);
  if (mrz.raw_mrz?.length) {
    Object.assign(out, mrz);
    const mrzCedula = normalizeCedulaCandidate(mrz.cedula);
    out.cedula = mrzCedula || "";
  }

  const colombianDash = s.toUpperCase().match(COLOMBIAN_DASH_PAYLOAD_RE);
  if (!out.cedula && colombianDash) {
    out.cedula = normalizeCedulaCandidate(colombianDash[3]) || "";
    out.genero = colombianDash[2];
    out.fecha_expiracion = `${colombianDash[4].slice(0, 4)}-${colombianDash[4].slice(4, 6)}-${colombianDash[4].slice(6, 8)}`;
  }

  const ced = extractCedula(s);
  if (ced && !out.cedula) out.cedula = ced;

  if (s.includes("<") && !out.primer_apellido) {
    const blocks = s.toUpperCase().match(/[A-Z][A-Z<]{3,}/g) || [];
    for (const block of blocks) {
      const parts = block.split("<").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      out.primer_apellido = parts[0] || "";
      out.segundo_apellido = parts[1] || "";
      out.nombres = parts.slice(2).join(" ");
      break;
    }
  } else if (s.includes("|") && !out.primer_apellido) {
    const parts = s.split("|").map((p) => p.trim()).filter(Boolean);
    const names = parts.filter((p) => !/^\d+$/.test(p));
    out.primer_apellido = names[0] || "";
    out.segundo_apellido = names[1] || "";
    out.nombres = names.slice(2, 4).join(" ");
  }

  const gm = s.match(GENERO_FLAT_RE) || s.match(GENERO_RE);
  if (gm && !out.genero) out.genero = gm[1];

  const fm = s.match(FECHA_RE);
  if (fm && !out.fecha_nacimiento && !colombianDash) out.fecha_nacimiento = `${fm[1]}-${fm[2]}-${fm[3]}`;

  const sm = s.toUpperCase().match(SANGRE_RE);
  if (sm) out.tipo_sangre = `${sm[1]}${sm[2]}`;

  out.primer_apellido = cleanTextField(out.primer_apellido);
  out.segundo_apellido = cleanTextField(out.segundo_apellido);
  out.nombres = cleanTextField(out.nombres);

  return out;
}
