/**
 * API client for CedulaScan Pro.
 */
import Constants from "expo-constants";
import { File as ExpoFile } from "expo-file-system";
import { storage } from "@/src/utils/storage";

const rawBase =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Constants.expoConfig?.extra as { backendUrl?: string } | undefined)?.backendUrl ||
  "";
const BASE = rawBase.replace(/\/+$/, "");
const TOKEN_KEY = "cs_token";
const API_TIMEOUT_MS = 30000;

export type ApiError = { status: number; detail: any };
let authRevokedHandler: (() => void) | null = null;

export function setAuthRevokedHandler(handler: (() => void) | null): void {
  authRevokedHandler = handler;
}

export function notifyAuthRevoked(): void {
  authRevokedHandler?.();
}

async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string>(TOKEN_KEY, "")) || null;
}

export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}, withAuth = true, timeoutMs = API_TIMEOUT_MS): Promise<T> {
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...options, headers, signal: controller.signal });
  } catch (error: any) {
    throw { status: 0, detail: error?.name === "AbortError" ? "Tiempo de espera agotado" : "No hay conexion con el backend" } as ApiError;
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err: ApiError = { status: res.status, detail: data?.detail ?? data };
    if (withAuth && res.status === 403 && (
      err.detail === "Cuenta de operador desactivada por el administrador" ||
      String(err.detail || "").includes("Dispositivo revocado") ||
      String(err.detail || "").includes("debe iniciar sesión en la versión segura")
    )) {
      authRevokedHandler?.();
    }
    throw err;
  }
  return data as T;
}

