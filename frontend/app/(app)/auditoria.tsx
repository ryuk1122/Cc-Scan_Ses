import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/src/theme";
import { useEvento } from "@/src/ctx/evento";
import { api } from "@/src/utils/api";

type AuditEvent = {
  event_type: string;
  aggregate_id: string;
  data: any;
  timestamp: number;
  created_at: string;
  dedup_hash?: string;
};

export default function AuditoriaScreen() {
  const router = useRouter();
  const { eventoId, eventoNombre } = useEvento();
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!eventoId) return;
    try {
      const r = await api.auditoria(eventoId);
      setItems(r as AuditEvent[]);
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  }, [eventoId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!eventoId) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [eventoId, load]);

  if (!eventoId) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.emptyWrap}>
          <Ionicons name="document-text-outline" size={64} color={theme.textDisabled} />
          <Text style={styles.emptyTitle}>Sin evento</Text>
          <TouchableOpacity testID="audit-go-eventos" style={styles.btn} onPress={() => router.push("/(app)/eventos")}>
            <Text style={styles.btnText}>Seleccionar evento</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Event Sourcing</Text>
        <Text style={styles.title}>Auditoría</Text>
        <Text style={styles.sub} numberOfLines={1}>{eventoNombre}</Text>
      </View>

      <FlatList
        testID="audit-log-list"
        data={items}
        keyExtractor={(it, idx) => `${it.timestamp}_${idx}`}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={theme.info}
          />
        }
        ListEmptyComponent={<Text style={styles.empty}>Sin eventos aún. Comienza a escanear.</Text>}
        renderItem={({ item }) => {
          const isDup = item.event_type === "DUPLICADO_RECHAZADO";
          const color = isDup ? theme.error : theme.success;
          const bg = isDup ? theme.errorBg : theme.successBg;
          return (
            <View testID="audit-log-item" style={[styles.item, { borderColor: color }]}>
              <View style={[styles.iconBox, { backgroundColor: bg }]}>
                <Ionicons name={isDup ? "warning" : "checkmark-circle"} size={20} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemType, { color }]}>{isDup ? "DUPLICADO RECHAZADO" : "REGISTRO CREADO"}</Text>
                <Text style={styles.itemCedula}>Cédula {item.data?.cedula || "—"}</Text>
                <Text style={styles.itemMeta}>
                  {new Date(item.created_at).toLocaleString("es-CO")} · device {item.data?.device_id || "—"}
                </Text>
                {item.data?.operator_email && (
                  <Text style={styles.itemMeta}>operador: {item.data.operator_email}</Text>
                )}
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  eyebrow: { color: theme.warning, fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  title: { color: theme.text, fontSize: 32, fontWeight: "900", letterSpacing: -0.8 },
  sub: { color: theme.textSecondary, fontSize: 13 },
  item: { flexDirection: "row", gap: 12, padding: 14, backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  itemType: { fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  itemCedula: { color: theme.text, fontSize: 16, fontWeight: "800", marginTop: 2 },
  itemMeta: { color: theme.textDisabled, fontSize: 11, marginTop: 2 },
  empty: { color: theme.textDisabled, textAlign: "center", padding: 40 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyTitle: { color: theme.text, fontSize: 20, fontWeight: "800" },
  btn: { backgroundColor: theme.info, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: "#fff", fontWeight: "800" },
});
