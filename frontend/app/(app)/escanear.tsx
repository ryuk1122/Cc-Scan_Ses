import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  FlatList,
  Animated,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system";
import { CameraView, useCameraPermissions } from "expo-camera";

import { theme } from "@/src/theme";
import { useEvento } from "@/src/ctx/evento";
import { api } from "@/src/utils/api";
import { extractCedula, parsePdf417 } from "@/src/utils/cedula";
import { errorMessage } from "@/src/utils/errors";
import { analizarConGemini } from "@/src/services/geminiService";

const PILL_TIMEOUT = 2500;
const RAW_SCAN_COOLDOWN_MS = 900;
const COLOMBIAN_DASH_PAYLOAD_RE = /(?:^|[^A-Z0-9])([A-Z])-\d{5,8}-\d{5,10}-([MF])-(\d{5,11})-((?:19|20)\d{6})(?:[^0-9]|$)/i;
const QR_ID_KEY_RE = /(?:^|[?&#;,\s{\["'])\s*(?:nuip|cedula|c[eé]dula|cc|doc|documento|document_number|documentnumber|numero_documento|n[uú]mero|numero|nro|no|identificacion|identificaci[oó]n|id)\s*["']?\s*[:=/#-]\s*["']?([0-9][0-9\s.,-]{3,20}[0-9])/i;
const QR_PREFIX_RE = /(?:^|[^A-Z0-9])(?:CC|NUIP|DOC|CEDULA|DOCUMENTO|ID)\s*[:#-]?\s*([0-9][0-9\s.,-]{3,20}[0-9])(?:[^0-9]|$)/i;

type AfiliadoPreview = {
  encontrado: boolean;
  cedula: string;
  afiliado?: {
    nombre?: string;
    sede?: string;
    municipio?: string;
    cargo?: string;
    zona?: string;
    titulo?: string;
  };
};

type DocumentPreview = {
  cedula: string;
  nombre: string;
  fecha: string;
  fechaExpiracion?: string;
  fuente?: string;
  mrzValido?: boolean;
};

type Mode = "camera" | "manual";
type ParsedCedulaResult = ReturnType<typeof parsePdf417>;
type ServerParsedCedula = Partial<Pick<
  ParsedCedulaResult,
  | "cedula"
  | "nombres"
  | "primer_apellido"
  | "segundo_apellido"
  | "genero"
  | "fecha_nacimiento"
  | "fecha_expiracion"
  | "tipo_sangre"
  | "mrz_valido"
>>;
type OcrReadResult = { raw: string; serverParsed?: ServerParsedCedula };

function scannedPayload(raw?: string | null, data?: string | null): string {
  for (const value of [raw, data]) {
    const text = String(value || "").trim();
    if (text && !/^(null|undefined)$/i.test(text)) return text;
  }
  return "";
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanQrDigits(value: string): string {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!/^\d{5,11}$/.test(digits)) return "";
  if (/^(19|20)\d{2}$/.test(digits)) return "";
  if (/^(19|20)\d{6}$/.test(digits)) return "";
  return digits;
}

function cleanCedulaNumber(value: string | null | undefined): string {
  return cleanQrDigits(String(value || ""));
}

function bestDigitCandidate(value: string): string {
  const candidates: { digits: string; score: number }[] = [];
  const re = /(^|[^\d])(\d[\d\s.,-]{3,20}\d)(?!\d)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const rawCandidate = match[2];
    const digits = cleanQrDigits(rawCandidate);
    if (!digits) continue;
    const lenScore = ({ 10: 12, 9: 11, 8: 10, 7: 9, 11: 7, 6: 5, 5: 4 } as Record<number, number>)[digits.length] || 1;
    candidates.push({ digits, score: lenScore + (match.index + match[1].length) / Math.max(value.length, 1) });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.digits || "";
}

function extractQrCedulaPayload(raw: string): string {
  const original = String(raw || "").trim();
  if (!original) return "";

  const variants = Array.from(new Set([
    original,
    safeDecodeURIComponent(original),
    original.replace(/&amp;/gi, "&"),
    safeDecodeURIComponent(original.replace(/&amp;/gi, "&")),
  ])).filter(Boolean);

  for (const value of variants) {
    const direct = cleanQrDigits(value);
    if (direct) return direct;

    const keyMatch = value.match(QR_ID_KEY_RE);
    if (keyMatch) {
      const digits = cleanQrDigits(keyMatch[1]);
      if (digits) return digits;
    }

    const prefixed = value.match(QR_PREFIX_RE);
    if (prefixed) {
      const digits = cleanQrDigits(prefixed[1]);
      if (digits) return digits;
    }

    if (/registraduria\.gov\.co|wsp\.registraduria|ceduladigital|cedula/i.test(value)) {
      const candidate = bestDigitCandidate(value);
      if (candidate) return candidate;
    }

    if (/^\s*\{/.test(value)) {
      try {
        const json = JSON.parse(value);
        const stack = [json];
        while (stack.length) {
          const current = stack.pop();
          if (typeof current === "string" || typeof current === "number") {
            const found = extractQrCedulaPayload(String(current));
            if (found) return found;
          } else if (current && typeof current === "object") {
            stack.push(...Object.values(current as Record<string, unknown>));
          }
        }
      } catch {
        // ignore malformed QR JSON
      }
    }
  }

  return "";
}

function isReliableBarcode(raw: string, currentMode: Mode): boolean {
  const value = String(raw || "").trim();
  if (!value) return false;
  if (currentMode === "manual") return true;
  if (extractQrCedulaPayload(value)) return true;
  if (/^\d{5,11}$/.test(value)) return true;
  if (/registraduria\.gov\.co/i.test(value)) return true;
  if (/[?&](nuip|cedula|cc|doc)[=:]?\d{5,11}/i.test(value)) return true;
  if (/^(?:CC|NUIP|DOC|CEDULA)[:\s]?\d{5,11}$/i.test(value)) return true;
  if (value.includes("PubDSK_") || (value.includes("\u0000") && value.length >= 120)) return true;
  const parsed = parsePdf417(value);
  if (parsed.formato_detectado?.startsWith("pdf417_binario")) return true;
  if (
    currentMode === "camera"
    && parsed.cedula
    && (
      value.includes("IDCOL")
      || value.includes("ICCOL")
      || value.includes("<<")
      || value.includes("|")
      || /C[EÉ]DULA|CC|NUIP|DOCUMENTO|NUMERO|NÚMERO|IDENTIFIC/i.test(value)
      || COLOMBIAN_DASH_PAYLOAD_RE.test(value)
    )
  ) return true;
  if (/^\d{5,11}$/.test(value)) return true;
  if (value.includes("IDCOL") || value.includes("ID<COL") || value.includes("ICCOL") || value.includes("IC<COL")) return true;
  if (COLOMBIAN_DASH_PAYLOAD_RE.test(value)) return true;
  if (/^\d{5,11}\|/.test(value)) return true;
  // QR cédulas nuevas: URL Registraduría o payload con nuip/cedula
  if (/registraduria\.gov\.co/i.test(value)) return true;
  if (/[?&](nuip|cedula|cc|doc)[=:]?\d{5,11}/i.test(value)) return true;
  // QR con solo número precedido de prefijo (ej. "CC1023456789" o "NUIP:1023456789")
  if (/^(?:CC|NUIP|DOC|CEDULA)[:\s]?\d{5,11}$/i.test(value)) return true;
  return false;
}

function normalizeQrCedulaPayload(raw: string): string {
  const value = String(raw || "").trim();
  const extracted = extractQrCedulaPayload(value);
  if (extracted) return extracted;
  const qrUrlMatch = value.match(/[?&](?:nuip|cedula|cc|doc)[=:]?(\d{5,11})/i);
  if (qrUrlMatch) return qrUrlMatch[1];

  const prefixedMatch = value.match(/^(?:CC|NUIP|DOC|CEDULA)[:\s]?(\d{5,11})$/i);
  if (prefixedMatch) return prefixedMatch[1];

  if (/registraduria\.gov\.co/i.test(value)) {
    const digitMatch = value.match(/(\d{7,11})/);
    if (digitMatch) return digitMatch[1];
  }

  return value;
}

export default function EscanearScreen() {
  const router = useRouter();
  const {
    eventoId,
    eventoNombre,
    registros,
    scan,
    wsStatus,
    activos,
    duplicadosBloqueados,
    queueSize,
    clearEvento,
  } = useEvento();

  const [mode, setMode] = useState<Mode>("camera");
  const [cedulaInput, setCedulaInput] = useState("");
  const [preview, setPreview] = useState<AfiliadoPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);
  const [iaLoading, setIaLoading] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();
  const [toast, setToast] = useState<{ kind: "ok" | "dup" | "err"; text: string } | null>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const lastRawScanRef = useRef<{ value: string; at: number } | null>(null);
  const scanBusyRef = useRef(false);
  const iaLoadingRef = useRef(false);
  const ocrLoadingRef = useRef(false);
  const barcodeLoadingRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const cameraRef = useRef<any>(null);
  const [reticleHeight, setReticleHeight] = useState(0);

  const showToast = useCallback((kind: "ok" | "dup" | "err", text: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ kind, text });
    toastTimerRef.current = setTimeout(() => setToast(null), PILL_TIMEOUT);
  }, []);

  const flashDuplicate = useCallback(() => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: false }).start();
  }, [flashAnim]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const buildDocumentPreview = useCallback((cedula: string, parsed: ReturnType<typeof parsePdf417>, fuente?: string): DocumentPreview => {
    const nombre = [
      parsed.nombres,
      parsed.primer_apellido,
      parsed.segundo_apellido,
    ].filter(Boolean).join(" ").trim();
    return {
      cedula,
      nombre,
      fecha: parsed.fecha_nacimiento || parsed.fecha_expiracion || "",
      fechaExpiracion: parsed.fecha_expiracion,
      fuente,
      mrzValido: parsed.mrz_valido,
    };
  }, []);

  useEffect(() => {
  if (mode === "camera" && !permission?.granted && permission?.canAskAgain !== false) {
      requestPermission();
    }
  }, [mode, permission, requestPermission]);

  useEffect(() => {
    if (mode !== "camera") {
      scanLineAnim.stopAnimation();
      scanLineAnim.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [mode, scanLineAnim]);

  const lookupAfiliado = useCallback(async (cedula: string) => {
    setPreviewLoading(true);
    try {
      const r = await api.lookupAfiliado(cedula);
      setPreview(r as AfiliadoPreview);
    } catch {
      setPreview({ encontrado: false, cedula });
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const captureCameraBase64 = useCallback(async (quality: number): Promise<string> => {
    if (!cameraRef.current) return "";
    if (typeof cameraRef.current.takePhoto === "function") {
      const photo = await cameraRef.current.takePhoto({ flash: "off" });
      const path = photo?.path ? String(photo.path) : "";
      if (!path) return "";
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      return FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    }

    const photo = await cameraRef.current.takePictureAsync({
      quality,
      base64: true,
      skipProcessing: false,
    });
    return photo?.base64 || "";
  }, []);

  const readCameraWithGemini = useCallback(async (imageBase64?: string): Promise<ServerParsedCedula | null> => {
    if ((!imageBase64 && !cameraRef.current) || iaLoadingRef.current) return null;
    iaLoadingRef.current = true;
    setIaLoading(true);
    try {
      const b64 = imageBase64 || await captureCameraBase64(0.92);
      if (!b64) return null;
      const iaResult = await analizarConGemini(b64);
      return iaResult?.cedula ? iaResult : null;
    } catch {
      return null;
    } finally {
      iaLoadingRef.current = false;
      setIaLoading(false);
    }
  }, [captureCameraBase64]);

  const readCameraWithOcr = useCallback(async (imageBase64?: string): Promise<OcrReadResult> => {
    if ((!imageBase64 && !cameraRef.current) || ocrLoadingRef.current) return { raw: "" };
    ocrLoadingRef.current = true;
    setOcrLoading(true);
    try {
      const b64 = imageBase64 || await captureCameraBase64(0.72);
      if (!b64) return { raw: "" };
      const res = await api.ocrCedula(b64);
      if (res.ok && res.cedula) {
        const raw = res.raw_mrz?.length ? res.raw_mrz.join("\n") : (res.texto_completo || res.cedula);
        const serverParsed = res.parsed && Object.keys(res.parsed).length > 0 ? res.parsed : undefined;
        return { raw, serverParsed };
      }
      return { raw: "" };
    } catch {
      return { raw: "" };
    } finally {
      ocrLoadingRef.current = false;
      setOcrLoading(false);
    }
  }, [captureCameraBase64]);

  const readCameraBarcode = useCallback(
    async (silent = false, imageBase64?: string, options: { preferMrz?: boolean } = {}): Promise<OcrReadResult> => {
      if ((!imageBase64 && !cameraRef.current) || barcodeLoadingRef.current) return { raw: "" };
      barcodeLoadingRef.current = true;
      setBarcodeLoading(true);
      try {
        const b64 = imageBase64 || await captureCameraBase64(0.82);
        if (!b64) return { raw: "" };
        const res = await api.barcodeCedula(b64, { preferMrz: !!options.preferMrz });
        if (res.ok && res.cedula) {
          const raw = res.raw || res.raw_mrz?.join("\n") || res.cedula;
          const serverParsed = res.parsed && Object.keys(res.parsed).length > 0 ? res.parsed : undefined;
          return { raw, serverParsed };
        }
        return { raw: "" };
      } catch (e: any) {
        if (!silent) showToast("err", errorMessage(e, "Error leyendo barras"));
        return { raw: "" };
      } finally {
        barcodeLoadingRef.current = false;
        setBarcodeLoading(false);
      }
    },
    [captureCameraBase64, showToast],
  );

  const handleScan = useCallback(
    async (raw: string, options: { skipBarcodeFallback?: boolean; serverParsed?: ServerParsedCedula } = {}) => {
      if (scanBusyRef.current) return;
      scanBusyRef.current = true;
      try {
        let rawToUse = normalizeQrCedulaPayload(raw);
        let inheritedServerParsed = options.serverParsed;
        const hasServerParsed = () => !!inheritedServerParsed && Object.keys(inheritedServerParsed).length > 0;
        const canUseServerParsed = () => hasServerParsed() && !!cleanCedulaNumber(inheritedServerParsed?.cedula);

        if (!canUseServerParsed() && !isReliableBarcode(rawToUse, mode)) {
          if (mode === "camera") {
            showToast("err", "Codigo incompleto. Probando lector dedicado...");
            const barcodeResult: OcrReadResult = options.skipBarcodeFallback ? { raw: "" } : await readCameraBarcode(false, undefined, { preferMrz: true });
            let fallbackRaw = barcodeResult.raw;
            if (barcodeResult.serverParsed) inheritedServerParsed = barcodeResult.serverParsed;
            if (!fallbackRaw) {
              const ocrResult = await readCameraWithOcr();
              fallbackRaw = ocrResult.raw;
              inheritedServerParsed = ocrResult.serverParsed;
            }
            if (fallbackRaw) {
              rawToUse = normalizeQrCedulaPayload(fallbackRaw);
            } else {
              // Fallback Gemini IA — último recurso dentro de handleScan
              showToast("err", "Intentando con IA...");
              const iaResult = await readCameraWithGemini();
              const iaCedula = cleanCedulaNumber(iaResult?.cedula);
              if (iaCedula) {
                rawToUse = iaCedula;
                inheritedServerParsed = iaResult || undefined;
              } else {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                showToast("err", "No pude leerla. Alinea la cedula completa y evita reflejos.");
                return;
              }
            }
          } else {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            showToast("err", "No pude confirmar la cédula.");
            return;
          }
        }

        const parsed: ParsedCedulaResult = canUseServerParsed()
          ? {
              cedula: inheritedServerParsed?.cedula || "",
              nombres: inheritedServerParsed?.nombres || "",
              primer_apellido: inheritedServerParsed?.primer_apellido || "",
              segundo_apellido: inheritedServerParsed?.segundo_apellido || "",
              genero: inheritedServerParsed?.genero || "",
              fecha_nacimiento: inheritedServerParsed?.fecha_nacimiento || "",
              fecha_expiracion: inheritedServerParsed?.fecha_expiracion || "",
              tipo_sangre: inheritedServerParsed?.tipo_sangre || "",
              formato_detectado: "ocr_servidor",
              mrz_valido: inheritedServerParsed?.mrz_valido,
              raw_mrz: [],
              raw: rawToUse,
            }
          : parsePdf417(rawToUse);
        const cedula = cleanCedulaNumber(parsed.cedula || extractCedula(rawToUse) || "");
        if (!cedula) {
          showToast("err", "No pude confirmar la cédula. Usa la camara completa o manual.");
          return;
        }
        setDocumentPreview(buildDocumentPreview(cedula, parsed, parsed.formato_detectado || "camara"));
        const now = Date.now();
        if (lastScanRef.current && lastScanRef.current.value === cedula && now - lastScanRef.current.at < 1500) {
          return;
        }
        lastScanRef.current = { value: cedula, at: now };

        const res = await scan(cedula, {
          raw_barcode: rawToUse,
          primer_apellido: parsed.primer_apellido,
          segundo_apellido: parsed.segundo_apellido,
          nombres: parsed.nombres,
          genero: parsed.genero,
          fecha_nacimiento: parsed.fecha_nacimiento,
          fecha_expiracion: parsed.fecha_expiracion,
          tipo_sangre: parsed.tipo_sangre,
        } as any);
        if (res.ok) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showToast("ok", `Cédula ${cedula} registrada`);
        } else if (res.duplicate) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          flashDuplicate();
          showToast("dup", `Atención: ${cedula} ya registrada`);
        } else {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showToast("err", res.mensaje);
        }
      } finally {
        scanBusyRef.current = false;
      }
    },
    [mode, scan, showToast, flashDuplicate, readCameraBarcode, readCameraWithOcr, readCameraWithGemini, buildDocumentPreview],
  );

  const captureAndDecodeBarcode = useCallback(async () => {
    if (!cameraRef.current) return;

    const imageBase64 = await captureCameraBase64(0.92);
    if (!imageBase64) {
      showToast("err", "No pude tomar la foto. Intenta de nuevo.");
      return;
    }

    showToast("err", "Analizando con IA...");
    const iaResult = await readCameraWithGemini(imageBase64);
    const iaCedula = cleanCedulaNumber(iaResult?.cedula);
    if (iaCedula) {
      await handleScan(iaCedula, {
        skipBarcodeFallback: true,
        serverParsed: iaResult || undefined,
      });
      return;
    }

    showToast("err", "IA sin resultado. Intentando OCR/MRZ...");
    const ocrResult = await readCameraWithOcr(imageBase64);
    if (ocrResult.raw) {
      await handleScan(ocrResult.raw, {
        skipBarcodeFallback: true,
        serverParsed: ocrResult.serverParsed,
      });
      return;
    }

    showToast("err", "OCR sin resultado. Intentando QR, barras y MRZ...");
    const barcodeResult = await readCameraBarcode(false, imageBase64, { preferMrz: true });
    if (barcodeResult.raw) {
      await handleScan(barcodeResult.raw, {
        skipBarcodeFallback: true,
        serverParsed: barcodeResult.serverParsed,
      });
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    showToast("err", "No pude leer la cedula. Acerca la camara, enfoca y evita reflejos.");
  }, [captureCameraBase64, handleScan, readCameraBarcode, readCameraWithOcr, readCameraWithGemini, showToast]);

  // Auto-lookup as user types in manual mode (debounced)
  useEffect(() => {
    if (mode !== "manual") return;
    const cedula = extractCedula(cedulaInput);
    if (!cedula || cedula.length < 6) {
      setPreview(null);
      return;
    }
    const id = setTimeout(() => lookupAfiliado(cedula), 350);
    return () => clearTimeout(id);
  }, [cedulaInput, mode, lookupAfiliado]);

  const onManualSubmit = async () => {
    const cedula = extractCedula(cedulaInput);
    if (!cedula) {
      Alert.alert("Cédula inválida", "Ingresa un número entre 6 y 11 dígitos");
      return;
    }
    await handleScan(cedula);
    setCedulaInput("");
    setPreview(null);
  };


  const statusColor = wsStatus === "online" ? theme.success : wsStatus === "connecting" ? theme.warning : theme.error;
  const statusLabel = wsStatus === "online" ? "En linea" : wsStatus === "connecting" ? "Conectando..." : "Sin tiempo real";
  const recientes = useMemo(() => registros.slice(0, 5), [registros]);

  if (!eventoId) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.emptyWrap}>
          <Ionicons name="calendar-outline" size={64} color={theme.textDisabled} />
          <Text style={styles.emptyTitle}>Selecciona un evento</Text>
          <Text style={styles.emptySub}>Necesitas un evento activo para escanear cédulas.</Text>
          <TouchableOpacity testID="go-to-eventos" style={styles.primaryBtn} onPress={() => router.push("/(app)/eventos")}>
            <Text style={styles.primaryBtnText}>Ir a Eventos</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const flashBg = flashAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(255,59,48,0)", "rgba(255,59,48,0.35)"] });
  const scanLineTranslateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.max(reticleHeight - 3, 0)],
  });

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: flashBg, zIndex: 100 }]} />

      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventTitle} numberOfLines={1}>{eventoNombre}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text testID="sync-status-indicator" style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            <Text style={styles.statusMeta}> · {activos} dispositivos · cola {queueSize}</Text>
          </View>
        </View>
        <View style={styles.topActions}>
          <TouchableOpacity testID="change-event-button" style={styles.switchEventBtn} onPress={clearEvento}>
            <Ionicons name="swap-horizontal" size={18} color={theme.text} />
          </TouchableOpacity>
          <View style={styles.counterPill}>
            <Text testID="scan-counter" style={styles.counterValue}>{registros.length}</Text>
            <Text style={styles.counterLabel}>escaneadas</Text>
          </View>
        </View>
      </View>

      <View style={styles.modeRow}>
        <TouchableOpacity
          testID="mode-camera-toggle"
          style={[styles.modeBtn, mode === "camera" && styles.modeBtnActive]}
          onPress={() => setMode("camera")}
        >
          <Ionicons name="scan" size={16} color={mode === "camera" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.modeText, mode === "camera" && { color: "#fff" }]}>Camara</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="manual-entry-toggle"
          style={[styles.modeBtn, mode === "manual" && styles.modeBtnActive]}
          onPress={() => setMode("manual")}
        >
          <Ionicons name="keypad" size={16} color={mode === "manual" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.modeText, mode === "manual" && { color: "#fff" }]}>Manual</Text>
        </TouchableOpacity>
      </View>

      {mode === "camera" ? (
        <View style={styles.cameraWrap} testID="scanner-camera-view">
          {!permission ? (
            <View style={styles.camPlaceholder}><Text style={styles.permText}>Iniciando cámara...</Text></View>
          ) : !permission.granted ? (
            <View style={styles.camPlaceholder}>
              <Ionicons name="camera-outline" size={56} color={theme.textSecondary} />
              <Text style={styles.permTitle}>Acceso a la cámara</Text>
              <Text style={styles.permText}>Para leer PDF417, QR, MRZ o numero impreso.</Text>
              <TouchableOpacity testID="grant-camera-permission" style={styles.primaryBtn} onPress={() => requestPermission()}>
                <Text style={styles.primaryBtnText}>Otorgar permiso</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <CameraView
  ref={cameraRef}
  style={StyleSheet.absoluteFillObject}
  facing="back"
  autofocus="on"
  barcodeScannerSettings={{
    barcodeTypes: ["pdf417", "qr"],
  }}
  onBarcodeScanned={({ raw, data }) => {
    const payload = scannedPayload(raw, data);
    if (!payload) return;
    const normalized = normalizeQrCedulaPayload(payload);
    const now = Date.now();
    if (
      lastRawScanRef.current
      && lastRawScanRef.current.value === normalized
      && now - lastRawScanRef.current.at < RAW_SCAN_COOLDOWN_MS
    ) {
      return;
    }
    lastRawScanRef.current = { value: normalized, at: now };
    if (!isReliableBarcode(normalized, mode)) return;
    void handleScan(normalized, { skipBarcodeFallback: true });
              }}>
              <View style={styles.reticleOverlay} pointerEvents="none">
                <View
                  style={[styles.reticle, styles.backReticle]}
                  onLayout={({ nativeEvent }) => setReticleHeight(nativeEvent.layout.height)}
                >
                  <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineTranslateY }] }]} />
                  <View style={[styles.reticleCorner, styles.reticleCornerTopLeft]} />
                  <View style={[styles.reticleCorner, styles.reticleCornerTopRight]} />
                  <View style={[styles.reticleCorner, styles.reticleCornerBottomLeft]} />
                  <View style={[styles.reticleCorner, styles.reticleCornerBottomRight]} />
                  <View style={styles.qrGuide} />
                  <View style={styles.mrzGuide}>
                    <View style={styles.mrzGuideLine} />
                    <View style={styles.mrzGuideLine} />
                    <View style={styles.mrzGuideLine} />
                  </View>
                </View>
                <Text style={styles.reticleHint}>Centra la cedula: barras, QR o MRZ</Text>
              </View>
              <View style={styles.captureBar}>
                <TouchableOpacity
                  testID="decode-pdf417-photo-btn"
                  style={[styles.captureBtn, (barcodeLoading || ocrLoading || iaLoading) && { opacity: 0.6 }]}
                  onPress={captureAndDecodeBarcode}
                  disabled={barcodeLoading || ocrLoading || iaLoading}
                >
                  {barcodeLoading || ocrLoading || iaLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="scan-circle" size={24} color="#fff" />
                      <Text style={styles.captureBtnText}>Leer cedula</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </CameraView>
          )}
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.manualScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.manualCard}>
              <Text style={styles.manualLabel}>Cédula</Text>
              <TextInput
                testID="manual-cedula-input"
                style={[styles.manualInput, { fontSize: 28, fontWeight: "900", letterSpacing: 2, textAlign: "center" }]}
                value={cedulaInput}
                onChangeText={(t) => setCedulaInput(t.replace(/\D/g, ""))}
                placeholder="123456789"
                placeholderTextColor={theme.textDisabled}
                keyboardType="number-pad"
                autoFocus
                maxLength={11}
              />

              {/* Afiliado preview */}
              {previewLoading && (
                <View style={styles.previewWrap}>
                  <ActivityIndicator size="small" color={theme.brand} />
                  <Text style={styles.previewMeta}>Buscando en base de datos...</Text>
                </View>
              )}
              {!previewLoading && preview && preview.encontrado && preview.afiliado && (
                <View testID="afiliado-preview" style={[styles.previewWrap, { borderColor: theme.success, backgroundColor: theme.successBg }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="checkmark-circle" size={20} color={theme.success} />
                    <Text style={[styles.previewTitle, { color: theme.success }]}>Docente encontrado</Text>
                  </View>
                  <Text style={styles.previewName} numberOfLines={2}>{preview.afiliado.nombre || "(sin nombre)"}</Text>
                  <Text style={styles.previewMeta}>Docente: SI</Text>
                  <Text style={styles.previewMeta}>CC {preview.cedula}</Text>
                  {!!preview.afiliado.cargo && <Text style={styles.previewMeta}>Cargo: {preview.afiliado.cargo}</Text>}
                  {!!preview.afiliado.municipio && <Text style={styles.previewMeta}>Municipio: {preview.afiliado.municipio}</Text>}
                </View>
              )}
              {!previewLoading && preview && !preview.encontrado && (
                <View style={[styles.previewWrap, { borderColor: theme.warning, backgroundColor: theme.warningBg }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="alert-circle" size={20} color={theme.warning} />
                    <Text style={[styles.previewTitle, { color: theme.warning }]}>No esta en la base interna</Text>
                  </View>
                  <Text style={styles.previewMeta}>Se registrara solo con la CC leida.</Text>
                </View>
              )}

              <TouchableOpacity testID="manual-submit-button" style={styles.submitBtn} onPress={onManualSubmit}>
                <Ionicons name="checkmark-circle" size={22} color="#fff" />
                <Text style={styles.submitBtnText}>Registrar</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {documentPreview && (
        <View style={styles.documentPreview}>
          <View style={styles.documentPreviewHeader}>
            <Ionicons name="card-outline" size={17} color={theme.brand} />
            <Text style={styles.documentPreviewTitle}>Lectura documento</Text>
            {!!documentPreview.fuente && <Text style={styles.documentPreviewSource}>{documentPreview.fuente}</Text>}
          </View>
          <View style={styles.documentPreviewGrid}>
            <View style={styles.documentPreviewCell}>
              <Text style={styles.documentPreviewLabel}>CC</Text>
              <Text style={styles.documentPreviewValue}>{documentPreview.cedula}</Text>
            </View>
            <View style={styles.documentPreviewCell}>
              <Text style={styles.documentPreviewLabel}>Fecha</Text>
              <Text style={styles.documentPreviewValue}>{documentPreview.fecha || "-"}</Text>
            </View>
          </View>
          {!!documentPreview.nombre && <Text style={styles.documentPreviewName} numberOfLines={1}>{documentPreview.nombre}</Text>}
          {!!documentPreview.fechaExpiracion && documentPreview.fechaExpiracion !== documentPreview.fecha && (
            <Text style={styles.documentPreviewMeta}>Vence {documentPreview.fechaExpiracion}</Text>
          )}
        </View>
      )}

      {/* Recientes */}
      <View style={styles.recentWrap}>
        <View style={styles.recentHeader}>
          <Text style={styles.recentTitle}>Recientes</Text>
          <Text style={styles.recentMeta}>{duplicadosBloqueados} duplicados bloqueados</Text>
        </View>
        <FlatList
          data={recientes}
          keyExtractor={(it) => it.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          ListEmptyComponent={<Text style={styles.recentEmpty}>Aún no hay escaneos.</Text>}
          renderItem={({ item }) => (
            <View style={styles.recentChip}>
              <Text style={styles.recentCedula}>{item.cedula}</Text>
              <Text style={styles.recentField}>{item.es_afiliado ? "Docente: SI" : "Docente: NO"}</Text>
              {!!item.nombre && <Text style={styles.recentName} numberOfLines={1}>{item.nombre}</Text>}
              {!!item.cargo && <Text style={styles.recentField} numberOfLines={1}>{item.cargo}</Text>}
              {!!item.municipio && <Text style={styles.recentField} numberOfLines={1}>{item.municipio}</Text>}
            </View>
          )}
        />
      </View>

      {toast && (
        <View
          testID="scan-toast"
          style={[
            styles.toast,
            toast.kind === "ok" && { backgroundColor: theme.successBg, borderColor: theme.success },
            toast.kind === "dup" && { backgroundColor: theme.errorBg, borderColor: theme.error },
            toast.kind === "err" && { backgroundColor: theme.warningBg, borderColor: theme.warning },
          ]}
        >
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  topBar: { flexDirection: "row", paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8, alignItems: "center", gap: 10 },
  eventTitle: { color: theme.text, fontSize: 17, fontWeight: "900" },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontWeight: "700", fontSize: 12 },
  statusMeta: { color: theme.textDisabled, fontSize: 11 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  switchEventBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  counterPill: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, alignItems: "center" },
  counterValue: { color: theme.text, fontSize: 22, fontWeight: "900" },
  counterLabel: { color: theme.textDisabled, fontSize: 9, textTransform: "uppercase", letterSpacing: 1 },
  modeRow: { flexDirection: "row", marginHorizontal: 14, marginBottom: 8, backgroundColor: theme.surface, borderRadius: 8, padding: 3, borderWidth: 1, borderColor: theme.border },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: 6, gap: 6 },
  modeBtnActive: { backgroundColor: theme.brand },
  modeText: { color: theme.textSecondary, fontWeight: "700", fontSize: 13 },
  cameraWrap: { flex: 1, marginHorizontal: 8, borderRadius: 8, overflow: "hidden", backgroundColor: "#000", borderWidth: 1, borderColor: theme.border },
  camPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  permTitle: { color: theme.text, fontSize: 18, fontWeight: "800" },
  permText: { color: theme.textSecondary, fontSize: 13, textAlign: "center" },
  reticleOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  reticle: { width: "100%", maxWidth: 720, aspectRatio: 1.586, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.12)" },
  backReticle: { justifyContent: "space-between", padding: 16 },
  scanLine: { position: "absolute", top: 0, left: 0, right: 0, height: 3, backgroundColor: theme.brandNeon, opacity: 0.95, shadowColor: theme.brandNeon, shadowOpacity: 0.8, shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, zIndex: 3 },
  reticleCorner: { position: "absolute", width: 38, height: 38, borderColor: "#fff", zIndex: 4 },
  reticleCornerTopLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  reticleCornerTopRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  reticleCornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  reticleCornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  qrGuide: { alignSelf: "flex-end", width: "22%", aspectRatio: 1, borderWidth: 2, borderColor: "#fff", borderRadius: 6, backgroundColor: "rgba(255,255,255,0.08)" },
  mrzGuide: { gap: 5 },
  mrzGuideLine: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.75)" },
  reticleHint: { color: "#fff", marginTop: 12, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, fontSize: 12 },
  captureBar: { position: "absolute", bottom: 24, left: 0, right: 0, alignItems: "center" },
  captureBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.brand,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
    shadowColor: theme.brand,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  captureBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  manualScroll: { padding: 16, paddingBottom: 24 },
  manualCard: { backgroundColor: theme.surface, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: theme.border, gap: 8 },
  manualLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 10 },
  manualInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 16, color: theme.text, fontSize: 15 },
  previewWrap: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8, gap: 4 },
  previewTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  previewName: { color: theme.text, fontWeight: "800", fontSize: 16, marginTop: 4 },
  previewMeta: { color: theme.textSecondary, fontSize: 13 },
  submitBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: theme.brand, paddingVertical: 16, borderRadius: 8, marginTop: 16 },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  documentPreview: { marginHorizontal: 14, marginTop: 10, padding: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 8, gap: 8 },
  documentPreviewHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  documentPreviewTitle: { color: theme.text, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  documentPreviewSource: { marginLeft: "auto", color: theme.textDisabled, fontWeight: "700", fontSize: 11 },
  documentPreviewGrid: { flexDirection: "row", gap: 8 },
  documentPreviewCell: { flex: 1, backgroundColor: theme.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  documentPreviewLabel: { color: theme.textDisabled, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  documentPreviewValue: { color: theme.text, fontSize: 15, fontWeight: "900", marginTop: 2 },
  documentPreviewName: { color: theme.textSecondary, fontSize: 13, fontWeight: "700" },
  documentPreviewMeta: { color: theme.textDisabled, fontSize: 11 },
  recentWrap: { paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, borderColor: theme.border, backgroundColor: theme.bg },
  recentHeader: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 8 },
  recentTitle: { color: theme.text, fontWeight: "800", fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  recentMeta: { color: theme.error, fontSize: 11, fontWeight: "700" },
  recentEmpty: { color: theme.textDisabled, fontSize: 12, paddingHorizontal: 16 },
  recentChip: { backgroundColor: theme.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.border, minWidth: 148, maxWidth: 220 },
  recentCedula: { color: theme.text, fontWeight: "800", fontSize: 14 },
  recentName: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  recentField: { color: theme.textDisabled, fontSize: 10, marginTop: 1 },
  toast: { position: "absolute", top: 80, left: 20, right: 20, padding: 14, borderRadius: 14, borderWidth: 1, zIndex: 200 },
  toastText: { color: theme.text, fontWeight: "800", fontSize: 14, textAlign: "center" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { color: theme.text, fontSize: 20, fontWeight: "800" },
  emptySub: { color: theme.textSecondary, textAlign: "center" },
  primaryBtn: { backgroundColor: theme.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 12 },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
