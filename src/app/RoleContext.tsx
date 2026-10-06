import { createContext, ReactNode, useContext, useState } from 'react';

export type Role = 'customer' | 'mechanic';

type RoleContextValue = {
  role: Role;
  setRole: (role: Role) => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  // Defaults to customer until login/onboarding sets it.
  const [role, setRole] = useState<Role>('customer');

  return (
    <RoleContext.Provider value={{ role, setRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error('useRole must be used inside RoleProvider');
  }
  return ctx;
}
