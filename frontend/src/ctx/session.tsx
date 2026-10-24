/**
 * Session context: holds JWT + user. Persists in SecureStore via @/src/utils/storage.
 * Exposes signIn / signOut and isLoading for splash gating.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { api, setToken, clearToken, getToken, setAuthRevokedHandler } from "@/src/utils/api";
import { getDeviceId } from "@/src/utils/device";

type User = { id: string; email: string; nombre: string; role: string };

type SessionContextValue = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string, verificationPin?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getToken();
        if (stored) {
          setTokenState(stored);
          const me = await api.me();
          if (me?.security_version !== 2) throw new Error("El servidor todavía no tiene activada la seguridad nueva. Actualiza el backend antes de usar esta versión.");
          setUser(me);
        }
      } catch {
        await clearToken();
        setTokenState(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setAuthRevokedHandler(() => {
      void clearToken();
      setTokenState(null);
      setUser(null);
    });
    return () => setAuthRevokedHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string, verificationPin = "") => {
    const device_id = await getDeviceId();
    const r = await api.login({ email, password, device_id, verification_pin: verificationPin.trim() });
    if (r.user?.security_version !== 2) {
      throw new Error("El servidor todavía no tiene activada la seguridad nueva. Actualiza el backend antes de usar esta versión.");
    }
    if (r.user?.role === "operator" && r.user?.device_id !== device_id) {
      throw new Error("El servidor no confirmó este dispositivo. No iniciaré sesión hasta verificarlo con el PIN de Admin.");
    }
    await setToken(r.access_token);
    setTokenState(r.access_token);
    setUser(r.user);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, token, isLoading, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be inside SessionProvider");
  return ctx;
}
