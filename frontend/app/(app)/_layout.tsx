import React from "react";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";

type TabIconProps = { color: string; size: number };

const ScannerIcon = ({ color, size }: TabIconProps) => <Ionicons name="scan" size={size} color={color} />;
const DashboardIcon = ({ color, size }: TabIconProps) => <Ionicons name="stats-chart" size={size} color={color} />;
const AuditoriaIcon = ({ color, size }: TabIconProps) => <Ionicons name="document-text" size={size} color={color} />;
const AdminIcon = ({ color, size }: TabIconProps) => <Ionicons name="shield-checkmark" size={size} color={color} />;
const PerfilIcon = ({ color, size }: TabIconProps) => <Ionicons name="person-circle" size={size} color={color} />;

export default function AppLayout() {
  const { user, isLoading } = useSession();
  if (isLoading) return null;
  if (!user) return <Redirect href="/sign-in" />;
  const isAdmin = user.role === "admin";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: 1,
          height: 62,
          paddingBottom: 7,
          paddingTop: 7,
          elevation: 12,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -3 },
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700" },
      }}
    >
      <Tabs.Screen name="eventos" options={{ title: "Escaner", tabBarIcon: ScannerIcon }} />
      <Tabs.Screen name="escanear" options={{ href: null }} />
      <Tabs.Screen name="dashboard" options={{ title: "Panel", tabBarIcon: DashboardIcon }} />
      <Tabs.Screen name="auditoria" options={{ title: "Auditoría", tabBarIcon: AuditoriaIcon }} />
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          tabBarIcon: AdminIcon,
          href: isAdmin ? "/(app)/admin" : null,
        }}
      />
      <Tabs.Screen name="perfil" options={{ title: "Perfil", tabBarIcon: PerfilIcon }} />
    </Tabs>
  );
}
