import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createApi } from './api';

export { ApiError, errorMessage } from './api';
export type { Company, Lead, LeadDetail, CustomerDetail } from './api';

export const getServerApi = cache(async () => createApi((await cookies()).toString()));
export async function getAccount() {
  return (await getServerApi()).getAccount();
}
export async function getCompanies() {
  return (await getServerApi()).getCompanies();
}
export async function getLeads(filters: Parameters<ReturnType<typeof createApi>['getLeads']>[0]) {
  return (await getServerApi()).getLeads(filters);
}
export async function getLeadDetail(id: string, companyId?: string) {
  return (await getServerApi()).getLeadDetail(id, companyId);
}
export async function getDashboardStats(companyId: string) {
  return (await getServerApi()).getDashboardStats(companyId);
}
export async function getCustomers(companyId: string) {
  return (await getServerApi()).getCustomers(companyId);
}
export async function getCustomer(companyId: string, id: string) {
  return (await getServerApi()).getCustomer(companyId, id);
}
export async function getServices(companyId: string) {
  return (await getServerApi()).getServices(companyId);
}
export async function getDocuments(companyId: string) {
  return (await getServerApi()).getDocuments(companyId);
}
export async function getDocument(companyId: string, id: string) {
  return (await getServerApi()).getDocument(companyId, id);
}
export async function getCallNotes(companyId: string) {
  return (await getServerApi()).getCallNotes(companyId);
}
export async function getCallNote(companyId: string, id: string) {
  return (await getServerApi()).getCallNote(companyId, id);
}
export async function getFollowUps(companyId: string) {
  return (await getServerApi()).getFollowUps(companyId);
}
export async function getFollowUpSuggestions(companyId: string) {
  return (await getServerApi()).getFollowUpSuggestions(companyId);
}
export async function getWorkflowClock(companyId: string) {
  return (await getServerApi()).getWorkflowClock(companyId);
}
export async function getWorkspaceSettings(companyId: string) {
  return (await getServerApi()).getWorkspaceSettings(companyId);
}
export async function getBackgroundJobs(companyId: string) {
  return (await getServerApi()).getBackgroundJobs(companyId);
}
export async function getMembers(companyId: string) {
  return (await getServerApi()).getMembers(companyId);
}
export async function getTeam(companyId: string) {
  return (await getServerApi()).getTeam(companyId);
}
export async function getOnboarding(companyId: string) {
  return (await getServerApi()).getOnboarding(companyId);
}
