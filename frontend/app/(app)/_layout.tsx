import React from "react";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";

type TabIconProps = { color: string; size: number };

const EventosIcon = ({ color, size }: TabIconProps) => <Ionicons name="calendar" size={size} color={color} />;
const EscanearIcon = ({ color, size }: TabIconProps) => <Ionicons name="scan" size={size} color={color} />;
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
          height: 70,
          paddingBottom: 10,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="eventos" options={{ title: "Eventos", tabBarIcon: EventosIcon }} />
      <Tabs.Screen name="escanear" options={{ title: "Escanear", tabBarIcon: EscanearIcon }} />
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard", tabBarIcon: DashboardIcon }} />
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
