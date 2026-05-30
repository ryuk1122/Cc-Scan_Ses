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

const PILL_TIMEOUT = 2500;
const COLOMBIAN_DASH_PAYLOAD_RE = /(?:^|[^A-Z0-9])([A-Z])-\d{5,8}-\d{5,10}-([MF])-(\d{5,11})-((?:19|20)\d{6})(?:[^0-9]|$)/i;

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

type Mode = "camera" | "frente" | "manual";

function isReliableBarcode(raw: string, currentMode: Mode): boolean {
  const value = String(raw || "").trim();
  if (!value) return false;
  if (currentMode === "manual" || currentMode === "frente") return true;
  if (value.includes("PubDSK_") || (value.includes("\u0000") && value.length >= 120)) return true;
  if (parsePdf417(value).formato_detectado?.startsWith("pdf417_binario")) return true;
  if (/^\d{5,11}$/.test(value)) return true;
  if (value.includes("IDCOL") || value.includes("ID<COL")) return true;
  if (COLOMBIAN_DASH_PAYLOAD_RE.test(value)) return true;
  if (/^\d{5,11}\|/.test(value)) return true;
  return false;
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
  } = useEvento();

  const [mode, setMode] = useState<Mode>("camera");
  const [cedulaInput, setCedulaInput] = useState("");
  const [preview, setPreview] = useState<AfiliadoPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [barcodeLoading, setBarcodeLoading] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();
  const [toast, setToast] = useState<{ kind: "ok" | "dup" | "err"; text: string } | null>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const scanBusyRef = useRef(false);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const cameraRef = useRef<any>(null);

  const showToast = useCallback((kind: "ok" | "dup" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), PILL_TIMEOUT);
  }, []);

  const flashDuplicate = useCallback(() => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: false }).start();
  }, [flashAnim]);

  useEffect(() => {
    if ((mode === "camera" || mode === "frente") && !permission?.granted && permission?.canAskAgain !== false) {
      requestPermission();
    }
  }, [mode, permission, requestPermission]);

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

  const readCameraWithOcr = useCallback(async (): Promise<string> => {
    if (!cameraRef.current || ocrLoading) return "";
    setOcrLoading(true);
    try {
      let b64 = "";
      if (typeof cameraRef.current.takePhoto === "function") {
        const photo = await cameraRef.current.takePhoto({ flash: "off" });
        const uri = String(photo?.path || "").startsWith("file://") ? photo.path : `file://${photo?.path}`;
        b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
      } else {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.75,
          base64: true,
          skipProcessing: false,
        });
        b64 = photo?.base64 || "";
      }
      if (!b64) return "";
      const res = await api.ocrCedula(b64);
      if (res.ok && res.cedula) {
        return res.raw_mrz?.length ? res.raw_mrz.join("\n") : (res.texto || res.cedula);
      }
      return "";
    } catch {
      return "";
    } finally {
      setOcrLoading(false);
    }
  }, [ocrLoading]);

  const readCameraBarcode = useCallback(async (): Promise<string> => {
    if (!cameraRef.current || barcodeLoading) return "";
    setBarcodeLoading(true);
    try {
      let b64 = "";
      if (typeof cameraRef.current.takePhoto === "function") {
        const photo = await cameraRef.current.takePhoto({ flash: "off" });
        const uri = String(photo?.path || "").startsWith("file://") ? photo.path : `file://${photo?.path}`;
        b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
      } else {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.9,
          base64: true,
          skipProcessing: false,
        });
        b64 = photo?.base64 || "";
      }
      if (!b64) return "";
      const res = await api.barcodeCedula(b64);
      if (res.ok && res.cedula) {
        return res.raw || res.cedula;
      }
      return "";
    } catch (e: any) {
      showToast("err", errorMessage(e, "Error leyendo barras"));
      return "";
    } finally {
      setBarcodeLoading(false);
    }
  }, [barcodeLoading, showToast]);

  const handleScan = useCallback(
    async (raw: string) => {
      if (scanBusyRef.current) return;
      scanBusyRef.current = true;
      try {
      let rawToUse = raw;
      if (!isReliableBarcode(rawToUse, mode)) {
        if (mode === "camera") {
          showToast("err", "Código incompleto. Probando OCR del reverso...");
          const fallbackRaw = await readCameraWithOcr();
          if (fallbackRaw) {
            rawToUse = fallbackRaw;
          } else {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            showToast("err", "No pude leerla. Acerca el número impreso o usa Manual.");
            return;
          }
        } else {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showToast("err", "No pude confirmar la cédula.");
          return;
        }
      }
      const parsed = parsePdf417(rawToUse);
      const cedula = parsed.cedula || extractCedula(rawToUse);
      if (!cedula) {
        showToast("err", "No pude confirmar la cédula. Usa el frente/OCR o manual.");
        return;
      }
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
    [mode, scan, showToast, flashDuplicate, readCameraWithOcr],
  );

  const captureAndOcr = useCallback(async () => {
    if (!cameraRef.current || ocrLoading) return;
    try {
      const parsedRaw = await readCameraWithOcr();
      if (parsedRaw) {
        await handleScan(parsedRaw);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast("err", "No se detectó número. Acerca la cámara al número de la cédula.");
      }
    } catch (e: any) {
      showToast("err", errorMessage(e, "Error en OCR"));
    }
  }, [handleScan, ocrLoading, readCameraWithOcr, showToast]);

  const captureAndDecodeBarcode = useCallback(async () => {
    const raw = await readCameraBarcode();
    if (raw) {
      await handleScan(raw);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showToast("err", "No detecté PDF417. Llena el recuadro con el código y evita reflejos.");
    }
  }, [handleScan, readCameraBarcode, showToast]);

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
  const statusLabel = wsStatus === "online" ? "En línea" : wsStatus === "connecting" ? "Conectando..." : "Offline";
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
        <View style={styles.counterPill}>
          <Text testID="scan-counter" style={styles.counterValue}>{registros.length}</Text>
          <Text style={styles.counterLabel}>escaneadas</Text>
        </View>
      </View>

      <View style={styles.modeRow}>
        <TouchableOpacity
          testID="mode-camera-toggle"
          style={[styles.modeBtn, mode === "camera" && styles.modeBtnActive]}
          onPress={() => setMode("camera")}
        >
          <Ionicons name="barcode" size={16} color={mode === "camera" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.modeText, mode === "camera" && { color: "#fff" }]}>Barras</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="mode-frente-toggle"
          style={[styles.modeBtn, mode === "frente" && styles.modeBtnActive]}
          onPress={() => setMode("frente")}
        >
          <Ionicons name="card" size={16} color={mode === "frente" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.modeText, mode === "frente" && { color: "#fff" }]}>Frente</Text>
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
              <Text style={styles.permText}>Para escanear el PDF417 de la cédula colombiana.</Text>
              <TouchableOpacity testID="grant-camera-permission" style={styles.primaryBtn} onPress={() => requestPermission()}>
                <Text style={styles.primaryBtnText}>Otorgar permiso</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <<CameraView
  ref={cameraRef}
  style={StyleSheet.absoluteFillObject}
  facing="back"
  barcodeScannerSettings={{
    barcodeTypes: ["pdf417"], // Enfocado solo en cédulas
  }}
  onBarcodeScanned={({ data }) => {
    // 1. Bloqueo síncrono inmediato para que no se acumulen peticiones
    if (scanBusyRef.current) return;
    scanBusyRef.current = true;

    // Si el string no tiene la estructura mínima de una cédula, descartamos rápido
    if (!data || data.length < 50) {
      scanBusyRef.current = false;
      return;
    }

    console.log("[FRONTEND] ⚡ ¡Código enganchado en tiempo real! Enviando texto crudo...");

    (async () => {
      try {
        if (Platform.OS !== "web") {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }

        // 🚀 CAMBIO CLAVE: Enviamos el string 'data' crudo directamente.
        // Ya no esperamos a que la cámara tome una foto, reduciendo el delay a CERO.
        const response = await fetch(`http://192.168.1.166:8001/api/ocr/cedula`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            is_raw_string: true, // Le avisamos al backend que no es una foto, sino el texto directo
            raw_data: data 
          }),
        });

        const resData = await response.json();
        
        if (resData.ok) {
          console.log("[FRONTEND] ✅ Registrado:", resData.cedula);
          // Aquí puedes meter tu Toast de éxito o navegación
        }

      } catch (err) {
        console.error("[FRONTEND] Error en envío rápido:", err);
      } finally {
        // Cooldown de 1.5 segundos para que el usuario pueda mover la cédula
        setTimeout(() => {
          scanBusyRef.current = false;
          console.log("[FRONTEND] 🔓 Bus listo para el siguiente escaneo.");
        }, 1500);
      }
    })();
  }}
