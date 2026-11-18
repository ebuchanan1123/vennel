'use client';

import { createContext, useContext, type ReactNode } from 'react';
import {
  hasBusinessPermission,
  type AccountProfile,
  type BusinessPermission,
} from '@lead-recovery/types';
import type { Company } from '../lib/api';

const BusinessAccess = createContext<{ account: AccountProfile; company?: Company } | null>(null);
export function BusinessAccessProvider({
  account,
  company,
  children,
}: {
  account: AccountProfile;
  company?: Company;
  children: ReactNode;
}) {
  return <BusinessAccess.Provider value={{ account, company }}>{children}</BusinessAccess.Provider>;
}
export function useBusinessAccess() {
  const context = useContext(BusinessAccess);
  if (!context)
    throw new Error('Business controls must be rendered inside an authenticated workspace.');
  return {
    ...context,
    can: (permission: BusinessPermission) =>
      Boolean(context.company && hasBusinessPermission(context.company.role, permission)),
  };
}
