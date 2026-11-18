'use client';
import { createAuthClient } from 'better-auth/react';
export const authClient = createAuthClient({ basePath: '/api/auth' });

export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return '/';
  return value;
}
