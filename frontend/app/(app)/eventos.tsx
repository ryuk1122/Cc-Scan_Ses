import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/src/theme";
import { errorMessage } from "@/src/utils/errors";
import { api } from "@/src/utils/api";
import { useEvento } from "@/src/ctx/evento";

type Evento = {
  id: string;
  nombre: string;
  fecha: string;
  lugar: string;
  descripcion: string;
  activo: boolean;
  total_registros: number;
};

function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });
}

function normalizeEventDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return todayIso();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const match = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export default function EventosScreen() {
  const router = useRouter();
  const { selectEvento, eventoId } = useEvento();
  const [items, setItems] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: "", fecha: todayIso(), lugar: "", descripcion: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listEventos();
      setItems(list as Evento[]);
    } catch (e: any) {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async () => {
    if (!nuevo.nombre) {
      Alert.alert("Faltan datos", "El nombre es obligatorio");
      return;
    }
    const fecha = normalizeEventDate(nuevo.fecha);
    if (!fecha) {
      Alert.alert("Fecha inválida", "Usa YYYY-MM-DD o DD/MM/YYYY");
      return;
    }
    setCreating(true);
    try {
      await api.createEvento({ ...nuevo, fecha });
      setShowCreate(false);
      setNuevo({ nombre: "", fecha: todayIso(), lugar: "", descripcion: "" });
      await load();
    } catch (e: any) {
      Alert.alert("Error", errorMessage(e, "No se pudo crear"));
    } finally {
      setCreating(false);
    }
  };

  const onSelect = async (item: Evento) => {
    await selectEvento(item.id, item.nombre);
    router.push("/(app)/escanear");
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={theme.info} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Eventos</Text>
          <Text style={styles.subtitle}>Selecciona un evento para escanear</Text>
        </View>
        <TouchableOpacity
          testID="open-create-evento"
          style={styles.addBtn}
          onPress={() => {
            setNuevo((current) => ({ ...current, fecha: current.fecha || todayIso() }));
            setShowCreate(true);
          }}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        testID="event-list"
        data={items}
        keyExtractor={(it) => it.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={theme.info}
          />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={48} color={theme.textDisabled} />
            <Text style={styles.emptyText}>No hay eventos. Crea el primero.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            testID="event-card-item"
            style={[styles.card, eventoId === item.id && styles.cardActive]}
            onPress={() => onSelect(item)}
            activeOpacity={0.8}
          >
            <View style={styles.cardLeft}>
              <View style={styles.cardIcon}>
                <Ionicons name="qr-code" size={22} color={theme.info} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.nombre}
                </Text>
                <Text style={styles.cardMeta}>
                  {item.fecha}
                  {item.lugar ? ` · ${item.lugar}` : ""}
                </Text>
              </View>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.cardCount}>{item.total_registros}</Text>
              <Text style={styles.cardCountLabel}>registros</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal
        visible={showCreate}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCreate(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalWrap}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Nuevo evento</Text>

            <Text style={styles.label}>Nombre</Text>
            <TextInput
              testID="create-evento-nombre"
              style={styles.input}
              value={nuevo.nombre}
              onChangeText={(t) => setNuevo({ ...nuevo, nombre: t })}
              placeholder="Ej: Convención Anual 2026"
              placeholderTextColor={theme.textDisabled}
            />

            <Text style={styles.label}>Fecha</Text>
            <TextInput
              testID="create-evento-fecha"
              style={styles.input}
              value={nuevo.fecha}
              onChangeText={(t) => setNuevo({ ...nuevo, fecha: t })}
              placeholder={todayIso()}
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="none"
            />

            <Text style={styles.label}>Lugar</Text>
            <TextInput
              testID="create-evento-lugar"
              style={styles.input}
              value={nuevo.lugar}
              onChangeText={(t) => setNuevo({ ...nuevo, lugar: t })}
              placeholder="Ej: Bogotá - Centro de Convenciones"
              placeholderTextColor={theme.textDisabled}
            />

            <Text style={styles.label}>Descripción</Text>
            <TextInput
              testID="create-evento-descripcion"
              style={[styles.input, { height: 80, textAlignVertical: "top" }]}
              value={nuevo.descripcion}
              onChangeText={(t) => setNuevo({ ...nuevo, descripcion: t })}
              placeholder="Opcional"
              placeholderTextColor={theme.textDisabled}
              multiline
            />

            <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: theme.surfaceElevated }]}
                onPress={() => setShowCreate(false)}
              >
                <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="create-evento-submit"
                style={[styles.modalBtn, { backgroundColor: theme.info }]}
                onPress={onCreate}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalBtnText}>Crear evento</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: { color: theme.text, fontSize: 32, fontWeight: "900", letterSpacing: -0.8 },
  subtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
  addBtn: {
    backgroundColor: theme.info,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  empty: { alignItems: "center", justifyContent: "center", padding: 60, gap: 12 },
  emptyText: { color: theme.textSecondary, fontSize: 14 },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardActive: { borderColor: theme.info },
  cardLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 12 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.infoBg,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { color: theme.text, fontWeight: "700", fontSize: 16 },
  cardMeta: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  cardRight: { alignItems: "flex-end" },
  cardCount: { color: theme.text, fontWeight: "900", fontSize: 22 },
  cardCountLabel: { color: theme.textDisabled, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
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
    marginBottom: 12,
  },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginBottom: 8 },
  label: {
    color: theme.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 15,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  modalBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
