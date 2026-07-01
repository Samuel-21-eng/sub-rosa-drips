import React, { createContext, useContext, useRef, ReactNode } from 'react';

export interface SubRosaConfig {
  rpcUrl: string;
  networkPassphrase: string;
}

interface SubRosaContextValue {
  config: SubRosaConfig;
  requestCache: React.MutableRefObject<Map<string, Promise<any>>>;
}

const SubRosaContext = createContext<SubRosaContextValue | undefined>(undefined);

export function SubRosaProvider({
  config,
  children,
}: {
  config: SubRosaConfig;
  children: ReactNode;
}) {
  const requestCache = useRef(new Map<string, Promise<any>>());

  return (
    <SubRosaContext.Provider value={{ config, requestCache }}>
      {children}
    </SubRosaContext.Provider>
  );
}

export function useSubRosa() {
  const context = useContext(SubRosaContext);
  if (!context) {
    throw new Error('useSubRosa must be used within a SubRosaProvider');
  }
  return context;
}
