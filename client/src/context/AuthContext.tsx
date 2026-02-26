import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useLocation } from 'wouter';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { username: string; name: string } | null;
  login: (username: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const VALID_CREDENTIALS = {
  username: 'admin',
  password: 'Apmc@2026'
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<{ username: string; name: string } | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const storedAuth = localStorage.getItem('gapmc_auth');
    if (storedAuth === 'true') {
      setIsAuthenticated(true);
      setUser({ username: 'admin', name: 'Super Admin' });
    }
    setIsLoading(false);
  }, []);

  const login = (username: string, password: string): boolean => {
    if (username === VALID_CREDENTIALS.username && password === VALID_CREDENTIALS.password) {
      localStorage.setItem('gapmc_auth', 'true');
      setIsAuthenticated(true);
      setUser({ username: 'admin', name: 'Super Admin' });
      return true;
    }
    return false;
  };

  const logout = () => {
    localStorage.removeItem('gapmc_auth');
    setIsAuthenticated(false);
    setUser(null);
    setLocation('/');
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
