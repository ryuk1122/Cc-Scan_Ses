/**
 * Selected-event + WebSocket + local registry context.
 * - Keeps `Set<cedula>` for instant client-side duplicate detection
 * - Reconnects WS automatically when token/event changes
 * - Pushes scans to backend; queues if offline
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { AppState } from "react-native";
import { api, wsUrl, notifyAuthRevoked } from "@/src/utils/api";
import { useSession } from "@/src/ctx/session";
import { storage } from "@/src/utils/storage";
import { getDeviceId, newNonce } from "@/src/utils/device";

type Registro = {
  id: string;
  evento_id: string;
  cedula: string;
  nombre: string;
  sede: string;
  municipio: string;
  cargo: string;
  device_id: string;
  operator_email: string;
  timestamp: number;
  created_at: string;
  es_afiliado?: boolean;
  fecha_nacimiento?: string;
  fecha_expiracion?: string;
};

type EventoCtxValue = {
  eventoId: string | null;
  eventoNombre: string;
  registros: Registro[];
  totalRegistros: number;
  misRegistros: number;
  wsStatus: "idle" | "connecting" | "online" | "offline";
  activos: number;
  duplicadosBloqueados: number;
  queueSize: number;
  lastDuplicate: { cedula: string; ts: number } | null;
  lastSuccess: { cedula: string; ts: number } | null;
  selectEvento: (id: string, nombre: string) => Promise<void>;
  clearEvento: () => void;
  scan: (
    cedula: string,
    extras?: Partial<Registro> & { raw_barcode?: string },
  ) => Promise<{ ok: boolean; mensaje: string; duplicate?: boolean; registro?: Registro }>;
  refreshRegistros: () => Promise<void>;
};

const EventoCtx = createContext<EventoCtxValue | undefined>(undefined);

const QUEUE_KEY = "cs_offline_queue";
const SELECTED_EVENT_KEY = "cs_selected_event";
const REGISTROS_CACHE_PREFIX = "cs_registros_";
const REGISTROS_RECENT_LIMIT = 200;

type StoredEvento = {
  id: string;
  nombre: string;
};

type QueueItem = {
  cedula: string;
  evento_id: string;
  device_id: string;
  timestamp: number;
  nonce: string;
  nombre: string;
  sede: string;
  municipio: string;
  cargo: string;
  raw_barcode?: string;
  operator_email?: string;
  primer_apellido?: string;
  segundo_apellido?: string;
  nombres?: string;
  genero?: string;
  fecha_nacimiento?: string;
  fecha_expiracion?: string;
  tipo_sangre?: string;
  idempotency_key: string;
  attempts: number;
  next_attempt_at?: number;
  last_error?: string;
};

function queuedRegistro(item: QueueItem): Registro {
  return {
    id: `local_${item.idempotency_key}`,
    evento_id: item.evento_id,
    cedula: item.cedula,
    nombre: item.nombre,
    sede: item.sede,
    municipio: item.municipio,
    cargo: item.cargo,
    device_id: item.device_id,
    operator_email: item.operator_email || "(pendiente)",
    timestamp: item.timestamp,
    created_at: new Date(item.timestamp).toISOString(),
  };
}

// Serialize queue read/modify/write operations. A scan enqueue must never be
// overwritten by a simultaneous background sync on the same device.
let queueMutation = Promise.resolve();
function withQueueLock<T>(work: () => Promise<T>): Promise<T> {
  const next = queueMutation.then(work, work);
  queueMutation = next.then(() => undefined, () => undefined);
  return next;
}

function retryDelay(attempts: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

function scanErrorMessage(err: any, fallback: string): string {
  const detail = err?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (typeof detail?.detail === "string" && detail.detail.trim()) return detail.detail;
  return fallback;
}

export function EventoProvider({ children }: { children: ReactNode }) {
  const { token, user } = useSession();
  const [eventoId, setEventoId] = useState<string | null>(null);
  const [eventoNombre, setEventoNombre] = useState("");
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [misRegistros, setMisRegistros] = useState(0);
  const cedulasSetRef = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);
  const [wsStatus, setWsStatus] = useState<EventoCtxValue["wsStatus"]>("idle");
  const [activos, setActivos] = useState(0);
  const [duplicadosBloqueados, setDuplicadosBloqueados] = useState(0);
  const [queueSize, setQueueSize] = useState(0);
  const [lastDuplicate, setLastDuplicate] = useState<EventoCtxValue["lastDuplicate"]>(null);
  const [lastSuccess, setLastSuccess] = useState<EventoCtxValue["lastSuccess"]>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const forceFlushRequestedRef = useRef(false);
  const reconnectTimer = useRef<any>(null);
  const pingTimer = useRef<any>(null);
  const deviceIdRef = useRef<string>("");
  const isFlushingRef = useRef(false);

  useEffect(() => {
    getDeviceId().then((d) => (deviceIdRef.current = d));
  }, []);

  const cacheRegistros = useCallback(async (id: string, list: Registro[]) => {
    await storage.setItem(`${REGISTROS_CACHE_PREFIX}${id}`, list as any);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await storage.getItem<StoredEvento | null>(SELECTED_EVENT_KEY, null);
      if (cancelled || !saved?.id) return;
      const cached = (await storage.getItem<Registro[] | null>(`${REGISTROS_CACHE_PREFIX}${saved.id}`, null)) || [];
      const visibleCached = user?.role === "admin"
        ? cached
        : cached.filter((r) => r.operator_email?.trim().toLowerCase() === user?.email?.trim().toLowerCase());
      const pending = ((await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [])
        .filter((item) => item.evento_id === saved.id && item.operator_email?.trim().toLowerCase() === user?.email?.trim().toLowerCase());
      const visible = [...pending.map(queuedRegistro), ...visibleCached.filter((r) => !pending.some((item) => item.cedula === r.cedula))]
        .slice(0, REGISTROS_RECENT_LIMIT);
      setEventoId(saved.id);
      setEventoNombre(saved.nombre || "");
      cedulasSetRef.current = new Set([...visibleCached.map((r) => r.cedula), ...pending.map((r) => r.cedula)]);
      setRegistros(visible);
      setTotalRegistros(visibleCached.length);
      setMisRegistros(visibleCached.length + pending.filter((item) => item.operator_email?.trim().toLowerCase() === user?.email?.trim().toLowerCase()).length);
      setQueueSize(pending.length);
      forceRender((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email, user?.role]);

  const addRegistro = useCallback((r: Registro, countAsNew = true) => {
    if (cedulasSetRef.current.has(r.cedula)) return;
    cedulasSetRef.current.add(r.cedula);
    setRegistros((prev) => {
      const next = [r, ...prev].slice(0, REGISTROS_RECENT_LIMIT);
      void cacheRegistros(r.evento_id, next);
      return next;
    });
    if (countAsNew) {
      setTotalRegistros((prev) => prev + 1);
    }
    forceRender((n) => n + 1);
  }, [cacheRegistros]);

  const reconcileQueuedRegistro = useCallback(async (item: QueueItem, registro?: Registro) => {
    const confirmed = registro || queuedRegistro(item);
    const cached = (await storage.getItem<Registro[] | null>(`${REGISTROS_CACHE_PREFIX}${item.evento_id}`, null)) || [];
    const next = [confirmed, ...cached.filter((r) => r.cedula !== item.cedula)].slice(0, REGISTROS_RECENT_LIMIT);
    await cacheRegistros(item.evento_id, next);
    if (eventoId !== item.evento_id) return;
    cedulasSetRef.current.add(item.cedula);
    setRegistros(next);
    forceRender((n) => n + 1);
  }, [cacheRegistros, eventoId]);

  const refreshRegistros = useCallback(async () => {
    if (!eventoId) return;
    try {
      const [list, est, cedulas, mine] = await Promise.all([
        api.registros(eventoId, REGISTROS_RECENT_LIMIT, 0),
        api.estado(eventoId),
        api.registroCedulas(eventoId),
        api.misRegistros(eventoId),
      ]);
      const set = new Set<string>((cedulas.length ? cedulas : list.map((r) => r.cedula)).map(String));
      const pending = ((await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [])
        .filter((item) => item.evento_id === eventoId);
      pending.forEach((item) => set.add(item.cedula));
      cedulasSetRef.current = set;
      const visible = [...pending.map(queuedRegistro), ...(list as Registro[]).filter((r) => !pending.some((item) => item.cedula === r.cedula))]
        .slice(0, REGISTROS_RECENT_LIMIT);
      setRegistros(visible);
      await cacheRegistros(eventoId, visible);
      setTotalRegistros(Number(est.total ?? list.length));
      setMisRegistros(Number(mine.total ?? 0) + pending.filter((item) => item.operator_email === user?.email).length);
      setDuplicadosBloqueados(est.duplicados_detectados ?? 0);
      setActivos(est.dispositivos_activos ?? 0);
    } catch {
      // Preserve the current local registry while offline.
      const cached = (await storage.getItem<Registro[] | null>(`${REGISTROS_CACHE_PREFIX}${eventoId}`, null)) || [];
      const pending = ((await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [])
        .filter((item) => item.evento_id === eventoId);
      setMisRegistros(cached.filter((r) => r.operator_email === user?.email).length + pending.filter((item) => item.operator_email === user?.email).length);
    }
  }, [eventoId, cacheRegistros, user?.email]);

  // WS lifecycle
  useEffect(() => {
    if (!eventoId || !token) return;

    let cancelled = false;

    const stopPing = () => {
      if (pingTimer.current) clearInterval(pingTimer.current);
      pingTimer.current = null;
    };

    const connect = () => {
      if (cancelled) return;
      setWsStatus("connecting");
      stopPing();
      try {
        const url = wsUrl(eventoId, token, deviceIdRef.current);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          setWsStatus("online");
          stopPing();
          pingTimer.current = setInterval(() => {
            try {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
              }
            } catch {
              // ignore
            }
          }, 25000);
        };
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === "registro:nuevo" && msg.registro) {
              addRegistro(msg.registro);
            } else if (msg.type === "registro:duplicado") {
              setDuplicadosBloqueados((n) => n + 1);
              setLastDuplicate({ cedula: msg.cedula, ts: msg.ts });
            } else if (msg.type === "device:conectado" || msg.type === "device:desconectado") {
              if (typeof msg.activos === "number") setActivos(msg.activos);
            } else if (msg.type === "estado:inicial") {
              if (typeof msg.activos === "number") setActivos(msg.activos);
            }
          } catch {
            // ignore
          }
        };
        ws.onerror = () => {
          stopPing();
          setWsStatus("offline");
        };
        ws.onclose = (event) => {
          if (cancelled) return;
          stopPing();
          setWsStatus("offline");
          if (event.code === 4401 || event.code === 4403) {
            notifyAuthRevoked();
            return;
          }
          // retry in 2s
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          reconnectTimer.current = setTimeout(connect, 2000);
        };
      } catch {
        setWsStatus("offline");
        stopPing();
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(connect, 2000);
      }
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      stopPing();
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [eventoId, token, addRegistro]);

  // Offline queue flusher
  const flushQueue = useCallback(async (force = false) => {
    if (force) forceFlushRequestedRef.current = true;
    if (isFlushingRef.current) return;
    isFlushingRef.current = true;
    try {
    while (true) {
      const q = (await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [];
      setQueueSize(q.length);
      const now = Date.now();
      const ignoreBackoff = forceFlushRequestedRef.current;
      forceFlushRequestedRef.current = false;
      const due = q.filter((item) => ignoreBackoff || !item.next_attempt_at || item.next_attempt_at <= now).slice(0, 3);
      if (!due.length) break;
      let persistenceFailed = false;
      await Promise.all(due.map(async (item) => {
        try {
          const result = await api.escanear({
            cedula: item.cedula, evento_id: item.evento_id, device_id: item.device_id,
            timestamp: item.timestamp, nonce: item.nonce, nombre: item.nombre, sede: item.sede,
            municipio: item.municipio, cargo: item.cargo, raw_barcode: item.raw_barcode || "",
            primer_apellido: item.primer_apellido || "", segundo_apellido: item.segundo_apellido || "",
            nombres: item.nombres || "", genero: item.genero || "", fecha_nacimiento: item.fecha_nacimiento || "",
            fecha_expiracion: item.fecha_expiracion || "", tipo_sangre: item.tipo_sangre || "",
          }, item.idempotency_key);
          await reconcileQueuedRegistro(item, (result?.registro || result?.registro_existente) as Registro | undefined);
          await withQueueLock(async () => {
            const latest = (await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [];
            const saved = await storage.setItem(QUEUE_KEY, latest.filter((entry) => entry.idempotency_key !== item.idempotency_key));
            if (saved) setQueueSize(Math.max(0, latest.length - 1));
            else persistenceFailed = true;
          });
        } catch (err: any) {
          let confirmed: Registro | undefined;
          if (err?.status === 409) confirmed = err?.detail?.registro_existente as Registro | undefined;
          if (err?.status === 409) await reconcileQueuedRegistro(item, confirmed);
          await withQueueLock(async () => {
            const latest = (await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [];
            const saved = await storage.setItem(QUEUE_KEY, err?.status === 409
              ? latest.filter((entry) => entry.idempotency_key !== item.idempotency_key)
              : latest.map((entry) => entry.idempotency_key === item.idempotency_key
                ? { ...entry, attempts: (entry.attempts || 0) + 1, next_attempt_at: Date.now() + retryDelay((entry.attempts || 0) + 1), last_error: scanErrorMessage(err, "Error de sincronización") }
                : entry));
            if (saved) setQueueSize(err?.status === 409 ? Math.max(0, latest.length - 1) : latest.length);
            else persistenceFailed = true;
          });
        }
      }));
      if (persistenceFailed) break;
      // Small pause limits reconnect bursts while continuously draining backlog.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    } finally {
      isFlushingRef.current = false;
    }
  }, [reconcileQueuedRegistro]);

  useEffect(() => {
    if (wsStatus === "online") {
      flushQueue(true);
    }
  }, [wsStatus, flushQueue]);

  // Immediately retry stored scans when the operator returns to the app or
  // signs in again; do not leave entries waiting behind an old retry timer.
  useEffect(() => {
    if (token) void flushQueue(true);
  }, [token, flushQueue]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && token) void flushQueue(true);
    });
    return () => subscription.remove();
  }, [token, flushQueue]);

  // Periodic queue retry
  useEffect(() => {
    const id = setInterval(() => {
      flushQueue();
    }, 5000);
    return () => clearInterval(id);
  }, [flushQueue]);

  const selectEvento = useCallback(async (id: string, nombre: string) => {
    setEventoId(id);
    setEventoNombre(nombre);
    await storage.setItem(SELECTED_EVENT_KEY, { id, nombre });
    cedulasSetRef.current = new Set();
    setRegistros([]);
    setDuplicadosBloqueados(0);
    setActivos(0);
    setLastDuplicate(null);
    setLastSuccess(null);
    setTotalRegistros(0);
    setMisRegistros(0);
    const pending = ((await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [])
      .filter((item) => item.evento_id === id);
    setQueueSize(pending.length);
    cedulasSetRef.current = new Set(pending.map((item) => item.cedula));
    setRegistros(pending.map(queuedRegistro));
    // Load initial
    try {
      const [list, est, cedulas, mine] = await Promise.all([
        api.registros(id, REGISTROS_RECENT_LIMIT, 0),
        api.estado(id),
        api.registroCedulas(id),
        api.misRegistros(id),
      ]);
      const set = new Set<string>((cedulas.length ? cedulas : list.map((r) => r.cedula)).map(String));
      pending.forEach((item) => set.add(item.cedula));
      cedulasSetRef.current = set;
      const visible = [...pending.map(queuedRegistro), ...(list as Registro[]).filter((r) => !pending.some((item) => item.cedula === r.cedula))]
        .slice(0, REGISTROS_RECENT_LIMIT);
      setRegistros(visible);
      await cacheRegistros(id, visible);
      setTotalRegistros(Number(est.total ?? list.length));
      setMisRegistros(Number(mine.total ?? 0) + pending.filter((item) => item.operator_email === user?.email).length);
      setDuplicadosBloqueados(est.duplicados_detectados ?? 0);
      setActivos(est.dispositivos_activos ?? 0);
    } catch {
      const cached = (await storage.getItem<Registro[] | null>(`${REGISTROS_CACHE_PREFIX}${id}`, null)) || [];
      setMisRegistros(cached.filter((r) => r.operator_email === user?.email).length + pending.filter((item) => item.operator_email === user?.email).length);
    }
  }, [cacheRegistros, user?.email]);

  const clearEvento = useCallback(() => {
    setEventoId(null);
    setEventoNombre("");
    setRegistros([]);
    setTotalRegistros(0);
    setMisRegistros(0);
    cedulasSetRef.current = new Set();
    void storage.removeItem(SELECTED_EVENT_KEY);
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (eventoId && token) {
      const refreshTimer = setTimeout(() => { void refreshRegistros(); }, 0);
      return () => clearTimeout(refreshTimer);
    }
  }, [eventoId, token, refreshRegistros]);

  const scan = useCallback(
    async (cedulaRaw: string, extras: Partial<Registro> & { raw_barcode?: string } = {}) => {
      if (!eventoId) return { ok: false, mensaje: "Selecciona un evento primero" };
      const cedula = cedulaRaw.replace(/\D/g, "");
      if (!cedula) return { ok: false, mensaje: "Cédula inválida" };

      // Nivel 1: cliente local
      if (cedulasSetRef.current.has(cedula)) {
        setLastDuplicate({ cedula, ts: Date.now() });
        setDuplicadosBloqueados((n) => n + 1);
        return { ok: false, duplicate: true, mensaje: `Atención: ya registrado: ${cedula}` };
      }

      const existingQueue = (await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [];
      if (existingQueue.some((item) => item.evento_id === eventoId && item.cedula === cedula)) {
        setLastDuplicate({ cedula, ts: Date.now() });
        return { ok: false, duplicate: true, mensaje: `Atención: ${cedula} ya está guardada en la cola de este dispositivo` };
      }

      const nonce = newNonce();
      const ts = Date.now();
      const device_id = deviceIdRef.current || (await getDeviceId());
      const idempotency_key = `${cedula}-${eventoId}-${device_id}-${nonce}`;

      const payload: any = {
        cedula,
        evento_id: eventoId,
        device_id,
        timestamp: ts,
        nonce,
        nombre: (extras as any).nombre || "",
        sede: (extras as any).sede || "",
        municipio: (extras as any).municipio || "",
        cargo: (extras as any).cargo || "",
        raw_barcode: extras.raw_barcode || "",
        primer_apellido: (extras as any).primer_apellido || "",
        segundo_apellido: (extras as any).segundo_apellido || "",
        nombres: (extras as any).nombres || "",
        genero: (extras as any).genero || "",
        fecha_nacimiento: (extras as any).fecha_nacimiento || "",
        fecha_expiracion: (extras as any).fecha_expiracion || "",
        tipo_sangre: (extras as any).tipo_sangre || "",
        operator_email: user?.email || "",
      };

      // Write-ahead queue: durably store each scan before the first network call.
      const persisted = await withQueueLock(async () => {
        const q = (await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [];
        if (q.some((item) => item.evento_id === eventoId && item.cedula === cedula)) return -1;
        q.push({ ...payload, idempotency_key, attempts: 0 });
        return await storage.setItem(QUEUE_KEY, q) ? q.length : -2;
      });
      if (persisted === -1) {
        return { ok: false, duplicate: true, mensaje: `Atención: ${cedula} ya está guardada en la cola de este dispositivo` };
      }
      if (persisted < 0) {
        return { ok: false, mensaje: "No se pudo guardar en este teléfono. No marques este escaneo como registrado; informa al administrador." };
      }
      setQueueSize(persisted);

      const local = queuedRegistro({ ...payload, idempotency_key, attempts: 0 });
      addRegistro(local);
      setMisRegistros((prev) => prev + 1);
      setLastSuccess({ cedula, ts: Date.now() });
      // Network delivery runs in the background; the camera is immediately
      // available for the next person. The write-ahead copy is already durable.
      void flushQueue(true);
      return { ok: true, mensaje: "Guardado en este teléfono; sincronizando con el servidor.", registro: local };
    },
    [eventoId, addRegistro, flushQueue, user?.email],
  );

  // Load queue size at startup
  useEffect(() => {
    storage.getItem<QueueItem[] | null>(QUEUE_KEY, null).then((q) => {
      setQueueSize((q || []).length);
    });
  }, []);

  return (
    <EventoCtx.Provider
      value={{
        eventoId,
        eventoNombre,
        registros,
        totalRegistros,
        misRegistros,
        wsStatus,
        activos,
        duplicadosBloqueados,
        queueSize,
        lastDuplicate,
        lastSuccess,
        selectEvento,
        clearEvento,
        scan,
        refreshRegistros,
      }}
    >
      {children}
    </EventoCtx.Provider>
  );
}

export function useEvento(): EventoCtxValue {
  const ctx = useContext(EventoCtx);
  if (!ctx) throw new Error("useEvento must be inside EventoProvider");
  return ctx;
}
