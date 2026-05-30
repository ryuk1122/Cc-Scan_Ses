import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/src/theme";
import { useSession } from "@/src/ctx/session";
import { useEvento } from "@/src/ctx/evento";

export default function PerfilScreen() {
  const { user, signOut } = useSession();
  const { eventoNombre, registros, duplicadosBloqueados, clearEvento } = useEvento();
  const router = useRouter();

  const handleLogout = () => {
    Alert.alert("Cerrar sesión", "¿Deseas cerrar sesión?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Cerrar sesión",
        style: "destructive",
        onPress: async () => {
          clearEvento();
          await signOut();
          router.replace("/sign-in");
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Cuenta</Text>
        <Text style={styles.title}>Perfil</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={36} color={theme.info} />
        </View>
        <Text testID="profile-nombre" style={styles.name}>{user?.nombre}</Text>
        <Text testID="profile-email" style={styles.email}>{user?.email}</Text>
        <View style={styles.rolePill}>
          <Text style={styles.roleText}>{user?.role || "operator"}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Sesión actual</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Evento</Text>
          <Text style={styles.rowValue}>{eventoNombre || "Ninguno"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Escaneadas</Text>
          <Text style={styles.rowValue}>{registros.length}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Duplicados bloqueados</Text>
          <Text style={[styles.rowValue, { color: theme.error }]}>{duplicadosBloqueados}</Text>
        </View>
      </View>

      <TouchableOpacity testID="logout-button" style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color={theme.error} />
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>CédulaScan Pro · v1.0.0</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: 20, gap: 16 },
  header: {},
  eyebrow: { color: theme.info, fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  title: { color: theme.text, fontSize: 32, fontWeight: "900", letterSpacing: -0.8 },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    gap: 6,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: theme.infoBg, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: theme.info,
  },
  name: { color: theme.text, fontSize: 22, fontWeight: "800", marginTop: 8 },
  email: { color: theme.textSecondary, fontSize: 14 },
  rolePill: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginTop: 6 },
  roleText: { color: theme.text, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  sectionTitle: { color: theme.text, fontSize: 16, fontWeight: "800", alignSelf: "flex-start", marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch", paddingVertical: 8 },
  rowLabel: { color: theme.textSecondary, fontSize: 13 },
  rowValue: { color: theme.text, fontSize: 14, fontWeight: "700" },
  logoutBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.error,
    backgroundColor: theme.errorBg,
  },
  logoutText: { color: theme.error, fontWeight: "800", fontSize: 15 },
  footer: { color: theme.textDisabled, textAlign: "center", fontSize: 11, marginTop: "auto" },
});
