import type { AccountProfile, BusinessRole } from '@lead-recovery/types';

declare global {
  namespace Express {
    interface Request {
      account?: AccountProfile;
      businessAccess?: { companyId: string; role: BusinessRole };
    }
  }
}
export {};
