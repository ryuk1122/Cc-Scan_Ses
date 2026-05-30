import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/src/theme";
import { useEvento } from "@/src/ctx/evento";
import { api } from "@/src/utils/api";

type Estado = {
  total: number;
  hoy: number;
  duplicados_detectados: number;
  dispositivos_usados: number;
  dispositivos_activos: number;
};

export default function DashboardScreen() {
  const router = useRouter();
  const { eventoId, eventoNombre, wsStatus, queueSize, registros, activos } = useEvento();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!eventoId) return;
    try {
      const r = await api.estado(eventoId);
      setEstado(r);
    } catch (e) {
      // ignore
    }
  }, [eventoId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!eventoId) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [eventoId, load]);

  if (!eventoId) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.emptyWrap}>
          <Ionicons name="stats-chart-outline" size={64} color={theme.textDisabled} />
          <Text style={styles.emptyTitle}>Sin evento seleccionado</Text>
          <TouchableOpacity testID="dashboard-go-eventos" style={styles.btn} onPress={() => router.push("/(app)/eventos")}>
            <Text style={styles.btnText}>Seleccionar evento</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const total = estado?.total ?? registros.length;
  const hoy = estado?.hoy ?? 0;
  const dup = estado?.duplicados_detectados ?? 0;
  const devUsados = estado?.dispositivos_usados ?? 0;
  const devActivos = estado?.dispositivos_activos ?? activos;

  const statusColor = wsStatus === "online" ? theme.success : wsStatus === "connecting" ? theme.warning : theme.error;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 12 }}
        refreshControl={
          <RefreshControl
            tintColor={theme.info}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View>
          <Text style={styles.eyebrow}>Dashboard</Text>
          <Text style={styles.title} numberOfLines={2}>{eventoNombre}</Text>
        </View>

        {/* Total + Hoy */}
        <View style={styles.row}>
          <View testID="dashboard-total-metric" style={[styles.statCard, { flex: 1.4 }]}>
            <Text style={styles.statLabel}>Total registrados</Text>
            <Text style={styles.statValue}>{total}</Text>
            <View style={styles.statFootRow}>
              <Ionicons name="checkmark-circle" size={14} color={theme.success} />
              <Text style={styles.statFoot}>Únicos en el evento</Text>
            </View>
          </View>
          <View style={[styles.statCard, { flex: 1 }]}>
            <Text style={styles.statLabel}>Hoy</Text>
            <Text style={[styles.statValue, { color: theme.info }]}>{hoy}</Text>
            <Text style={styles.statFoot}>Última hora UTC</Text>
          </View>
        </View>

        {/* Duplicados */}
        <View testID="dashboard-duplicates-metric" style={[styles.statCard, { borderColor: theme.error }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={styles.statLabel}>Duplicados bloqueados</Text>
              <Text style={[styles.statValue, { color: theme.error }]}>{dup}</Text>
              <Text style={styles.statFoot}>Cédulas rechazadas por integridad de datos</Text>
            </View>
            <View style={[styles.statIconBox, { backgroundColor: theme.errorBg }]}>
              <Ionicons name="shield-checkmark" size={28} color={theme.error} />
            </View>
          </View>
        </View>

        {/* Active devices */}
        <View testID="dashboard-active-devices" style={styles.statCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={styles.statLabel}>Dispositivos</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={[styles.statValue, { color: theme.success }]}>{devActivos}</Text>
                <Text style={styles.statSub}>/ {devUsados} históricos</Text>
              </View>
              <Text style={styles.statFoot}>Activos en este evento</Text>
            </View>
            <View style={[styles.statIconBox, { backgroundColor: theme.successBg }]}>
              <Ionicons name="phone-portrait" size={28} color={theme.success} />
            </View>
          </View>
        </View>

        {/* Sync */}
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Estado de sincronización</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 }}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text style={{ color: statusColor, fontWeight: "800", fontSize: 18 }}>
              {wsStatus === "online" ? "Conectado en tiempo real" : wsStatus === "connecting" ? "Conectando..." : "Offline"}
            </Text>
          </View>
          <Text style={styles.statFoot}>
            {queueSize > 0 ? `Cola pendiente: ${queueSize} operaciones` : "Sin operaciones pendientes"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  eyebrow: { color: theme.info, fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  title: { color: theme.text, fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginTop: 4 },
  row: { flexDirection: "row", gap: 12 },
  statCard: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.border,
  },
  statLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  statValue: { color: theme.text, fontSize: 42, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
  statSub: { color: theme.textSecondary, fontSize: 13 },
  statFoot: { color: theme.textDisabled, fontSize: 11, marginTop: 4 },
  statFootRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  statIconBox: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: 6 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyTitle: { color: theme.text, fontSize: 20, fontWeight: "800" },
  btn: { backgroundColor: theme.info, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  btnText: { color: "#fff", fontWeight: "800" },
});
