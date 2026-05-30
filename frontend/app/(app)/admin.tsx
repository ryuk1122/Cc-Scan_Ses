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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";

import { theme } from "@/src/theme";
import { errorMessage } from "@/src/utils/errors";
import { useSession } from "@/src/ctx/session";
import { useEvento } from "@/src/ctx/evento";
import { api } from "@/src/utils/api";

type Tab = "afiliados" | "registros";

function cleanDisplayName(value: unknown): string {
  const text = String(value || "")
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 2 ? text : "";
}

export default function AdminScreen() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  const [tab, setTab] = useState<Tab>("afiliados");

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
        <Text style={styles.eyebrow}>Administración</Text>
        <Text style={styles.title}>Panel Admin</Text>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          testID="admin-tab-afiliados"
          style={[styles.tabBtn, tab === "afiliados" && styles.tabActive]}
          onPress={() => setTab("afiliados")}
        >
          <Text style={[styles.tabText, tab === "afiliados" && { color: "#fff" }]}>Docentes ({afTotal})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="admin-tab-registros"
          style={[styles.tabBtn, tab === "registros" && styles.tabActive]}
          onPress={() => setTab("registros")}
        >
          <Text style={[styles.tabText, tab === "registros" && { color: "#fff" }]}>Registros</Text>
        </TouchableOpacity>
      </View>

      {tab === "afiliados" ? (
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
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  eyebrow: { color: theme.brand, fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  title: { color: theme.text, fontSize: 30, fontWeight: "900", letterSpacing: -0.8 },
  tabRow: { flexDirection: "row", marginHorizontal: 16, marginVertical: 8, backgroundColor: theme.surface, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: theme.border },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: theme.brand },
  tabText: { color: theme.textSecondary, fontWeight: "700", fontSize: 13 },
  searchRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginVertical: 4 },
  search: { flex: 1, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: theme.text, fontSize: 14 },
  iconBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },
  afRow: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, gap: 8 },
  afCed: { color: theme.text, fontWeight: "900", fontSize: 14 },
  afName: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  afMeta: { color: theme.textDisabled, fontSize: 11, marginTop: 2 },
  afAction: { padding: 8 },
  empty: { color: theme.textDisabled, textAlign: "center", padding: 40 },
  eventInfo: { padding: 14, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 12 },
  eventInfoLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  eventInfoName: { color: theme.text, fontSize: 18, fontWeight: "800", marginTop: 4 },
  eventInfoMeta: { color: theme.textSecondary, fontSize: 12, marginTop: 4 },
  exportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, backgroundColor: theme.brand, borderRadius: 12, marginTop: 10 },
  exportBtnText: { color: "#fff", fontWeight: "800" },
  dangerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: theme.warning, backgroundColor: "rgba(255,204,0,0.08)" },
  dangerBtnText: { color: theme.warning, fontWeight: "800", fontSize: 13 },
  lockWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  lockTitle: { color: theme.text, fontSize: 22, fontWeight: "800" },
  lockSub: { color: theme.textSecondary, textAlign: "center", fontSize: 14 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: "85%" },
  modalHandle: { alignSelf: "center", width: 40, height: 4, backgroundColor: theme.border, borderRadius: 2, marginBottom: 12 },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginBottom: 8 },
  formLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: 10, marginBottom: 4 },
  formInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: theme.text, fontSize: 14 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  modalBtnText: { color: "#fff", fontWeight: "800" },
});
