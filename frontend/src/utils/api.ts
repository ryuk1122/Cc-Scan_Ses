/**
 * API client for CedulaScan Pro.
 */
import Constants from "expo-constants";
import { storage } from "@/src/utils/storage";

const rawBase =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Constants.expoConfig?.extra as { backendUrl?: string } | undefined)?.backendUrl ||
  "";
const BASE = rawBase.replace(/\/+$/, "");
const TOKEN_KEY = "cs_token";

export type ApiError = { status: number; detail: any };

async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string>(TOKEN_KEY, "")) || null;
}

export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}, withAuth = true): Promise<T> {
  if (!BASE) {
    throw {
      status: 0,
      detail: "EXPO_PUBLIC_BACKEND_URL no está configurada. Apunta la app al backend público antes de compilar.",
    } as ApiError;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (withAuth) {
    const t = await getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const url = `${BASE}/api${path}`;
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err: ApiError = { status: res.status, detail: data?.detail ?? data };
    throw err;
  }
  return data as T;
}

export const api = {
  register: (body: { email: string; password: string; nombre: string }) =>
    request<{ access_token: string; user: any }>("/auth/register", { method: "POST", body: JSON.stringify(body) }, false),
  login: (body: { email: string; password: string }) =>
    request<{ access_token: string; user: any }>("/auth/login", { method: "POST", body: JSON.stringify(body) }, false),
  me: () => request<any>("/auth/me"),

  // Eventos
  listEventos: () => request<any[]>("/eventos"),
  createEvento: (body: { nombre: string; fecha: string; lugar?: string; descripcion?: string }) =>
    request<any>("/eventos", { method: "POST", body: JSON.stringify(body) }),
  deleteEvento: (id: string) => request<any>(`/eventos/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getEvento: (id: string) => request<any>(`/eventos/${id}`),
  estado: (id: string) => request<any>(`/eventos/${id}/estado`),
  registros: (id: string) => request<any[]>(`/eventos/${id}/registros`),
  auditoria: (id: string) => request<any[]>(`/eventos/${id}/auditoria`),

  // Afiliados
  lookupAfiliado: (cedula: string) => request<any>(`/afiliados/${encodeURIComponent(cedula)}`),
  listAfiliados: (q = "", limit = 50, skip = 0) =>
    request<{ total: number; items: any[] }>(`/admin/afiliados?q=${encodeURIComponent(q)}&limit=${limit}&skip=${skip}`),
  afiliadosStats: () => request<{ total: number }>("/admin/afiliados/stats"),
  adminMetrics: (eventoId?: string) =>
    request<any>(`/admin/metrics${eventoId ? `?evento_id=${encodeURIComponent(eventoId)}` : ""}`),
  adminIaStatus: () => request<any>("/admin/ia/status"),
  updateAfiliado: (cedula: string, body: any) =>
    request<any>(`/admin/afiliados/${encodeURIComponent(cedula)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAfiliado: (cedula: string) =>
    request<any>(`/admin/afiliados/${encodeURIComponent(cedula)}`, { method: "DELETE" }),
  wipeAfiliados: () => request<any>("/admin/afiliados", { method: "DELETE" }),

  // Escaneo
  escanear: (body: any, idempotencyKey: string) =>
    request<any>("/registros/escanear", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": idempotencyKey },
    }),

  // OCR del frente
  ocrCedula: (imageBase64: string) =>
    request<{ ok: boolean; cedula: string; texto_completo?: string; pipeline_usado?: string; gemini?: any; afiliado: any; parsed?: any; raw_mrz?: string[]; mrz_valido?: boolean; error?: string }>(
      "/ocr/cedula",
      { method: "POST", body: JSON.stringify({ image_base64: imageBase64 }) },
    ),
  barcodeCedula: (imageBase64: string) =>
    request<{ ok: boolean; cedula: string; raw: string; parsed?: any; format?: string; source?: string; raw_mrz?: string[]; mrz_valido?: boolean; candidates?: string[]; afiliado: any; error?: string }>(
      "/barcode/cedula",
      { method: "POST", body: JSON.stringify({ image_base64: imageBase64 }) },
    ),

  // Admin registros
  patchRegistro: (eventoId: string, registroId: string, body: any) =>
    request<any>(`/eventos/${eventoId}/registros/${registroId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRegistro: (eventoId: string, registroId: string) =>
    request<any>(
      `/eventos/${encodeURIComponent(eventoId)}/registros/${encodeURIComponent(registroId)}`,
      { method: "DELETE" },
    ),
  clearEventoRegistros: (eventoId: string) =>
    request<any>(`/eventos/${encodeURIComponent(eventoId)}/registros`, { method: "DELETE" }),

  // Exportaci?n: devuelve una URL completa con el token para abrirla en el navegador
  exportUrl: async (eventoId: string) => {
    if (!BASE) throw { status: 0, detail: "EXPO_PUBLIC_BACKEND_URL no está configurada" } as ApiError;
    const t = await getToken();
    return `${BASE}/api/eventos/${eventoId}/export?_t=${encodeURIComponent(t || "")}`;
  },
  exportBlob: async (eventoId: string): Promise<{ blob: Blob; filename: string }> => {
    if (!BASE) throw { status: 0, detail: "EXPO_PUBLIC_BACKEND_URL no está configurada" } as ApiError;
    const t = await getToken();
    const res = await fetch(`${BASE}/api/eventos/${eventoId}/export`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (!res.ok) throw { status: res.status, detail: await res.text() } as ApiError;
    const cd = res.headers.get("content-disposition") || "";
    const m = /filename="?([^"]+)"?/i.exec(cd);
    const filename = m ? m[1] : `registros_${eventoId}.xlsx`;
    const blob = await res.blob();
    return { blob, filename };
  },

  uploadAfiliados: async (
    file: { uri: string; name: string; mimeType?: string },
  ): Promise<any> => {
    if (!BASE) throw { status: 0, detail: "EXPO_PUBLIC_BACKEND_URL no está configurada" } as ApiError;
    const t = await getToken();
    const form = new FormData();
    // @ts-ignore — React Native FormData acepta este formato de objeto
    form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "application/octet-stream" });
    const res = await fetch(`${BASE}/api/admin/afiliados/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}` },
      body: form as any,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw { status: res.status, detail: data?.detail ?? data } as ApiError;
    return data;
  },
};

export function wsUrl(eventoId: string, token: string, deviceId: string): string {
  if (!BASE) throw new Error("EXPO_PUBLIC_BACKEND_URL no está configurada");
  const httpBase = BASE.replace(/^http/, "ws");
  return `${httpBase}/api/eventos/${eventoId}?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(deviceId)}`;
}

export { getToken };
