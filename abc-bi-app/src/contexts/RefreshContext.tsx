import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface RefreshContextValue {
  refreshToken: number;
  triggerRefresh: () => void;
}

const RefreshContext = createContext<RefreshContextValue | null>(null);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshToken((t) => t + 1), []);
  return (
    <RefreshContext.Provider value={{ refreshToken, triggerRefresh }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefreshContext(): RefreshContextValue {
  const ctx = useContext(RefreshContext);
  if (ctx == null) throw new Error('useRefreshContext must be used within RefreshProvider');
  return ctx;
}
