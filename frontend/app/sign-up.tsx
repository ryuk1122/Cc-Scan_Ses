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
  Image,
} from "react-native";
import { useRouter, Link } from "expo-router";

import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";
import { errorMessage } from "@/src/utils/errors";

export default function SignUp() {
  const { signUp } = useSession();
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email || !password || !nombre) {
      Alert.alert("Datos requeridos", "Completa todos los campos");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Contraseña muy corta", "Mínimo 6 caracteres");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, nombre.trim());
      router.replace("/(app)/eventos");
    } catch (e: any) {
      Alert.alert("Error", errorMessage(e, "No se pudo crear la cuenta"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.logoBox}>
            <Image source={require("../assets/images/icon.png")} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Text style={styles.brandTitle}>CedulaScan Pro</Text>
          <Text style={styles.brandSub}>Registro de operadores</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Crear cuenta</Text>

          <Text style={styles.label}>Nombre</Text>
          <TextInput
            testID="signup-nombre-input"
            style={styles.input}
            value={nombre}
            onChangeText={setNombre}
            placeholder="Tu nombre completo"
            placeholderTextColor={theme.textDisabled}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="signup-email-input"
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
            testID="signup-password-input"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Mínimo 6 caracteres"
            placeholderTextColor={theme.textDisabled}
            secureTextEntry
            autoCapitalize="none"
          />

          <TouchableOpacity
            testID="signup-submit-button"
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={onSubmit}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Crear cuenta</Text>}
          </TouchableOpacity>

          <Link href="/sign-in" asChild>
            <TouchableOpacity testID="go-to-signin" style={styles.linkBtn}>
              <Text style={styles.linkText}>
                ¿Ya tienes cuenta? <Text style={styles.linkAccent}>Iniciar sesión</Text>
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
  scroll: { flexGrow: 1, justifyContent: "center", padding: 20 },
  brand: { alignItems: "center", marginBottom: 22 },
  logoBox: {
    width: 104,
    height: 104,
    borderRadius: 28,
    backgroundColor: theme.bg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  logoImage: { width: 104, height: 104 },
  brandTitle: { color: theme.text, fontSize: 26, fontWeight: "900" },
  brandSub: { color: theme.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 8,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
  },
  title: { color: theme.text, fontSize: 20, fontWeight: "800", marginBottom: 8 },
  label: { color: theme.textSecondary, fontSize: 12, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", marginTop: 8 },
  input: {
    backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 14, color: theme.text, fontSize: 16,
  },
  btn: { backgroundColor: theme.info, borderRadius: 8, paddingVertical: 16, alignItems: "center", marginTop: 16 },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  linkBtn: { alignItems: "center", marginTop: 8, paddingVertical: 8 },
  linkText: { color: theme.textSecondary, fontSize: 14 },
  linkAccent: { color: theme.info, fontWeight: "700" },
});
