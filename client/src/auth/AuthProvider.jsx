import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_BASE } from "../lib/session";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/api/auth/me`, { withCredentials: true });
      setSession(data);
      return data;
    } catch {
      setSession(null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    axios
      .get(`${API_BASE}/api/auth/me`, { withCredentials: true })
      .then(({ data }) => {
        if (!ignore) setSession(data);
      })
      .catch(() => {
        if (!ignore) setSession(null);
      })
      .finally(() => {
        if (!ignore) setReady(true);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const value = useMemo(() => ({ session, ready, refresh, setSession }), [session, ready, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) return { session: null, ready: true, refresh: async () => null, setSession: () => {} };
  return context;
}
