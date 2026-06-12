/**
 * EscanearScreen — Pantalla principal de escaneo de cédulas.
 * Se muestra embebida dentro de EventosScreen cuando hay un evento seleccionado.
 * Usa cámara + OCR/barcode del backend para registrar asistentes e imprimir tickets.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/src/theme";
import { useEvento } from "@/src/ctx/evento";
import { api } from "@/src/utils/api";
import { extractCedula, parsePdf417 } from "@/src/utils/cedula";
import { imprimirTicket, conectarImpresoraGuardada } from "@/src/utils/printer";
import PrinterSelector from "@/src/components/PrinterSelector";

// ─── tipos ────────────────────────────────────────────────────────────────────

type ScanResult = {
  ok: boolean;
  duplicate?: boolean;
  mensaje: string;
  nombre?: string;
  cargo?: string;
  municipio?: string;
  cedula?: string;
  registro?: {
    cedula?: string;
    nombre?: string;
    cargo?: string;
    municipio?: string;
  };
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string) {
  if (!s) return "";
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizeAfiliado(response: any) {
  return response?.afiliado || (response?.encontrado ? response : null) || {};
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function EscanearScreen() {
  const { eventoNombre, scan, clearEvento, registros, duplicadosBloqueados, wsStatus, queueSize } =
    useEvento();

  const [permission, requestPermission] = useCameraPermissions();
  const [procesando, setProcesando] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [cedulaManual, setCedulaManual] = useState("");
  const [showPrinter, setShowPrinter] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);
  const lastBarcodeRef = useRef<string>("");
  const cooldownRef = useRef<boolean>(false);

  // ── impresión ──────────────────────────────────────────────────────────────

  const tryPrint = useCallback(
    async (nombre: string, cargo: string, municipio: string) => {
      try {
        setImprimiendo(true);
        const connected = await conectarImpresoraGuardada();
        if (!connected) {
          // Sin impresora configurada — silencio, no bloquear el flujo
          return;
        }
        await imprimirTicket({
          nombre: capitalize(nombre),
          cargo: capitalize(cargo),
          municipio: capitalize(municipio),
        });
      } catch (e: any) {
        // No alertar al usuario por fallo de impresora — es periférico
        console.warn("[Printer]", e?.message ?? e);
      } finally {
        setImprimiendo(false);
      }
    },
    []
  );

  // ── escanear barcode ───────────────────────────────────────────────────────

  const handleBarcode = useCallback(
    async ({ data }: { data: string }) => {
      if (procesando || cooldownRef.current) return;
      if (data === lastBarcodeRef.current) return;
      lastBarcodeRef.current = data;
      cooldownRef.current = true;
      setProcesando(true);

      try {
        // Parsear PDF417 / MRZ localmente para extraer datos enriquecidos
        const parsed = parsePdf417(data);
        const parsedCedula = /^\d{5,11}$/.test(parsed.cedula || "") ? parsed.cedula : "";
        const cedula = parsedCedula || extractCedula(data) || "";

        if (!/^\d{5,11}$/.test(cedula)) {
          setLastResult({ ok: false, mensaje: "Código no reconocido como cédula" });
          return;
        }

        // Intentar lookup del afiliado en el backend para nombre/cargo/municipio
        let afiliadoData: any = null;
        try {
          afiliadoData = await api.lookupAfiliado(cedula);
        } catch {
          // no es afiliado o sin conexión — continuar con datos del código
        }

        const afiliado = normalizeAfiliado(afiliadoData);
        const nombre =
          afiliado?.nombre_completo ||
          afiliado?.nombre ||
          [parsed.primer_apellido, parsed.segundo_apellido, parsed.nombres]
            .filter(Boolean)
            .join(" ") ||
          "";
        const cargo = afiliado?.cargo || "";
        const municipio = afiliado?.municipio || parsed.location?.municipality || "";
        const sede = afiliado?.sede || "";

        const result = await scan(cedula, {
          nombre,
          cargo,
          municipio,
          sede,
          raw_barcode: data,
          // Los siguientes campos son accedidos vía (extras as any) dentro del contexto
          ...({
            primer_apellido: parsed.primer_apellido,
            segundo_apellido: parsed.segundo_apellido,
            nombres: parsed.nombres,
            genero: parsed.genero,
            fecha_nacimiento: parsed.fecha_nacimiento || "",
            fecha_expiracion: parsed.fecha_expiracion || "",
            tipo_sangre: parsed.tipo_sangre,
          } as any),
        } as any);

        const finalCedula = result.registro?.cedula || cedula;
        const printNombre = result.registro?.nombre || nombre;
        const printCargo = result.registro?.cargo || cargo;
        const printMunicipio = result.registro?.municipio || municipio;

        setLastResult({
          ...result,
          nombre: printNombre,
          cargo: printCargo,
          municipio: printMunicipio,
          cedula: finalCedula,
        });

        if (result.ok) {
          void tryPrint(printNombre, printCargo, printMunicipio);
        }
      } catch (e: any) {
        setLastResult({ ok: false, mensaje: e?.message || "Error al procesar el código" });
      } finally {
        setProcesando(false);
        // Cooldown de 2s para evitar escaneos duplicados
        setTimeout(() => {
          cooldownRef.current = false;
          lastBarcodeRef.current = "";
        }, 2000);
      }
    },
    [procesando, scan, tryPrint]
  );

  // ── escaneo manual ─────────────────────────────────────────────────────────

  const handleManual = useCallback(async () => {
    const cedula = cedulaManual.trim().replace(/\D/g, "").replace(/^0+/, "");
    if (!/^\d{5,11}$/.test(cedula)) {
      Alert.alert("Cédula inválida", "Ingresa entre 5 y 11 dígitos.");
      return;
    }
    setShowManual(false);
    setCedulaManual("");
    setProcesando(true);

    try {
      let afiliadoData: any = null;
      try {
        afiliadoData = await api.lookupAfiliado(cedula);
      } catch {
        // no es afiliado
      }

      const afiliado = normalizeAfiliado(afiliadoData);
      const nombre = afiliado?.nombre_completo || afiliado?.nombre || "";
      const cargo = afiliado?.cargo || "";
      const municipio = afiliado?.municipio || "";
      const sede = afiliado?.sede || "";

      const result = await scan(cedula, { nombre, cargo, municipio, sede });
      const printNombre = result.registro?.nombre || nombre;
      const printCargo = result.registro?.cargo || cargo;
      const printMunicipio = result.registro?.municipio || municipio;
      setLastResult({ ...result, nombre: printNombre, cargo: printCargo, municipio: printMunicipio, cedula });

      if (result.ok) {
        void tryPrint(printNombre, printCargo, printMunicipio);
      }
    } catch (e: any) {
      setLastResult({ ok: false, mensaje: e?.message || "Error" });
    } finally {
      setProcesando(false);
    }
  }, [cedulaManual, scan, tryPrint]);

  // ── permisos de cámara ─────────────────────────────────────────────────────

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={theme.info} size="large" />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.permWrap}>
          <Ionicons name="camera-outline" size={64} color={theme.textDisabled} />
          <Text style={styles.permTitle}>Permiso de cámara requerido</Text>
          <Text style={styles.permSub}>
            La app necesita acceso a la cámara para escanear los códigos de las cédulas.
          </Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Conceder permiso</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── barra de estado ────────────────────────────────────────────────────────
  const wsColor =
    wsStatus === "online" ? theme.success : wsStatus === "connecting" ? theme.warning : theme.error;

  const wsLabel =
    wsStatus === "online" ? "En línea" : wsStatus === "connecting" ? "Conectando…" : "Sin conexión";

  // ── render principal ───────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventoNombre} numberOfLines={1}>
            {eventoNombre}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.wsDot, { backgroundColor: wsColor }]} />
            <Text style={[styles.wsLabel, { color: wsColor }]}>{wsLabel}</Text>
            {queueSize > 0 && (
              <Text style={styles.queueBadge}> · Cola: {queueSize}</Text>
            )}
          </View>
        </View>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => setShowPrinter(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="print-outline" size={22} color={theme.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.headerBtn, { marginLeft: 6 }]}
          onPress={() => {
            Alert.alert("Salir del evento", "¿Deseas cerrar este evento?", [
              { text: "Cancelar", style: "cancel" },
              { text: "Salir", style: "destructive", onPress: clearEvento },
            ]);
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle-outline" size={22} color={theme.error} />
        </TouchableOpacity>
      </View>

      {/* ── Cámara ── */}
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ["pdf417", "qr", "code128", "code39", "ean13", "ean8", "datamatrix"],
          }}
          onBarcodeScanned={procesando ? undefined : handleBarcode}
        />
        {/* Overlay del visor */}
        <View style={styles.overlay}>
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          {procesando && (
            <View style={styles.processingBadge}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.processingText}>Procesando…</Text>
            </View>
          )}
          {imprimiendo && (
            <View style={[styles.processingBadge, { backgroundColor: theme.brand }]}>
              <Ionicons name="print-outline" size={14} color="#fff" />
              <Text style={styles.processingText}>Imprimiendo escarapela...</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Resultado del último escaneo ── */}
      {lastResult && (
        <View
          style={[
            styles.resultCard,
            {
              borderColor: lastResult.duplicate
                ? theme.warning
                : lastResult.ok
                ? theme.success
                : theme.error,
              backgroundColor: lastResult.duplicate
                ? theme.warningBg
                : lastResult.ok
                ? theme.successBg
                : theme.errorBg,
            },
          ]}
        >
          <Ionicons
            name={
              lastResult.duplicate
                ? "warning"
                : lastResult.ok
                ? "checkmark-circle"
                : "close-circle"
            }
            size={28}
            color={
              lastResult.duplicate
                ? theme.warning
                : lastResult.ok
                ? theme.success
                : theme.error
            }
          />
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.resultMsg,
                {
                  color: lastResult.duplicate
                    ? theme.warning
                    : lastResult.ok
                    ? theme.success
                    : theme.error,
                },
              ]}
            >
              {lastResult.mensaje}
            </Text>
            {lastResult.ok && lastResult.nombre ? (
              <Text style={styles.resultName} numberOfLines={1}>
                {capitalize(lastResult.nombre)}
              </Text>
            ) : null}
            {lastResult.ok && lastResult.municipio ? (
              <Text style={styles.resultMeta} numberOfLines={1}>
                {capitalize(lastResult.municipio)}
                {lastResult.cargo ? ` · ${capitalize(lastResult.cargo)}` : ""}
              </Text>
            ) : null}
          </View>
        </View>
      )}

      {/* ── Contadores ── */}
      <View style={styles.counters}>
        <View style={styles.counterItem}>
          <Text style={styles.counterValue}>{registros.length}</Text>
          <Text style={styles.counterLabel}>Registrados</Text>
        </View>
        <View style={[styles.counterItem, { borderLeftWidth: 1, borderColor: theme.border }]}>
          <Text style={[styles.counterValue, { color: theme.error }]}>
            {duplicadosBloqueados}
          </Text>
          <Text style={styles.counterLabel}>Duplicados</Text>
        </View>
      </View>

      {/* ── Botón ingreso manual ── */}
      <TouchableOpacity style={styles.manualBtn} onPress={() => setShowManual(true)}>
        <Ionicons name="keypad-outline" size={18} color={theme.brand} />
        <Text style={styles.manualBtnText}>Ingreso manual de cédula</Text>
      </TouchableOpacity>

      {/* ── Modal ingreso manual ── */}
      <Modal
        visible={showManual}
        animationType="slide"
        transparent
        onRequestClose={() => setShowManual(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalWrap}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Ingreso manual</Text>
            <Text style={styles.modalLabel}>Número de cédula</Text>
            <TextInput
              style={styles.modalInput}
              value={cedulaManual}
              onChangeText={setCedulaManual}
              keyboardType="numeric"
              placeholder="Ej: 1098765432"
              placeholderTextColor={theme.textDisabled}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleManual}
            />
            <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: theme.surfaceElevated }]}
                onPress={() => {
                  setShowManual(false);
                  setCedulaManual("");
                }}
              >
                <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: theme.brand }]}
                onPress={handleManual}
              >
                <Text style={styles.modalBtnText}>Registrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal selección de impresora ── */}
      <Modal
        visible={showPrinter}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPrinter(false)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <Text style={styles.modalTitle}>Impresora Bluetooth</Text>
              <TouchableOpacity onPress={() => setShowPrinter(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
            <PrinterSelector />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── estilos ──────────────────────────────────────────────────────────────────

const CORNER = 20;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    gap: 8,
  },
  eventoNombre: { color: theme.text, fontSize: 15, fontWeight: "800" },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  wsDot: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  wsLabel: { fontSize: 11, fontWeight: "700" },
  queueBadge: { color: theme.warning, fontSize: 11, fontWeight: "700" },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // Cámara
  cameraWrap: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 20,
    marginHorizontal: 12,
    backgroundColor: "#000",
    position: "relative",
  },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  scanFrame: {
    width: 240,
    height: 150,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: CORNER,
    height: CORNER,
    borderColor: "#fff",
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  processingBadge: {
    position: "absolute",
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  processingText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  // Resultado
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 12,
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  resultMsg: { fontSize: 13, fontWeight: "800" },
  resultName: { color: theme.text, fontSize: 15, fontWeight: "700", marginTop: 2 },
  resultMeta: { color: theme.textSecondary, fontSize: 12, marginTop: 1 },

  // Contadores
  counters: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginTop: 10,
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  counterItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
  },
  counterValue: { color: theme.text, fontSize: 22, fontWeight: "900" },
  counterLabel: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  // Botón manual
  manualBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.brand,
    backgroundColor: theme.infoBg,
  },
  manualBtnText: { color: theme.brand, fontWeight: "700", fontSize: 14 },

  // Modal compartido
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderColor: theme.border,
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    backgroundColor: theme.border,
    borderRadius: 2,
    marginBottom: 14,
  },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginBottom: 12 },
  modalLabel: {
    color: theme.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 18,
    fontWeight: "700",
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  modalBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  // Permiso cámara
  permWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  permTitle: { color: theme.text, fontSize: 22, fontWeight: "800", textAlign: "center" },
  permSub: { color: theme.textSecondary, fontSize: 14, textAlign: "center" },
  permBtn: {
    backgroundColor: theme.brand,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  permBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