/>
              <View style={styles.reticleOverlay} pointerEvents="none">
                <View style={styles.reticle} />
                <Text style={styles.reticleHint}>Centra el código de barras de la cédula</Text>
              </View>
              <View style={styles.captureBar}>
                <TouchableOpacity
                  testID="decode-pdf417-photo-btn"
                  style={[styles.captureBtn, barcodeLoading && { opacity: 0.6 }]}
                  onPress={captureAndDecodeBarcode}
                  disabled={barcodeLoading}
                >
                  {barcodeLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="scan-circle" size={24} color="#fff" />
                      <Text style={styles.captureBtnText}>Leer barras</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      ) : mode === "frente" ? (
        <View style={styles.cameraWrap} testID="frente-camera-view">
          {!permission ? (
            <View style={styles.camPlaceholder}><Text style={styles.permText}>Iniciando cámara...</Text></View>
          ) : !permission.granted ? (
            <View style={styles.camPlaceholder}>
              <Ionicons name="camera-outline" size={56} color={theme.textSecondary} />
              <Text style={styles.permTitle}>Acceso a la cámara</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => requestPermission()}>
                <Text style={styles.primaryBtnText}>Otorgar permiso</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" />
              <View style={styles.reticleOverlay} pointerEvents="none">
                <View style={[styles.reticle, { borderColor: theme.brandNeon, aspectRatio: 1.58 }]} />
                <Text style={styles.reticleHint}>Centra el FRENTE de la cédula sobre el recuadro</Text>
              </View>
              <View style={styles.captureBar}>
                <TouchableOpacity
                  testID="capture-frente-btn"
                  style={[styles.captureBtn, ocrLoading && { opacity: 0.6 }]}
                  onPress={captureAndOcr}
                  disabled={ocrLoading}
                >
                  {ocrLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="scan-circle" size={28} color="#fff" />
                      <Text style={styles.captureBtnText}>Capturar y leer</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
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
                    <Text style={[styles.previewTitle, { color: theme.success }]}>Afiliado encontrado</Text>
                  </View>
                  <Text style={styles.previewName} numberOfLines={2}>{preview.afiliado.nombre || "(sin nombre)"}</Text>
                  {!!preview.afiliado.cargo && <Text style={styles.previewMeta}>{preview.afiliado.cargo}{preview.afiliado.titulo ? ` · ${preview.afiliado.titulo}` : ""}</Text>}
                  {!!preview.afiliado.sede && <Text style={styles.previewMeta} numberOfLines={1}>{preview.afiliado.sede}</Text>}
                  {!!preview.afiliado.municipio && <Text style={styles.previewMeta}>{preview.afiliado.municipio}{preview.afiliado.zona ? ` (${preview.afiliado.zona})` : ""}</Text>}
                </View>
              )}
              {!previewLoading && preview && !preview.encontrado && (
                <View style={[styles.previewWrap, { borderColor: theme.warning, backgroundColor: theme.warningBg }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="alert-circle" size={20} color={theme.warning} />
                    <Text style={[styles.previewTitle, { color: theme.warning }]}>No está en la base</Text>
                  </View>
                  <Text style={styles.previewMeta}>{'Se registrará como "no afiliado".'}</Text>
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
              {!!item.nombre && <Text style={styles.recentName} numberOfLines={1}>{item.nombre}</Text>}
              <Text style={styles.recentTime}>
                {new Date(item.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </Text>
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
  topBar: { flexDirection: "row", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, alignItems: "center", gap: 12 },
  eventTitle: { color: theme.text, fontSize: 18, fontWeight: "800" },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontWeight: "700", fontSize: 12 },
  statusMeta: { color: theme.textDisabled, fontSize: 11 },
  counterPill: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8, alignItems: "center" },
  counterValue: { color: theme.text, fontSize: 22, fontWeight: "900" },
  counterLabel: { color: theme.textDisabled, fontSize: 9, textTransform: "uppercase", letterSpacing: 1 },
  modeRow: { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, backgroundColor: theme.surface, borderRadius: 14, padding: 4, borderWidth: 1, borderColor: theme.border },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 10, gap: 6 },
  modeBtnActive: { backgroundColor: theme.brand },
  modeText: { color: theme.textSecondary, fontWeight: "700", fontSize: 13 },
  cameraWrap: { flex: 1, marginHorizontal: 16, borderRadius: 20, overflow: "hidden", backgroundColor: "#000", borderWidth: 1, borderColor: theme.border },
  camPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  permTitle: { color: theme.text, fontSize: 18, fontWeight: "800" },
  permText: { color: theme.textSecondary, fontSize: 13, textAlign: "center" },
  reticleOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  reticle: { width: "80%", aspectRatio: 1.6, borderWidth: 3, borderColor: theme.brandNeon, borderRadius: 16 },
  reticleHint: { color: "#fff", marginTop: 16, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, fontSize: 12 },
  captureBar: { position: "absolute", bottom: 24, left: 0, right: 0, alignItems: "center" },
  captureBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.brand,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    shadowColor: theme.brand,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  captureBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  manualScroll: { padding: 16, paddingBottom: 24 },
  manualCard: { backgroundColor: theme.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: theme.border, gap: 8 },
  manualLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 10 },
  manualInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 16, color: theme.text, fontSize: 15 },
  previewWrap: { marginTop: 12, padding: 14, borderWidth: 1, borderColor: theme.border, borderRadius: 14, gap: 4 },
  previewTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  previewName: { color: theme.text, fontWeight: "800", fontSize: 16, marginTop: 4 },
  previewMeta: { color: theme.textSecondary, fontSize: 13 },
  submitBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: theme.brand, paddingVertical: 16, borderRadius: 14, marginTop: 16 },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  recentWrap: { paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, borderColor: theme.border, backgroundColor: theme.bg },
  recentHeader: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 8 },
  recentTitle: { color: theme.text, fontWeight: "800", fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  recentMeta: { color: theme.error, fontSize: 11, fontWeight: "700" },
  recentEmpty: { color: theme.textDisabled, fontSize: 12, paddingHorizontal: 16 },
  recentChip: { backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.border, minWidth: 140, maxWidth: 200 },
  recentCedula: { color: theme.text, fontWeight: "800", fontSize: 14 },
  recentName: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  recentTime: { color: theme.textDisabled, fontSize: 11, marginTop: 2 },
  toast: { position: "absolute", top: 80, left: 20, right: 20, padding: 14, borderRadius: 14, borderWidth: 1, zIndex: 200 },
  toastText: { color: theme.text, fontWeight: "800", fontSize: 14, textAlign: "center" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { color: theme.text, fontSize: 20, fontWeight: "800" },
  emptySub: { color: theme.textSecondary, textAlign: "center" },
  primaryBtn: { backgroundColor: theme.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 12 },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
