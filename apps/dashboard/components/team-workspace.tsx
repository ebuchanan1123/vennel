'use client';

import { useState, useTransition, type FormEvent } from 'react';
import {
  changeMember,
  createInvitation,
  errorMessage,
  getTeam,
  revokeInvitation,
  type BusinessRole,
  type TeamWorkspace as TeamData,
} from '../lib/api';
import { useBusinessAccess } from './business-access';
import { Icon } from './icon';
import { Field, FormError, PageHeader } from './ui';
import { useClientReady } from '../lib/use-client-ready';

export function TeamWorkspace({
  companyId,
  initialTeam,
}: {
  companyId: string;
  initialTeam: TeamData;
}) {
  const ready = useClientReady();
  const { account } = useBusinessAccess();
  const [team, setTeam] = useState(initialTeam);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<BusinessRole>('STAFF');
  const [inviteURL, setInviteURL] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, startTransition] = useTransition();
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    startTransition(async () => {
      try {
        const invitation = await createInvitation(companyId, email, role);
        setInviteURL(invitation.inviteURL);
        setTeam(await getTeam(companyId));
        setEmail('');
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  return (
    <>
      <PageHeader
        title="Team & access"
        description="Invite verified accounts into this business only. Staff handle operations and drafts; owners control pricing, final approvals, delivery, integrations, and team access."
        actions={
          <button
            className="btn-secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError('');
                try {
                  setTeam(await getTeam(companyId));
                } catch (cause) {
                  setError(errorMessage(cause));
                }
              })
            }
          >
            Refresh team
          </button>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel divide-y divide-slate-100">
          {team.members.map((member) => (
            <article
              className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"
              key={member.id}
            >
              <div>
                <h2 className="text-sm font-semibold">
                  {member.name}
                  {member.userId === account.id ? ' (you)' : ''}
                </h2>
                <p className="mt-1 text-xs text-steel">{member.email}</p>
                <p className="mt-1 text-[10px] text-steel">{member.role.toLowerCase()}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-secondary min-h-8 px-3 py-2 text-xs"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError('');
                      try {
                        await changeMember(
                          companyId,
                          member.id,
                          member.role === 'OWNER' ? 'STAFF' : 'OWNER',
                        );
                        if (member.userId === account.id) {
                          globalThis.location.assign('/');
                          return;
                        }
                        setTeam(await getTeam(companyId));
                        setNotice('Business role updated.');
                      } catch (cause) {
                        setError(errorMessage(cause));
                      }
                    })
                  }
                >
                  {member.role === 'OWNER' ? 'Make staff' : 'Make owner'}
                </button>
                <button
                  className="btn-icon text-rose-600"
                  aria-label={`Remove ${member.name}`}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError('');
                      try {
                        await changeMember(companyId, member.id, null);
                        if (member.userId === account.id) {
                          globalThis.location.assign('/');
                          return;
                        }
                        setTeam(await getTeam(companyId));
                        setNotice('Member removed. New requests are denied immediately.');
                      } catch (cause) {
                        setError(errorMessage(cause));
                      }
                    })
                  }
                >
                  <Icon name="close" width={16} height={16} />
                </button>
              </div>
            </article>
          ))}
        </section>
        <aside>
          <form className="panel space-y-4 p-5" onSubmit={invite}>
            <h2 className="text-sm font-semibold">Invite a team member</h2>
            <fieldset disabled={pending || !ready} className="space-y-4">
              <Field label="Invited email address">
                <input
                  className="field"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field label="Business role">
                <select
                  className="field"
                  value={role}
                  onChange={(event) => {
                    if (event.target.value === 'OWNER' || event.target.value === 'STAFF')
                      setRole(event.target.value);
                  }}
                >
                  <option value="STAFF">Staff / operations & drafts</option>
                  <option value="OWNER">Owner / business administration</option>
                </select>
              </Field>
              <button className="btn-primary w-full" type="submit">
                {pending ? 'Creating...' : 'Create invitation link'}
              </button>
            </fieldset>
            <p className="text-[11px] leading-relaxed text-steel">
              The link expires in seven days. Only the exact invited, verified email can accept it.
              Share it privately; creating a link does not send an email automatically.
            </p>
            {inviteURL && (
              <div className="rounded-lg bg-indigo-50 p-3">
                <label className="block text-xs font-medium text-indigo-900">
                  Private invitation link
                  <input
                    className="field mt-2 text-xs"
                    readOnly
                    value={inviteURL}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <p className="mt-2 text-[10px] text-steel">
                  Copy and share this link directly with the intended person. Its token is not
                  stored in plain text.
                </p>
              </div>
            )}
          </form>
        </aside>
      </div>
      <div className="mt-5">
        <FormError message={error} />
        {notice && (
          <p role="status" className="mt-3 text-xs text-emerald-700">
            {notice}
          </p>
        )}
      </div>
      <section className="panel mt-6 p-5">
        <h2 className="text-sm font-semibold">Invitation history</h2>
        <div className="mt-4 space-y-3">
          {team.invitations.length === 0 ? (
            <p className="text-xs text-steel">No invitations for this business yet.</p>
          ) : (
            team.invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"
              >
                <div>
                  <p className="text-xs font-medium">
                    {invitation.email} / {invitation.role.toLowerCase()}
                  </p>
                  <p className="mt-1 text-[10px] text-steel">
                    {invitation.acceptedAt
                      ? 'Accepted'
                      : invitation.revokedAt
                        ? 'Revoked'
                        : `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
                  </p>
                </div>
                {!invitation.acceptedAt && !invitation.revokedAt && (
                  <button
                    className="text-xs font-medium text-rose-600"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await revokeInvitation(companyId, invitation.id);
                          setTeam(await getTeam(companyId));
                        } catch (cause) {
                          setError(errorMessage(cause));
                        }
                      })
                    }
                  >
                    Revoke invitation
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