export const api = {
  login: (body: { email: string; password: string; device_id: string; verification_pin?: string }) =>
    request<{ access_token: string; user: any }>("/auth/login", { method: "POST", body: JSON.stringify(body) }, false),
  me: () => request<any>("/auth/me"),

  // Eventos
  listEventos: () => request<any[]>("/eventos"),
  createEvento: (body: { nombre: string; fecha: string; lugar?: string; descripcion?: string }) =>
    request<any>("/eventos", { method: "POST", body: JSON.stringify(body) }),
  deleteEvento: (id: string) =>
    request<any>(`/eventos/${encodeURIComponent(id)}?confirm=${encodeURIComponent(id)}`, { method: "DELETE" }),
  getEvento: (id: string) => request<any>(`/eventos/${id}`),
  estado: (id: string) => request<any>(`/eventos/${id}/estado`),
  registros: (id: string, limit = 500, skip = 0) =>
    request<any[]>(`/eventos/${encodeURIComponent(id)}/registros?limit=${limit}&skip=${skip}`),
  misRegistros: (id: string) =>
    request<{ total: number }>(`/eventos/${encodeURIComponent(id)}/mis-registros`),
  registroCedulas: (id: string) =>
    request<string[]>(`/eventos/${encodeURIComponent(id)}/cedulas`),
  auditoria: (id: string) => request<any[]>(`/eventos/${id}/auditoria`),

  // Afiliados
  // Scanner lookups are supplementary; cap their wait so a slow/offline API
  // cannot hold the camera workflow hostage.
  lookupAfiliado: (cedula: string) => request<any>(`/afiliados/${encodeURIComponent(cedula)}`, {}, true, 8000),
  listAfiliados: (q = "", limit = 50, skip = 0) =>
    request<{ total: number; items: any[] }>(`/admin/afiliados?q=${encodeURIComponent(q)}&limit=${limit}&skip=${skip}`),
  afiliadosStats: () => request<{ total: number }>("/admin/afiliados/stats"),
  adminMetrics: (eventoId?: string) =>
    request<any>(`/admin/metrics${eventoId ? `?evento_id=${encodeURIComponent(eventoId)}` : ""}`),
  listOperators: () => request<{ id: string; email: string; nombre: string; active: boolean; online: boolean; created_at?: string }[]>("/admin/operators"),
  createOperator: (body: { email: string; password: string; nombre: string }) =>
    request<{ id: string; email: string; nombre: string; active: boolean; pin: string; expires_in_minutes: number }>("/admin/operators", { method: "POST", body: JSON.stringify(body) }),
  issueDevicePin: (operatorId: string) =>
    request<{ ok: boolean; pin: string; expires_in_minutes: number; operator_email: string }>(`/admin/operators/${encodeURIComponent(operatorId)}/device-pin`, { method: "POST" }),
  listOperatorDevices: () => request<{ device_id: string; user_id: string; email: string; nombre: string; active: boolean; created_at: string; last_seen_at: string }[]>("/admin/devices"),
  revokeDevice: (deviceId: string) =>
    request<{ ok: boolean; device_id: string; active: boolean }>(`/admin/devices/${encodeURIComponent(deviceId)}/active`, { method: "PATCH", body: JSON.stringify({ active: false }) }),
  setOperatorActive: (id: string, active: boolean) =>
    request<{ ok: boolean; id: string; active: boolean }>(`/admin/operators/${encodeURIComponent(id)}/active`, { method: "PATCH", body: JSON.stringify({ active }) }),
  adminIaStatus: () => request<any>("/admin/ia/status"),
  updateAfiliado: (cedula: string, body: any) =>
    request<any>(`/admin/afiliados/${encodeURIComponent(cedula)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAfiliado: (cedula: string) =>
    request<any>(`/admin/afiliados/${encodeURIComponent(cedula)}`, { method: "DELETE" }),
  wipeAfiliados: () =>
    request<any>("/admin/afiliados?confirm=BORRAR_AFILIADOS", { method: "DELETE" }),

  // Escaneo
  escanear: (body: any, idempotencyKey: string) =>
    request<any>("/registros/escanear", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": idempotencyKey },
    }, true, 5000),

  // OCR del frente
  geminiBackup: (imageBase64: string) =>
    request<{ ok: boolean; cedula: string; parsed?: any; requires_review: boolean; error?: string }>(
      "/ocr/cedula/gemini-backup",
      { method: "POST", body: JSON.stringify({ image_base64: imageBase64 }) }, true, 22000,
    ),
  ocrCedula: (imageBase64: string, options: { forceGemini?: boolean; localOnly?: boolean } = {}) =>
    request<{ ok: boolean; cedula: string; texto_completo?: string; pipeline_usado?: string; gemini?: any; afiliado: any; parsed?: any; raw_mrz?: string[]; mrz_valido?: boolean; error?: string }>(
      options.localOnly ? "/ocr/cedula/local" : "/ocr/cedula",
      { method: "POST", body: JSON.stringify({ image_base64: imageBase64, force_gemini: !!options.forceGemini }) },
      true,
      22000,
    ),
  barcodeCedula: (imageBase64: string, options: { preferMrz?: boolean } = {}) =>
    request<{ ok: boolean; cedula: string; raw: string; parsed?: any; format?: string; source?: string; raw_mrz?: string[]; mrz_valido?: boolean; candidates?: string[]; afiliado: any; error?: string }>(
      "/barcode/cedula",
      { method: "POST", body: JSON.stringify({ image_base64: imageBase64, prefer_mrz: !!options.preferMrz }) },
      true,
      8000,
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
    request<any>(
      `/eventos/${encodeURIComponent(eventoId)}/registros?confirm=${encodeURIComponent(eventoId)}`,
      { method: "DELETE" },
    ),

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
    // Expo SDK 56 convierte FormData antes de enviarlo y no acepta el descriptor
    // React Native { uri, name, type }; esa ruta produce
    // "Unsupported FormDataPart implementation". ExpoFile se pasa directamente
    // porque su implementación de bytes() es compatible con el serializador Expo.
    const form = new FormData();
    const filePart = new ExpoFile(file.uri);
    form.append("file", filePart);
    const res = await fetch(`${BASE}/api/admin/afiliados/import`, {
      method: "POST",
      // No fijar Content-Type aquí: fetch agrega multipart/form-data con su boundary.
      headers: { Authorization: `Bearer ${t}` },
      body: form,
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
