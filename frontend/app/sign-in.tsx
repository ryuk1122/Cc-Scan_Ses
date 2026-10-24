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
import { useRouter } from "expo-router";

import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";
import { errorMessage } from "@/src/utils/errors";

export default function SignIn() {
  const { signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationPin, setVerificationPin] = useState("");
  const [showPinField, setShowPinField] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email || !password) {
      Alert.alert("Datos requeridos", "Ingresa email y contraseña");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password, verificationPin);
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
            <Image source={require("../assets/images/icon.png")} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Text style={styles.brandTitle}>CedulaScan Pro</Text>
          <Text style={styles.brandSub}>Docentes en tiempo real</Text>
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

          <TouchableOpacity onPress={() => setShowPinField((visible) => !visible)} accessibilityRole="button">
            <Text style={styles.pinToggle}>{showPinField ? "Ocultar PIN de dispositivo" : "¿Eres operador en un dispositivo nuevo? Ingresa tu PIN de Admin"}</Text>
          </TouchableOpacity>
          {showPinField && <>
            <Text style={styles.label}>PIN de verificación del operador</Text>
            <TextInput
              testID="login-device-pin-input"
              style={styles.input}
              value={verificationPin}
              onChangeText={setVerificationPin}
              placeholder="PIN de 6 dígitos"
              placeholderTextColor={theme.textDisabled}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
            />
            <Text style={styles.pinHelp}>Admin debe dejar este espacio cerrado. El PIN del operador vence en 10 minutos y se usa una sola vez.</Text>
          </>}

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

          <Text style={styles.linkText}>Las cuentas y los PIN los administra el administrador del sistema.</Text>
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
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: theme.text,
    fontSize: 16,
  },
  btn: {
    backgroundColor: theme.info,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 16,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  linkText: { color: theme.textSecondary, fontSize: 13, textAlign: "center", marginTop: 8 },
  pinHelp: { color: theme.textSecondary, fontSize: 11, lineHeight: 15, marginTop: -5 },
  pinToggle: { color: theme.brand, fontSize: 13, fontWeight: "700", marginTop: 8, marginBottom: 10 },
  linkAccent: { color: theme.info, fontWeight: "700" },
});
