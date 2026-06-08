import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Linking,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";

import { theme } from "@/src/theme";
import { errorMessage } from "@/src/utils/errors";
import { useSession } from "@/src/ctx/session";
import { useEvento } from "@/src/ctx/evento";
import { api } from "@/src/utils/api";

type Tab = "panel" | "afiliados" | "registros";
type MetricItem = { label: string; total: number };
type AdminMetrics = {
  global: { afiliados: number; eventos: number; eventos_activos: number; registros: number };
  evento_actual: {
    registros: number;
    hoy: number;
    afiliados: number;
    no_afiliados: number;
    duplicados: number;
    dispositivos_usados: number;
    dispositivos_activos: number;
    calidad_nombre_pct: number;
    calidad_fecha_pct: number;
  };
  top_municipios: MetricItem[];
  top_operadores: MetricItem[];
  por_hora: MetricItem[];
  recientes: any[];
  ia: { configured: boolean; enabled: boolean; model: string; mode: string; min_confidence: number };
};

function fmt(n: unknown): string {
  const value = Number(n || 0);
  return Number.isFinite(value) ? value.toLocaleString("es-CO") : "0";
}

function cleanDisplayName(value: unknown): string {
  const text = String(value || "")
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 2 ? text : "";
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <View style={styles.metricBarWrap}>
      <View style={styles.metricBarHeader}>
        <Text style={styles.metricBarLabel}>{label}</Text>
        <Text style={styles.metricBarValue}>{pct.toFixed(1)}%</Text>
      </View>
      <View style={styles.metricTrack}>
        <View style={[styles.metricFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function CountRow({ item, max }: { item: MetricItem; max: number }) {
  const pct = Math.max(6, Math.min(100, (item.total / Math.max(max, 1)) * 100));
  return (
    <View style={styles.countRow}>
      <View style={styles.countTop}>
        <Text style={styles.countLabel} numberOfLines={1}>{item.label || "(sin dato)"}</Text>
        <Text style={styles.countValue}>{fmt(item.total)}</Text>
      </View>
      <View style={styles.countTrack}>
        <View style={[styles.countFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

export default function AdminScreen() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  const [tab, setTab] = useState<Tab>("panel");
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Afiliados state
  const [afQuery, setAfQuery] = useState("");
  const [afItems, setAfItems] = useState<any[]>([]);
  const [afTotal, setAfTotal] = useState(0);
  const [afLoading, setAfLoading] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  // Registros
  const { eventoId, eventoNombre, refreshRegistros, registros } = useEvento();
  const [exporting, setExporting] = useState(false);

  const loadMetrics = useCallback(async () => {
    if (!isAdmin) return;
    setMetricsLoading(true);
    try {
      const r = await api.adminMetrics(eventoId || undefined);
      setMetrics(r as AdminMetrics);
    } catch (e: any) {
      Alert.alert("Error", errorMessage(e, "No se pudieron cargar las metricas"));
    } finally {
      setMetricsLoading(false);
    }
  }, [eventoId, isAdmin]);

  const loadAfiliados = useCallback(async () => {
    if (!isAdmin) return;
    setAfLoading(true);
    try {
      const r = await api.listAfiliados(afQuery, 100, 0);
      setAfItems(r.items);
      setAfTotal(r.total);
    } catch (e: any) {
      Alert.alert("Error", errorMessage(e, "No se pudo cargar"));
    } finally {
      setAfLoading(false);
    }
  }, [afQuery, isAdmin]);

  useEffect(() => {
    if (tab === "afiliados") {
      const t = setTimeout(loadAfiliados, 250);
      return () => clearTimeout(t);
    }
  }, [tab, loadAfiliados]);

  useEffect(() => {
    if (tab !== "panel") return;
    void loadMetrics();
    const id = setInterval(loadMetrics, 7000);
    return () => clearInterval(id);
  }, [tab, loadMetrics]);

  const pickImport = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "*/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const file = res.assets[0];
      setImportBusy(true);
      const out = await api.uploadAfiliados({ uri: file.uri, name: file.name, mimeType: file.mimeType });
      Alert.alert("Importación completa", `Total: ${out.total}\nNuevos: ${out.insertados}\nActualizados: ${out.actualizados}`);
      loadAfiliados();
    } catch (e: any) {
      Alert.alert("Error al importar", errorMessage(e, "No se pudo importar"));
    } finally {
      setImportBusy(false);
    }
  };

  const onWipe = () => {
    Alert.alert("Borrar toda la base", "¿Confirmas que quieres borrar TODOS los afiliados?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar todo", style: "destructive", onPress: async () => {
          try {
            await api.wipeAfiliados();
            Alert.alert("Listo", "Base borrada");
            loadAfiliados();
          } catch (e: any) {
            Alert.alert("Error", errorMessage(e));
          }
        },
      },
    ]);
  };

  const onDeleteAfiliado = (cedula: string) => {
    Alert.alert("Borrar afiliado", `Cédula ${cedula}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar", style: "destructive", onPress: async () => {
          try { await api.deleteAfiliado(cedula); loadAfiliados(); } catch (e: any) { Alert.alert("Error", errorMessage(e)); }
        },
      },
    ]);
  };

  const onExport = async () => {
    if (!eventoId) {
      Alert.alert("Selecciona un evento", "Primero ve a Eventos y selecciona uno.");
      return;
    }
    setExporting(true);
    try {
      // Web: trigger blob download. Native: open URL with token (best-effort).
      if (Platform.OS === "web") {
        const { blob, filename } = await api.exportBlob(eventoId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        const url = await api.exportUrl(eventoId);
        await Linking.openURL(url);
      }
    } catch (e: any) {
      Alert.alert("Error al exportar", errorMessage(e, "No se pudo exportar"));
    } finally {
      setExporting(false);
    }
  };

  const onDeleteRegistro = (id: string, cedula: string) => {
    if (!eventoId) return;
    Alert.alert("Borrar registro", `¿Eliminar la cédula ${cedula} de este evento?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar", style: "destructive", onPress: async () => {
          try {
            await api.deleteRegistro(eventoId, id);
            await refreshRegistros();
          } catch (e: any) { Alert.alert("Error", errorMessage(e)); }
        },
      },
    ]);
  };

  const onClearAllRegistros = () => {
    if (!eventoId) {
      Alert.alert("Selecciona un evento");
      return;
    }
    Alert.alert(
      "Limpiar todos los registros",
      `Vas a borrar TODOS los ${registros.length} registros del evento "${eventoNombre}". Esta acción NO se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Sí, borrar todos",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await api.clearEventoRegistros(eventoId);
              Alert.alert("Listo", `${r.registros_borrados} registros borrados`);
              await refreshRegistros();
            } catch (e: any) {
              Alert.alert("Error", errorMessage(e));
            }
          },
        },
      ],
    );
  };

  const onDeleteEvento = () => {
    if (!eventoId) return;
    Alert.alert(
      "Borrar evento completo",
      `Vas a eliminar el evento "${eventoNombre}" Y todos sus registros. Esta acción NO se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Sí, eliminar evento",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteEvento(eventoId);
              Alert.alert("Listo", "Evento eliminado");
            } catch (e: any) {
              Alert.alert("Error", errorMessage(e));
            }
          },
        },
      ],
    );
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.lockWrap}>
          <Ionicons name="lock-closed" size={64} color={theme.textDisabled} />
          <Text style={styles.lockTitle}>Solo administradores</Text>
          <Text style={styles.lockSub}>Inicia sesión con una cuenta admin para gestionar la base de docentes y exportar datos.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Administracion</Text>
        <Text style={styles.title}>Admin</Text>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          testID="admin-tab-panel"
          style={[styles.tabBtn, tab === "panel" && styles.tabActive]}
          onPress={() => setTab("panel")}
        >
          <Ionicons name="analytics" size={16} color={tab === "panel" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.tabText, tab === "panel" && { color: "#fff" }]}>Panel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="admin-tab-afiliados"
          style={[styles.tabBtn, tab === "afiliados" && styles.tabActive]}
          onPress={() => setTab("afiliados")}
        >
          <Ionicons name="people" size={16} color={tab === "afiliados" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.tabText, tab === "afiliados" && { color: "#fff" }]}>Docentes</Text>
          <Text style={[styles.tabBadge, tab === "afiliados" && { color: "#fff" }]}>{afTotal}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="admin-tab-registros"
          style={[styles.tabBtn, tab === "registros" && styles.tabActive]}
          onPress={() => setTab("registros")}
        >
          <Ionicons name="list" size={16} color={tab === "registros" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.tabText, tab === "registros" && { color: "#fff" }]}>Evento</Text>
          <Text style={[styles.tabBadge, tab === "registros" && { color: "#fff" }]}>{registros.length}</Text>
        </TouchableOpacity>
      </View>

      {tab === "panel" ? (
        <ScrollView
          contentContainerStyle={styles.panelScroll}
          refreshControl={<RefreshControl tintColor={theme.brand} refreshing={metricsLoading} onRefresh={loadMetrics} />}
        >
          {metricsLoading && !metrics ? (
            <ActivityIndicator color={theme.brand} style={{ marginTop: 24 }} />
          ) : (
            <>
              <View style={styles.kpiGrid}>
                <View style={styles.kpiCard}>
                  <View style={styles.kpiHeader}>
                    <Ionicons name="people" size={18} color={theme.brand} />
                    <Text style={styles.kpiLabel}>Docentes base</Text>
                  </View>
                  <Text style={styles.kpiValue}>{fmt(metrics?.global.afiliados)}</Text>
                  <Text style={styles.kpiFoot}>Registros maestros cargados</Text>
                </View>
                <View style={styles.kpiCard}>
                  <View style={styles.kpiHeader}>
                    <Ionicons name="calendar-outline" size={18} color={theme.success} />
                    <Text style={styles.kpiLabel}>Eventos</Text>
                  </View>
                  <Text style={styles.kpiValue}>{fmt(metrics?.global.eventos)}</Text>
                  <Text style={styles.kpiFoot}>{fmt(metrics?.global.eventos_activos)} activos</Text>
                </View>
                <View style={styles.kpiCard}>
                  <View style={styles.kpiHeader}>
                    <Ionicons name="scan" size={18} color={theme.info} />
                    <Text style={styles.kpiLabel}>Escaneos evento</Text>
                  </View>
                  <Text style={styles.kpiValue}>{fmt(metrics?.evento_actual.registros ?? registros.length)}</Text>
                  <Text style={styles.kpiFoot}>{fmt(metrics?.evento_actual.hoy)} hoy</Text>
                </View>
                <View style={styles.kpiCard}>
                  <View style={styles.kpiHeader}>
                    <Ionicons name="shield-checkmark" size={18} color={theme.error} />
                    <Text style={styles.kpiLabel}>Duplicados</Text>
                  </View>
                  <Text style={[styles.kpiValue, { color: theme.error }]}>{fmt(metrics?.evento_actual.duplicados)}</Text>
                  <Text style={styles.kpiFoot}>Bloqueados por evento</Text>
                </View>
              </View>

              <View style={styles.panelCard}>
                <View style={styles.panelCardHeader}>
                  <Text style={styles.panelCardTitle}>IA Gemini</Text>
                  <View style={[styles.statusPill, { borderColor: metrics?.ia.enabled ? theme.success : theme.warning }]}>
                    <View style={[styles.statusDot, { backgroundColor: metrics?.ia.enabled ? theme.success : theme.warning }]} />
                    <Text style={[styles.statusPillText, { color: metrics?.ia.enabled ? theme.success : theme.warning }]}>
                      {metrics?.ia.enabled ? "Activa" : "Pendiente"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.panelText}>
                  {metrics?.ia.enabled
                    ? `Modelo ${metrics.ia.model} · modo ${metrics.ia.mode} · confianza minima ${metrics.ia.min_confidence}`
                    : "Configura GEMINI_API_KEY en el backend para activar vision AI como respaldo de OCR."}
                </Text>
              </View>

              <View style={styles.panelCard}>
                <Text style={styles.panelCardTitle}>Calidad del evento</Text>
                <MetricBar label="Con nombre" value={metrics?.evento_actual.calidad_nombre_pct || 0} color={theme.success} />
                <MetricBar label="Con fecha nacimiento" value={metrics?.evento_actual.calidad_fecha_pct || 0} color={theme.info} />
                <View style={styles.splitRow}>
                  <View style={styles.splitBox}>
                    <Text style={styles.splitValue}>{fmt(metrics?.evento_actual.afiliados)}</Text>
                    <Text style={styles.splitLabel}>Docentes SI</Text>
                  </View>
                  <View style={styles.splitBox}>
                    <Text style={styles.splitValue}>{fmt(metrics?.evento_actual.no_afiliados)}</Text>
                    <Text style={styles.splitLabel}>Docentes NO</Text>
                  </View>
                  <View style={styles.splitBox}>
                    <Text style={styles.splitValue}>{fmt(metrics?.evento_actual.dispositivos_activos)}</Text>
                    <Text style={styles.splitLabel}>Activos</Text>
                  </View>
                </View>
              </View>

              <View style={styles.panelCard}>
                <Text style={styles.panelCardTitle}>Actividad ultimas 24h</Text>
                {(metrics?.por_hora || []).length ? (
                  metrics?.por_hora.map((it) => (
                    <CountRow key={it.label} item={it} max={Math.max(...(metrics?.por_hora || []).map((x) => x.total), 1)} />
                  ))
                ) : (
                  <Text style={styles.emptySmall}>Sin actividad reciente.</Text>
                )}
              </View>

              <View style={styles.dualPanel}>
                <View style={styles.panelCardHalf}>
                  <Text style={styles.panelCardTitle}>Top municipios</Text>
                  {(metrics?.top_municipios || []).length ? metrics?.top_municipios.map((it) => (
                    <CountRow key={it.label} item={it} max={Math.max(...(metrics?.top_municipios || []).map((x) => x.total), 1)} />
                  )) : <Text style={styles.emptySmall}>Sin datos.</Text>}
                </View>
                <View style={styles.panelCardHalf}>
                  <Text style={styles.panelCardTitle}>Operadores</Text>
                  {(metrics?.top_operadores || []).length ? metrics?.top_operadores.map((it) => (
                    <CountRow key={it.label} item={it} max={Math.max(...(metrics?.top_operadores || []).map((x) => x.total), 1)} />
                  )) : <Text style={styles.emptySmall}>Sin datos.</Text>}
                </View>
              </View>

              <View style={styles.panelCard}>
                <Text style={styles.panelCardTitle}>Lecturas recientes</Text>
                {(metrics?.recientes || []).length ? metrics?.recientes.map((item) => (
                  <View key={item.id} style={styles.recentAdminRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.afCed}>{item.cedula}</Text>
                      <Text style={styles.afName} numberOfLines={1}>{cleanDisplayName(item.nombre) || "(sin nombre)"}</Text>
                    </View>
                    <Text style={styles.recentBadge}>{item.es_afiliado ? "SI" : "NO"}</Text>
                  </View>
                )) : <Text style={styles.emptySmall}>Sin registros.</Text>}
              </View>
            </>
          )}
        </ScrollView>
      ) : tab === "afiliados" ? (
        <View style={{ flex: 1 }}>
          <View style={styles.searchRow}>
            <TextInput
              testID="admin-search-input"
              style={styles.search}
              value={afQuery}
              onChangeText={setAfQuery}
              placeholder="Buscar por cédula o nombre…"
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="none"
            />
            <TouchableOpacity testID="admin-import-button" style={styles.iconBtn} onPress={pickImport} disabled={importBusy}>
              {importBusy ? <ActivityIndicator color="#fff" /> : <Ionicons name="cloud-upload" size={20} color="#fff" />}
            </TouchableOpacity>
            <TouchableOpacity testID="admin-wipe-button" style={[styles.iconBtn, { backgroundColor: theme.error }]} onPress={onWipe}>
              <Ionicons name="trash" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          {afLoading ? (
            <ActivityIndicator color={theme.brand} style={{ marginTop: 24 }} />
          ) : (
            <FlatList
              testID="admin-afiliados-list"
              data={afItems}
              keyExtractor={(it) => it.cedula}
              contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}
              ListEmptyComponent={<Text style={styles.empty}>Sin resultados.</Text>}
              renderItem={({ item }) => (
                <View style={styles.afRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.afCed}>{item.cedula}</Text>
                    <Text style={styles.afName} numberOfLines={1}>{cleanDisplayName(item.nombre) || "(sin nombre)"}</Text>
                    <Text style={styles.afMeta} numberOfLines={1}>{item.cargo}{item.sede ? ` · ${item.sede}` : ""}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setEditing(item)} style={styles.afAction}>
                    <Ionicons name="create-outline" size={18} color={theme.brand} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onDeleteAfiliado(item.cedula)} style={styles.afAction}>
                    <Ionicons name="trash-outline" size={18} color={theme.error} />
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      ) : (
        <View style={{ flex: 1, padding: 16 }}>
          <View style={styles.eventInfo}>
            <Text style={styles.eventInfoLabel}>Evento actual</Text>
            <Text style={styles.eventInfoName} numberOfLines={1}>{eventoNombre || "(ninguno)"}</Text>
            <TouchableOpacity testID="admin-export-button" style={styles.exportBtn} onPress={onExport} disabled={exporting || !eventoId}>
              {exporting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="download" size={18} color="#fff" />
                  <Text style={styles.exportBtnText}>Exportar a Excel</Text>
                </>
              )}
            </TouchableOpacity>
            <View style={styles.eventActionRow}>
              <TouchableOpacity
                testID="admin-clear-event-registros"
                style={[styles.dangerBtn, (!eventoId || !registros.length) && styles.disabledBtn]}
                onPress={onClearAllRegistros}
                disabled={!eventoId || !registros.length}
              >
                <Ionicons name="remove-circle-outline" size={17} color={theme.warning} />
                <Text style={styles.dangerBtnText}>Limpiar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="admin-delete-event"
                style={[styles.dangerBtn, styles.deleteBtn, !eventoId && styles.disabledBtn]}
                onPress={onDeleteEvento}
                disabled={!eventoId}
              >
                <Ionicons name="trash-outline" size={17} color={theme.error} />
                <Text style={[styles.dangerBtnText, { color: theme.error }]}>Evento</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={registros}
            keyExtractor={(it) => it.id}
            contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
            ListEmptyComponent={<Text style={styles.empty}>Sin registros en este evento.</Text>}
            renderItem={({ item }) => (
              <View style={styles.afRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.afCed}>{item.cedula}</Text>
                  <Text style={styles.afName} numberOfLines={1}>{cleanDisplayName(item.nombre) || "(sin nombre)"}</Text>
                  <Text style={styles.afMeta}>{item.es_afiliado ? "Afiliado" : "No afiliado"} · {new Date(item.created_at).toLocaleString("es-CO")}</Text>
                </View>
                <TouchableOpacity onPress={() => onDeleteRegistro(item.id, item.cedula)} style={styles.afAction}>
                  <Ionicons name="trash-outline" size={18} color={theme.error} />
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      )}

      {/* Edit afiliado modal */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Editar afiliado</Text>
              {editing && (
                <>
                  <Text style={styles.formLabel}>Cédula</Text>
                  <Text style={[styles.formInput, { color: theme.textDisabled }]}>{editing.cedula}</Text>
                  {(["nombre", "sede", "municipio", "zona", "cargo", "titulo", "email", "celular", "fecha_nac"] as const).map((k) => (
                    <View key={k}>
                      <Text style={styles.formLabel}>{k}</Text>
                      <TextInput
                        style={styles.formInput}
                        value={editing[k] ?? ""}
                        onChangeText={(v) => setEditing({ ...editing, [k]: v })}
                        placeholderTextColor={theme.textDisabled}
                      />
                    </View>
                  ))}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
                    <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.surfaceElevated }]} onPress={() => setEditing(null)}>
                      <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalBtn, { backgroundColor: theme.brand }]}
                      onPress={async () => {
                        try {
                          const { cedula, ...rest } = editing;
                          await api.updateAfiliado(cedula, rest);
                          setEditing(null);
                          loadAfiliados();
                        } catch (e: any) {
                          Alert.alert("Error", errorMessage(e));
                        }
                      }}
                    >
                      <Text style={styles.modalBtnText}>Guardar</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  eyebrow: { color: theme.brand, fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  title: { color: theme.text, fontSize: 25, fontWeight: "900" },
  tabRow: { flexDirection: "row", marginHorizontal: 12, marginVertical: 6, backgroundColor: theme.surface, borderRadius: 8, padding: 3, borderWidth: 1, borderColor: theme.border },
  tabBtn: { flex: 1, flexDirection: "row", paddingVertical: 9, borderRadius: 6, alignItems: "center", justifyContent: "center", gap: 6 },
  tabActive: { backgroundColor: theme.brand },
  tabText: { color: theme.textSecondary, fontWeight: "700", fontSize: 13 },
  tabBadge: { color: theme.textDisabled, fontWeight: "900", fontSize: 12 },
  panelScroll: { padding: 12, paddingBottom: 40, gap: 10 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard: { flexGrow: 1, flexBasis: "47%", minWidth: 150, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12 },
  kpiHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  kpiLabel: { color: theme.textSecondary, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  kpiValue: { color: theme.text, fontSize: 28, fontWeight: "900", marginTop: 6 },
  kpiFoot: { color: theme.textDisabled, fontSize: 11, marginTop: 2 },
  panelCard: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 8 },
  panelCardHalf: { flex: 1, minWidth: 150, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 8 },
  panelCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  panelCardTitle: { color: theme.text, fontSize: 13, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  panelText: { color: theme.textSecondary, fontSize: 12, lineHeight: 17 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  splitRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  splitBox: { flex: 1, backgroundColor: theme.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 9 },
  splitValue: { color: theme.text, fontSize: 18, fontWeight: "900" },
  splitLabel: { color: theme.textDisabled, fontSize: 10, marginTop: 2 },
  metricBarWrap: { gap: 5 },
  metricBarHeader: { flexDirection: "row", justifyContent: "space-between" },
  metricBarLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: "700" },
  metricBarValue: { color: theme.text, fontSize: 12, fontWeight: "900" },
  metricTrack: { height: 8, backgroundColor: theme.bg, borderRadius: 8, overflow: "hidden" },
  metricFill: { height: 8, borderRadius: 8 },
  dualPanel: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  countRow: { gap: 5 },
  countTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  countLabel: { flex: 1, color: theme.textSecondary, fontSize: 12, fontWeight: "700" },
  countValue: { color: theme.text, fontSize: 12, fontWeight: "900" },
  countTrack: { height: 6, backgroundColor: theme.bg, borderRadius: 6, overflow: "hidden" },
  countFill: { height: 6, backgroundColor: theme.brand, borderRadius: 6 },
  recentAdminRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border },
  recentBadge: { color: theme.success, borderWidth: 1, borderColor: theme.success, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: "900" },
  emptySmall: { color: theme.textDisabled, fontSize: 12, paddingVertical: 8 },
  searchRow: { flexDirection: "row", paddingHorizontal: 12, gap: 8, marginVertical: 4 },
  search: { flex: 1, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, color: theme.text, fontSize: 14 },
  iconBtn: { width: 44, height: 44, borderRadius: 8, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },
  afRow: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: theme.surface, borderRadius: 8, borderWidth: 1, borderColor: theme.border, gap: 8 },
  afCed: { color: theme.text, fontWeight: "900", fontSize: 14 },
  afName: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  afMeta: { color: theme.textDisabled, fontSize: 11, marginTop: 2 },
  afAction: { padding: 8 },
  empty: { color: theme.textDisabled, textAlign: "center", padding: 40 },
  eventInfo: { padding: 12, backgroundColor: theme.surface, borderRadius: 8, borderWidth: 1, borderColor: theme.border, marginBottom: 10 },
  eventInfoLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  eventInfoName: { color: theme.text, fontSize: 18, fontWeight: "800", marginTop: 4 },
  eventInfoMeta: { color: theme.textSecondary, fontSize: 12, marginTop: 4 },
  exportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, backgroundColor: theme.brand, borderRadius: 8, marginTop: 10 },
  exportBtnText: { color: "#fff", fontWeight: "800" },
  eventActionRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  dangerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.warning, backgroundColor: theme.warningBg },
  deleteBtn: { borderColor: theme.error, backgroundColor: theme.errorBg },
  disabledBtn: { opacity: 0.45 },
  dangerBtnText: { color: theme.warning, fontWeight: "800", fontSize: 13 },
  lockWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  lockTitle: { color: theme.text, fontSize: 22, fontWeight: "800" },
  lockSub: { color: theme.textSecondary, textAlign: "center", fontSize: 14 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: theme.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 18, paddingBottom: 28, maxHeight: "85%" },
  modalHandle: { alignSelf: "center", width: 40, height: 4, backgroundColor: theme.border, borderRadius: 2, marginBottom: 12 },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginBottom: 8 },
  formLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: 10, marginBottom: 4 },
  formInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: theme.text, fontSize: 14 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  modalBtnText: { color: "#fff", fontWeight: "800" },
});
