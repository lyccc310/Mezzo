import React, { createContext, useState, useEffect, useCallback } from 'react';
import {
  login as cognitoLogin,
  logout as cognitoLogout,
  getCurrentUser,
  getAccessToken,
} from './authService';
import { AUTH_ENABLED } from './cognitoConfig';
import type { UserInfo } from './authService';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: UserInfo | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  getToken: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthState>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  login: async () => {},
  logout: () => {},
  getToken: async () => null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(!AUTH_ENABLED);
  const [isLoading, setIsLoading] = useState(AUTH_ENABLED);
  const [user, setUser] = useState<UserInfo | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    if (!AUTH_ENABLED) {
      setIsAuthenticated(true);
      setIsLoading(false);
      return;
    }

    getCurrentUser()
      .then((u) => {
        if (u) {
          setUser(u);
          setIsAuthenticated(true);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await cognitoLogin(username, password);
    const u = await getCurrentUser();
    setUser(u);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    cognitoLogout();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const getToken = useCallback(async () => {
    return getAccessToken();
  }, []);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, isLoading, user, login, logout, getToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}
