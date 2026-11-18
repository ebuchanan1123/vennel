import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@lead-recovery/database';
import type { AccountProfile, BusinessRole, TeamMember, TeamWorkspace } from '@lead-recovery/types';
import type { Prisma } from '@prisma/client';

import { env } from '../env.js';
import { HttpError } from '../middleware/error-handler.js';

const memberInclude = {
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.BusinessMembershipInclude;
function serializeMember(
  member: Prisma.BusinessMembershipGetPayload<{ include: typeof memberInclude }>,
): TeamMember {
  return {
    id: member.id,
    userId: member.userId,
    role: member.role,
    name: member.user.name,
    email: member.user.email,
    createdAt: member.createdAt.toISOString(),
  };
}
export async function listMemberCompanies(userId: string) {
  const memberships = await prisma.businessMembership.findMany({
    where: { userId, company: { isActive: true } },
    include: { company: true },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map(({ company, role }) => {
    const { createRequestKey, ...record } = company;
    void createRequestKey;
    return { ...record, role, defaultTaxRate: Number(record.defaultTaxRate) };
  });
}
export async function listMembers(companyId: string): Promise<TeamMember[]> {
  return (
    await prisma.businessMembership.findMany({
      where: { companyId },
      include: memberInclude,
      orderBy: { createdAt: 'asc' },
    })
  ).map(serializeMember);
}
export async function getTeam(companyId: string): Promise<TeamWorkspace> {
  const [members, invitations] = await Promise.all([
    listMembers(companyId),
    prisma.businessInvitation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);
  return {
    members,
    invitations: invitations.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: invite.acceptedAt?.toISOString() ?? null,
      revokedAt: invite.revokedAt?.toISOString() ?? null,
    })),
  };
}
async function lockOwner(
  db: Prisma.TransactionClient,
  companyId: string,
  userId: string,
): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
  const actor = await db.businessMembership.findFirst({
    where: { companyId, userId, role: 'OWNER', company: { isActive: true } },
  });
  if (!actor) throw new HttpError(403, 'An active business owner must authorize team changes.');
}
export async function createInvitation(
  companyId: string,
  actorId: string,
  email: string,
  role: BusinessRole,
) {
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, companyId, actorId);
    const existing = await tx.businessMembership.findFirst({
      where: { companyId, user: { email } },
    });
    if (existing) throw new HttpError(409, 'This account is already a business member.');
    await tx.businessInvitation.updateMany({
      where: { companyId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const token = randomBytes(32).toString('base64url');
    const invitation = await tx.businessInvitation.create({
      data: {
        companyId,
        email,
        role,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        invitedBy: actorId,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    await tx.businessMembershipAudit.create({
      data: {
        companyId,
        actorId,
        action: 'INVITED',
        details: { invitationId: invitation.id, email, role },
      },
    });
    const url = new URL('/invite', env.DASHBOARD_BASE_URL);
    url.searchParams.set('token', token);
    return {
      id: invitation.id,
      email,
      role,
      expiresAt: invitation.expiresAt.toISOString(),
      inviteURL: url.toString(),
    };
  });
}
export async function acceptInvitation(user: AccountProfile, token: string) {
  if (!user.emailVerified)
    throw new HttpError(403, 'Verify your email address before accepting a business invitation.');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.businessInvitation.findUnique({
      where: { tokenHash },
      include: { company: { select: { isActive: true } } },
    });
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= Date.now() ||
      !invitation.company.isActive
    )
      throw new HttpError(404, 'This invitation is invalid, revoked, or expired.');
    if (invitation.email !== user.email.toLowerCase())
      throw new HttpError(
        403,
        'Sign in with the verified email address this invitation was issued to.',
      );
    if (invitation.acceptedAt) {
      if (
        invitation.acceptedBy === user.id &&
        (await tx.businessMembership.findUnique({
          where: { companyId_userId: { companyId: invitation.companyId, userId: user.id } },
        }))
      )
        return { companyId: invitation.companyId };
      throw new HttpError(409, 'This invitation was already used.');
    }
    const changed = await tx.businessInvitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { acceptedAt: new Date(), acceptedBy: user.id },
    });
    if (!changed.count) throw new HttpError(409, 'This invitation changed while being accepted.');
    const existing = await tx.businessMembership.findUnique({
      where: { companyId_userId: { companyId: invitation.companyId, userId: user.id } },
    });
    if (!existing)
      await tx.businessMembership.create({
        data: { companyId: invitation.companyId, userId: user.id, role: invitation.role },
      });
    await tx.businessMembershipAudit.create({
      data: {
        companyId: invitation.companyId,
        actorId: user.id,
        action: 'INVITATION_ACCEPTED',
        details: { invitationId: invitation.id, role: existing?.role ?? invitation.role },
      },
    });
    return { companyId: invitation.companyId };
  });
}
export async function revokeInvitation(
  companyId: string,
  actorId: string,
  id: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockOwner(tx, companyId, actorId);
    const changed = await tx.businessInvitation.updateMany({
      where: { id, companyId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!changed.count) throw new HttpError(404, 'Pending invitation not found.');
    await tx.businessMembershipAudit.create({
      data: { companyId, actorId, action: 'INVITATION_REVOKED', details: { invitationId: id } },
    });
  });
}
export async function changeMember(
  companyId: string,
  actorId: string,
  membershipId: string,
  role: BusinessRole | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockOwner(tx, companyId, actorId);
    const target = await tx.businessMembership.findFirst({
      where: { id: membershipId, companyId },
    });
    if (!target) throw new HttpError(404, 'Business member not found.');
    if (
      target.role === 'OWNER' &&
      role !== 'OWNER' &&
      (await tx.businessMembership.count({ where: { companyId, role: 'OWNER' } })) <= 1
    ) {
      throw new HttpError(409, 'A business must retain at least one owner.');
    }
    if (role) await tx.businessMembership.update({ where: { id: target.id }, data: { role } });
    else {
      await tx.followUpTask.updateMany({
        where: { companyId, assignedUserId: target.userId },
        data: { assignedUserId: null },
      });
      await tx.businessMembership.delete({ where: { id: target.id } });
    }
    await tx.businessMembershipAudit.create({
      data: {
        companyId,
        actorId,
        action: role ? 'ROLE_CHANGED' : 'MEMBER_REMOVED',
        details: { userId: target.userId, previousRole: target.role, role },
      },
    });
  });
}
