import { cache } from 'react';

import { ApiError, getCompanies } from './server-api';

export const getWorkspaceCompanies = cache(getCompanies);

export const getWorkspace = cache(async (companyId?: string) => {
  const companies = (await getWorkspaceCompanies()).filter((company) => company.isActive);
  const company = companyId ? companies.find((entry) => entry.id === companyId) : companies[0];
  if (!company) {
    throw new ApiError(
      companyId
        ? 'This workspace does not exist or is inactive.'
        : 'No active business workspace is configured.',
      404,
    );
  }
  return company;
});
