import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  api,
  TOKEN_KEY,
  USER_KEY,
  clearStoredAuth,
  getTokenExpiryMs,
  isTokenExpired
} from '../api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const expiryTimerRef = useRef(null);

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  }, []);

  const setSession = useCallback((token, userData) => {
    clearExpiryTimer();
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    setUser(userData);

    const expiryMs = getTokenExpiryMs(token);
    if (!expiryMs) {
      clearStoredAuth();
      setUser(null);
      return;
    }

    const delay = expiryMs - Date.now();
    if (delay <= 0) {
      clearStoredAuth();
      setUser(null);
      return;
    }

    expiryTimerRef.current = setTimeout(() => {
      clearStoredAuth();
      setUser(null);
    }, delay);
  }, [clearExpiryTimer]);

  useEffect(() => {
    const handleAuthExpired = () => {
      clearExpiryTimer();
      clearStoredAuth();
      setUser(null);
    };

    window.addEventListener('digizap:auth-expired', handleAuthExpired);

    const token = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);
    if (token && storedUser && !isTokenExpired(token)) {
      try {
        setUser(JSON.parse(storedUser));
        api.defaults.headers.common.Authorization = `Bearer ${token}`;

        const expiryMs = getTokenExpiryMs(token);
        if (expiryMs) {
          const delay = expiryMs - Date.now();
          if (delay > 0) {
            expiryTimerRef.current = setTimeout(() => {
              clearStoredAuth();
              setUser(null);
            }, delay);
          }
        }
      } catch (err) {
        clearStoredAuth();
        setUser(null);
      }
    } else {
      clearStoredAuth();
      setUser(null);
    }

    setLoading(false);
    return () => {
      clearExpiryTimer();
      window.removeEventListener('digizap:auth-expired', handleAuthExpired);
    };
  }, [clearExpiryTimer]);

  const login = useCallback((token, userData) => {
    setSession(token, userData);
  }, [setSession]);

  const logout = useCallback(() => {
    clearExpiryTimer();
    clearStoredAuth();
    setUser(null);
  }, [clearExpiryTimer]);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
