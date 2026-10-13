/**
 * Session context: holds JWT + user. Persists in SecureStore via @/src/utils/storage.
 * Exposes signIn / signUp / signOut and isLoading for splash gating.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { api, setToken, clearToken, getToken } from "@/src/utils/api";

type User = { id: string; email: string; nombre: string; role: string };

type SessionContextValue = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, nombre: string) => Promise<void>;
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

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api.login({ email, password });
    await setToken(r.access_token);
    setTokenState(r.access_token);
    setUser(r.user);
  }, []);

  const signUp = useCallback(async (email: string, password: string, nombre: string) => {
    const r = await api.register({ email, password, nombre });
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
    <SessionContext.Provider value={{ user, token, isLoading, signIn, signUp, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be inside SessionProvider");
  return ctx;
}
