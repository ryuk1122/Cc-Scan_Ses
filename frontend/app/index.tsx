import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Redirect } from "expo-router";

import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";

export default function Index() {
  const { user, isLoading } = useSession();

  useEffect(() => {
    // no-op
  }, []);

  if (isLoading) {
    return (
      <View style={styles.container} testID="splash-loader">
        <ActivityIndicator size="large" color={theme.info} />
      </View>
    );
  }
  if (!user) return <Redirect href="/sign-in" />;
  return <Redirect href="/(app)/eventos" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: "center",
    justifyContent: "center",
  },
});
