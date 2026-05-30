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
import { api, wsUrl } from "@/src/utils/api";
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
};

type EventoCtxValue = {
  eventoId: string | null;
  eventoNombre: string;
  registros: Registro[];
  cedulasSet: Set<string>;
  wsStatus: "idle" | "connecting" | "online" | "offline";
  activos: number;
  duplicadosBloqueados: number;
  queueSize: number;
  lastDuplicate: { cedula: string; ts: number } | null;
  lastSuccess: { cedula: string; ts: number } | null;
  selectEvento: (id: string, nombre: string) => Promise<void>;
  clearEvento: () => void;
  scan: (cedula: string, extras?: Partial<Registro> & { raw_barcode?: string }) => Promise<{ ok: boolean; mensaje: string; duplicate?: boolean }>;
  refreshRegistros: () => Promise<void>;
};

const EventoCtx = createContext<EventoCtxValue | undefined>(undefined);

const QUEUE_KEY = "cs_offline_queue";

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
  primer_apellido?: string;
  segundo_apellido?: string;
  nombres?: string;
  genero?: string;
  fecha_nacimiento?: string;
  tipo_sangre?: string;
  idempotency_key: string;
  attempts: number;
};

export function EventoProvider({ children }: { children: ReactNode }) {
  const { token } = useSession();
  const [eventoId, setEventoId] = useState<string | null>(null);
  const [eventoNombre, setEventoNombre] = useState("");
  const [registros, setRegistros] = useState<Registro[]>([]);
  const cedulasSetRef = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);
  const [wsStatus, setWsStatus] = useState<EventoCtxValue["wsStatus"]>("idle");
  const [activos, setActivos] = useState(0);
  const [duplicadosBloqueados, setDuplicadosBloqueados] = useState(0);
  const [queueSize, setQueueSize] = useState(0);
  const [lastDuplicate, setLastDuplicate] = useState<EventoCtxValue["lastDuplicate"]>(null);
  const [lastSuccess, setLastSuccess] = useState<EventoCtxValue["lastSuccess"]>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<any>(null);
  const deviceIdRef = useRef<string>("");

  useEffect(() => {
    getDeviceId().then((d) => (deviceIdRef.current = d));
  }, []);

  const addRegistro = useCallback((r: Registro) => {
    if (cedulasSetRef.current.has(r.cedula)) return;
    cedulasSetRef.current.add(r.cedula);
    setRegistros((prev) => [r, ...prev]);
    forceRender((n) => n + 1);
  }, []);

  const refreshRegistros = useCallback(async () => {
    if (!eventoId) return;
    try {
      const list = await api.registros(eventoId);
      const set = new Set<string>(list.map((r) => r.cedula));
      cedulasSetRef.current = set;
      setRegistros(list as Registro[]);
      const est = await api.estado(eventoId);
      setDuplicadosBloqueados(est.duplicados_detectados ?? 0);
      setActivos(est.dispositivos_activos ?? 0);
    } catch (e) {
      // ignore
    }
  }, [eventoId]);

  // WS lifecycle
  useEffect(() => {
    if (!eventoId || !token) return;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setWsStatus("connecting");
      try {
        const url = wsUrl(eventoId, token, deviceIdRef.current);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          setWsStatus("online");
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
          setWsStatus("offline");
        };
        ws.onclose = () => {
          if (cancelled) return;
          setWsStatus("offline");
          // retry in 2s
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          reconnectTimer.current = setTimeout(connect, 2000);
        };
      } catch {
        setWsStatus("offline");
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(connect, 2000);
      }
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [eventoId, token, addRegistro]);

  // Offline queue flusher
  const flushQueue = useCallback(async () => {
    const q = (await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [];
    if (!q.length) {
      setQueueSize(0);
      return;
    }
    const remaining: QueueItem[] = [];
    for (const item of q) {
      try {
        await api.escanear(
          {
            cedula: item.cedula,
            evento_id: item.evento_id,
            device_id: item.device_id,
            timestamp: item.timestamp,
            nonce: item.nonce,
            nombre: item.nombre,
            sede: item.sede,
            municipio: item.municipio,
            cargo: item.cargo,
            raw_barcode: item.raw_barcode || "",
            primer_apellido: item.primer_apellido || "",
            segundo_apellido: item.segundo_apellido || "",
            nombres: item.nombres || "",
            genero: item.genero || "",
            fecha_nacimiento: item.fecha_nacimiento || "",
            tipo_sangre: item.tipo_sangre || "",
          },
          item.idempotency_key,
        );
      } catch (err: any) {
        if (err?.status === 409) {
          // already exists, drop
        } else if (item.attempts < 5) {
          remaining.push({ ...item, attempts: item.attempts + 1 });
        }
      }
    }
    await storage.setItem(QUEUE_KEY, remaining);
    setQueueSize(remaining.length);
  }, []);

  useEffect(() => {
    if (wsStatus === "online") {
      flushQueue();
    }
  }, [wsStatus, flushQueue]);

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
    cedulasSetRef.current = new Set();
    setRegistros([]);
    setDuplicadosBloqueados(0);
    setActivos(0);
    setLastDuplicate(null);
    setLastSuccess(null);
    // Load initial
    try {
      const list = await api.registros(id);
      const set = new Set<string>(list.map((r) => r.cedula));
      cedulasSetRef.current = set;
      setRegistros(list as Registro[]);
      const est = await api.estado(id);
      setDuplicadosBloqueados(est.duplicados_detectados ?? 0);
      setActivos(est.dispositivos_activos ?? 0);
    } catch {
      // ignore
    }
  }, []);

  const clearEvento = useCallback(() => {
    setEventoId(null);
    setEventoNombre("");
    setRegistros([]);
    cedulasSetRef.current = new Set();
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
  }, []);

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
        tipo_sangre: (extras as any).tipo_sangre || "",
      };

      try {
        const res = await api.escanear(payload, idempotency_key);
        if (res?.ok && res.registro) {
          addRegistro(res.registro);
          setLastSuccess({ cedula, ts: Date.now() });
          return { ok: true, mensaje: "Registrado correctamente" };
        }
        return { ok: false, mensaje: res?.mensaje || "Error" };
      } catch (err: any) {
        if (err?.status === 409) {
          // Duplicado servidor
          const existing = err?.detail?.registro_existente;
          if (existing) {
            addRegistro(existing as Registro);
          } else {
            cedulasSetRef.current.add(cedula);
          }
          setLastDuplicate({ cedula, ts: Date.now() });
          setDuplicadosBloqueados((n) => n + 1);
          return { ok: false, duplicate: true, mensaje: `Atención: ya registrado: ${cedula}` };
        }
        // Sin conexión -> encolar
        const q = (await storage.getItem<QueueItem[] | null>(QUEUE_KEY, null)) || [];
        q.push({ ...payload, idempotency_key, attempts: 0 });
        await storage.setItem(QUEUE_KEY, q);
        setQueueSize(q.length);
        // Optimistic local add
        addRegistro({
          id: `local_${nonce}`,
          evento_id: eventoId,
          cedula,
          nombre: payload.nombre,
          sede: payload.sede,
          municipio: payload.municipio,
          cargo: payload.cargo,
          device_id,
          operator_email: "(pendiente)",
          timestamp: ts,
          created_at: new Date().toISOString(),
        });
        setLastSuccess({ cedula, ts: Date.now() });
        return { ok: true, mensaje: "En cola (offline). Se sincronizará." };
      }
    },
    [eventoId, addRegistro],
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
        cedulasSet: cedulasSetRef.current,
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
