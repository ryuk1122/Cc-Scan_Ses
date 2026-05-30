import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";
import { errorMessage } from "@/src/utils/errors";

export default function SignIn() {
  const { signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email || !password) {
      Alert.alert("Datos requeridos", "Ingresa email y contraseña");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(app)/eventos");
    } catch (e: any) {
      Alert.alert("Error", errorMessage(e, "No se pudo iniciar sesion"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.logoBox}>
            <Ionicons name="scan-circle" size={64} color={theme.info} />
          </View>
          <Text style={styles.brandTitle}>CédulaScan Pro</Text>
          <Text style={styles.brandSub}>Sincronización en tiempo real · Cero duplicados</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Iniciar Sesión</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="login-email-input"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="[email protected]"
            placeholderTextColor={theme.textDisabled}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            testID="login-password-input"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={theme.textDisabled}
            secureTextEntry
            autoCapitalize="none"
          />

          <TouchableOpacity
            testID="login-submit-button"
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={onSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Entrar</Text>
            )}
          </TouchableOpacity>

          <Link href="/sign-up" asChild>
            <TouchableOpacity testID="go-to-signup" style={styles.linkBtn}>
              <Text style={styles.linkText}>
                ¿No tienes cuenta? <Text style={styles.linkAccent}>Crear cuenta</Text>
              </Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  brand: { alignItems: "center", marginBottom: 32 },
  logoBox: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 16,
  },
  brandTitle: { color: theme.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  brandSub: { color: theme.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
  },
  title: { color: theme.text, fontSize: 22, fontWeight: "700", marginBottom: 8 },
  label: { color: theme.textSecondary, fontSize: 12, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", marginTop: 8 },
  input: {
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: theme.text,
    fontSize: 16,
  },
  btn: {
    backgroundColor: theme.info,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 16,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  linkBtn: { alignItems: "center", marginTop: 8, paddingVertical: 8 },
  linkText: { color: theme.textSecondary, fontSize: 14 },
  linkAccent: { color: theme.info, fontWeight: "700" },
});
