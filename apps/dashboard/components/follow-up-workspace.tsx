'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import {
  FOLLOW_UP_TYPES,
  businessLocalInput,
  businessLocalToUtc,
  followUpBucket,
  formatBusinessTime,
  type FollowUpType,
} from '@lead-recovery/types';

import {
  acceptFollowUpSuggestion,
  changeFollowUpStatus,
  dismissFollowUpSuggestion,
  errorMessage,
  saveFollowUp,
  type CustomerRecord,
  type FollowUpTask,
  type FollowUpSuggestion,
  type Lead,
  type WorkspaceSettings,
  type TeamMember,
} from '../lib/api';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';
import { EmptyState, Field, FormError, PageHeader, SearchInput } from './ui';
import { useBusinessAccess } from './business-access';

export const followUpLabels: Record<FollowUpType, string> = {
  CALL_CUSTOMER: 'Call customer',
  SEND_ESTIMATE: 'Send estimate',
  CONFIRM_APPOINTMENT: 'Confirm appointment',
  REQUEST_INFORMATION: 'Request missing information',
  FOLLOW_UP_QUOTE: 'Follow up on quote',
  PREPARE_INVOICE: 'Prepare invoice',
  CUSTOM: 'Custom task',
};

function FollowUpForm({
  companyId,
  customers,
  leads,
  settings,
  task,
  suggestion,
  initialCustomerId,
  callNoteId,
  onSaved,
  onCancel,
  members,
}: {
  companyId: string;
  customers: CustomerRecord[];
  leads: Lead[];
  settings: Pick<WorkspaceSettings, 'now' | 'timeZone'>;
  task?: FollowUpTask;
  suggestion?: FollowUpSuggestion;
  initialCustomerId?: string;
  callNoteId?: string;
  onSaved: (task: FollowUpTask) => void;
  onCancel: () => void;
  members: TeamMember[];
}) {
  const [customerId, setCustomerId] = useState(
    task?.customerId ?? suggestion?.customerId ?? initialCustomerId ?? '',
  );
  const [leadId, setLeadId] = useState(task?.leadId ?? suggestion?.leadId ?? '');
  const [type, setType] = useState<FollowUpType>(task?.type ?? suggestion?.type ?? 'CALL_CUSTOMER');
  const [title, setTitle] = useState(task?.title ?? suggestion?.title ?? 'Call customer');
  const [dueTime, setDueTime] = useState(
    task?.dueAt
      ? businessLocalInput(task.dueAt, settings.timeZone)
      : suggestion?.dueAt
        ? businessLocalInput(suggestion.dueAt, settings.timeZone)
        : '',
  );
  const [priority, setPriority] = useState<FollowUpTask['priority']>(
    task?.priority ?? suggestion?.priority ?? 'NORMAL',
  );
  const [notes, setNotes] = useState(task?.notes ?? suggestion?.evidence ?? '');
  const [assignedUserId, setAssignedUserId] = useState(task?.assignedUserId ?? '');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    startTransition(async () => {
      try {
        const input = {
          customerId,
          leadId: leadId || null,
          callNoteId: task?.callNoteId ?? suggestion?.callNoteId ?? callNoteId ?? null,
          type,
          title,
          dueAt: businessLocalToUtc(dueTime, settings.timeZone),
          priority,
          notes: notes || null,
          assignedUserId: assignedUserId || null,
        };
        const saved = suggestion
          ? await acceptFollowUpSuggestion(companyId, suggestion.id, input)
          : await saveFollowUp(companyId, input, task);
        onSaved(saved);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  return (
    <form className="panel p-5" onSubmit={submit}>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {suggestion ? 'Review suggested follow-up' : task ? 'Edit follow-up' : 'New follow-up'}
        </h2>
        <button
          type="button"
          className="btn-icon"
          disabled={pending}
          onClick={onCancel}
          aria-label="Close follow-up form"
        >
          <Icon name="close" width={17} height={17} />
        </button>
      </div>
      <fieldset className="space-y-4" disabled={pending}>
        <Field label="Customer">
          <select
            className="field"
            required
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">Choose a customer</option>
            {customers
              .filter((customer) => !customer.isArchived || customer.id === task?.customerId)
              .map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
          </select>
        </Field>
        {!suggestion && (
          <Field label="Associated lead (optional)">
            <select
              className="field"
              value={leadId}
              onChange={(event) => setLeadId(event.target.value)}
            >
              <option value="">No associated lead</option>
              {leads
                .filter((lead) => !customerId || !lead.customerId || lead.customerId === customerId)
                .map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.customer?.name ?? lead.phone} /{' '}
                    {lead.serviceType ?? lead.projectType ?? 'Inquiry'}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Task type">
          <select
            className="field"
            disabled={Boolean(suggestion)}
            value={type}
            onChange={(event) => {
              const selected = FOLLOW_UP_TYPES.find((value) => value === event.target.value);
              if (selected) {
                setType(selected);
                setTitle(followUpLabels[selected]);
              }
            }}
          >
            {FOLLOW_UP_TYPES.map((value) => (
              <option key={value} value={value}>
                {followUpLabels[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Task title">
          <input
            className="field"
            required
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field
          label="Due date & time"
          hint={
            suggestion?.dueText ? `${suggestion.dueText} / ${settings.timeZone}` : settings.timeZone
          }
        >
          <input
            className="field"
            required
            type="datetime-local"
            value={dueTime}
            onChange={(event) => setDueTime(event.target.value)}
          />
        </Field>
        <Field label="Priority">
          <select
            className="field"
            value={priority}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'LOW' || value === 'NORMAL' || value === 'HIGH') setPriority(value);
            }}
          >
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
          </select>
        </Field>
        <Field label="Notes">
          <textarea
            className="field min-h-24"
            maxLength={3000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <Field label="Assigned team member">
          <select
            className="field"
            value={assignedUserId}
            onChange={(event) => setAssignedUserId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name} / {member.role.toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <FormError message={error} />
        <button type="submit" className="btn-primary w-full">
          {pending ? 'Saving...' : suggestion ? 'Confirm & create task' : 'Save follow-up'}
        </button>
        <p className="text-[11px] text-steel">
          A task does not confirm a booking, send a customer message, or mark work completed.
        </p>
      </fieldset>
    </form>
  );
}

export function FollowUpWorkspace({
  companyId,
  initialTasks,
  initialSuggestions,
  customers,
  leads,
  settings,
  initialCustomerId,
  callNoteId,
  members,
}: {
  companyId: string;
  initialTasks: FollowUpTask[];
  initialSuggestions: FollowUpSuggestion[];
  customers: CustomerRecord[];
  leads: Lead[];
  settings: Pick<WorkspaceSettings, 'now' | 'timeZone'>;
  initialCustomerId?: string;
  callNoteId?: string;
  members: TeamMember[];
}) {
  const { can, account } = useBusinessAccess();
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [view, setView] = useState('all');
  const [priority, setPriority] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{
    task?: FollowUpTask;
    suggestion?: FollowUpSuggestion;
  } | null>(initialCustomerId ? {} : null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, startTransition] = useTransition();
  const search = query.trim().toLowerCase();
  const visible = tasks.filter((task) => {
    const bucket =
      task.status === 'COMPLETED'
        ? 'completed'
        : task.status === 'CANCELLED'
          ? 'cancelled'
          : followUpBucket(task.dueAt, settings.timeZone, settings.now);
    return (
      (view === 'all' ? task.status === 'PENDING' : view === bucket) &&
      (priority === 'all' || task.priority === priority) &&
      (assignee === 'all' ||
        (assignee === 'me'
          ? task.assignedUserId === account.id
          : assignee === 'unassigned'
            ? !task.assignedUserId
            : task.assignedUserId === assignee)) &&
      (!initialCustomerId || task.customerId === initialCustomerId) &&
      [task.title, task.notes, task.customer.name].some((value) =>
        value?.toLowerCase().includes(search),
      )
    );
  });
  function saved(task: FollowUpTask) {
    setTasks((current) => [task, ...current.filter((entry) => entry.id !== task.id)]);
    if (editing?.suggestion)
      setSuggestions((current) => current.filter((entry) => entry.id !== editing.suggestion?.id));
    setEditing(null);
    setNotice('Follow-up saved. No customer message or booking was triggered.');
    router.refresh();
  }
  function status(task: FollowUpTask, next: FollowUpTask['status']) {
    setError('');
    startTransition(async () => {
      try {
        saved(await changeFollowUpStatus(companyId, task, next));
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Keep callbacks, quotes, and job administration moving. All dates use your business time zone."
        actions={
          <button className="btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" width={16} height={16} />
            New follow-up
          </button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-steel">
          Business time zone: <strong>{settings.timeZone}</strong>
        </p>
        {can('SETTINGS') && (
          <Link
            className="text-xs font-medium text-ember"
            href={workspaceHref('/settings', companyId)}
          >
            Notifications &amp; time zone
          </Link>
        )}
      </div>
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">
          {notice}
        </p>
      )}
      <FormError message={error} />
      <div
        className={`grid items-start gap-6 ${editing ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}
      >
        <section className="min-w-0 space-y-5">
          <nav aria-label="Follow-up views" className="flex flex-wrap gap-1">
            {[
              ['all', 'All pending'],
              ['overdue', 'Overdue'],
              ['today', 'Due today'],
              ['upcoming', 'Upcoming'],
              ['completed', 'Completed'],
              ['cancelled', 'Cancelled'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`tab ${view === value ? 'tab-active' : ''}`}
                aria-pressed={view === value}
                onClick={() => setView(value ?? 'all')}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <SearchInput placeholder="Search follow-ups..." value={query} onChange={setQuery} />
            <select
              className="field sm:max-w-40"
              aria-label="Filter follow-up priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option value="all">All priorities</option>
              <option value="HIGH">High priority</option>
              <option value="NORMAL">Normal priority</option>
              <option value="LOW">Low priority</option>
            </select>
            <select
              className="field sm:max-w-44"
              aria-label="Filter follow-up assignee"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="all">All team members</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="panel overflow-hidden">
            {visible.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="Nothing in this follow-up view"
                description="Create a task manually or confirm an AI suggestion after reviewing a call note."
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {visible.map((task) => (
                  <article
                    className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between"
                    key={task.id}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold">{task.title}</h2>
                        <span
                          className={`rounded px-2 py-1 text-[10px] ${task.priority === 'HIGH' ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-steel'}`}
                        >
                          {task.priority.toLowerCase()}
                        </span>
                      </div>
                      <Link
                        className="mt-2 block text-xs font-medium text-ember"
                        href={workspaceHref(`/customers/${task.customerId}`, companyId)}
                      >
                        {task.customer.name}
                      </Link>
                      <p className="mt-2 text-xs text-steel">
                        {formatBusinessTime(task.dueAt, settings.timeZone)}
                      </p>
                      {task.notes && (
                        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-steel">
                          {task.notes}
                        </p>
                      )}
                      <p className="mt-2 text-[10px] text-slate-400">
                        {followUpLabels[task.type]} &middot;{' '}
                        {task.assignedUser?.name ?? 'Unassigned'} &middot;{' '}
                        {task.source.toLowerCase()} &middot; {task.status.toLowerCase()}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {task.status === 'PENDING' && (
                        <button
                          className="btn-secondary min-h-8 px-3 py-2 text-xs"
                          disabled={pending}
                          onClick={() => status(task, 'COMPLETED')}
                        >
                          <Icon name="check" width={14} height={14} />
                          Complete
                        </button>
                      )}
                      {task.status !== 'PENDING' && (
                        <button
                          className="btn-secondary min-h-8 px-3 py-2 text-xs"
                          disabled={pending}
                          onClick={() => status(task, 'PENDING')}
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        className="btn-icon"
                        aria-label={`Edit ${task.title}`}
                        onClick={() => setEditing({ task })}
                        disabled={pending}
                      >
                        <Icon name="edit" width={15} height={15} />
                      </button>
                      {task.status === 'PENDING' && (
                        <button
                          className="btn-icon"
                          aria-label={`Cancel ${task.title}`}
                          disabled={pending}
                          onClick={() => status(task, 'CANCELLED')}
                        >
                          <Icon name="close" width={15} height={15} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Suggestions awaiting confirmation</h2>
            <p className="mt-2 text-xs leading-relaxed text-steel">
              Suggestions are not tasks until you confirm the customer and due time.
            </p>
            {suggestions.length === 0 ? (
              <p className="mt-5 text-xs text-steel">
                Reviewed call notes and meaningful lead milestones can generate suggestions here.
              </p>
            ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {suggestions
                  .filter(
                    (suggestion) =>
                      !initialCustomerId || suggestion.customerId === initialCustomerId,
                  )
                  .map((suggestion) => (
                    <article className="rounded-lg border border-slate-100 p-4" key={suggestion.id}>
                      <p className="text-xs font-semibold">{suggestion.title}</p>
                      <p className="mt-2 text-[11px] text-steel">
                        {suggestion.customer?.name ?? 'Choose a customer during review'} &middot;{' '}
                        {suggestion.dueText ??
                          (suggestion.dueAt
                            ? formatBusinessTime(suggestion.dueAt, settings.timeZone)
                            : 'Due time not specified')}
                      </p>
                      {suggestion.evidence && (
                        <blockquote className="mt-2 text-[11px] leading-relaxed text-steel">
                          &ldquo;{suggestion.evidence}&rdquo;
                        </blockquote>
                      )}
                      <div className="mt-4 flex gap-2">
                        <button
                          className="btn-secondary min-h-8 px-3 py-2 text-xs"
                          onClick={() => setEditing({ suggestion })}
                        >
                          Review suggestion
                        </button>
                        <button
                          className="text-xs text-steel"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              try {
                                await dismissFollowUpSuggestion(companyId, suggestion.id);
                                setSuggestions((current) =>
                                  current.filter((entry) => entry.id !== suggestion.id),
                                );
                              } catch (cause) {
                                setError(errorMessage(cause));
                              }
                            })
                          }
                        >
                          Dismiss
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </section>
        </section>
        {editing && (
          <aside className="order-first xl:order-last">
            <FollowUpForm
              key={editing.task?.id ?? editing.suggestion?.id ?? 'new'}
              companyId={companyId}
              customers={customers}
              leads={leads}
              settings={settings}
              task={editing.task}
              suggestion={editing.suggestion}
              initialCustomerId={initialCustomerId}
              callNoteId={callNoteId}
              onSaved={saved}
              onCancel={() => setEditing(null)}
              members={members}
            />
          </aside>
        )}
      </div>
    </>
  );
}
