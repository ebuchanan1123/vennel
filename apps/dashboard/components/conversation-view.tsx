import type { SmsDeliveryRecord } from '@lead-recovery/types';

import { Icon } from './icon';
import { SmsDeliveryActions } from './sms-delivery-actions';

type ConversationMessage = {
  id: string;
  direction: string;
  body: string;
  createdAt: string;
  smsDelivery?: SmsDeliveryRecord | null;
};

const deliveryLabels: Record<SmsDeliveryRecord['status'], string> = {
  PENDING: 'Pending send',
  SENDING: 'Submitting to provider',
  ACCEPTED: 'Provider accepted - delivery not confirmed',
  SENT: 'Sent by provider - delivery not confirmed',
  DELIVERED: 'Delivered',
  FAILED: 'Delivery failed - needs attention',
  UNKNOWN: 'Provider outcome unknown - needs review',
};

export function ConversationView({
  messages,
  companyId,
  canManageSms = false,
}: {
  messages: ConversationMessage[];
  companyId?: string;
  canManageSms?: boolean;
}) {
  return (
    <section className="panel flex flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-ink">Conversation</h2>
          <p className="mt-1 text-xs text-steel">Complete SMS history for this opportunity</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-[10px] text-steel">
          <Icon name="leads" width={13} height={13} />
          SMS
        </span>
      </div>

      {messages.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-steel">
          No messages have been recorded yet.
        </p>
      ) : (
        <div className="max-h-[640px] min-h-[300px] space-y-5 overflow-y-auto bg-slate-50/30 px-5 py-6 sm:px-6">
          {messages.map((message) => {
            const inbound = message.direction === 'INBOUND';

            return (
              <div
                key={message.id}
                className={`max-w-[90%] rounded-2xl px-4 py-3.5 text-sm sm:max-w-[80%] ${
                  inbound
                    ? 'rounded-tl-md border border-slate-200/80 bg-white text-ink shadow-card'
                    : 'ml-auto rounded-tr-md bg-indigo-600 text-white'
                }`}
              >
                <p
                  className={`mb-2 flex items-center gap-1.5 text-[10px] font-semibold ${inbound ? 'text-slate-400' : 'text-indigo-100'}`}
                >
                  {inbound ? (
                    'Customer'
                  ) : (
                    <>
                      <Icon name="sparkles" width={11} height={11} />
                      AI assistant
                    </>
                  )}
                </p>
                <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
                {!inbound && (
                  <p className="mt-1 text-[10px] text-indigo-100">
                    {message.smsDelivery
                      ? deliveryLabels[message.smsDelivery.status]
                      : 'Delivery not tracked (historical message)'}
                    {message.smsDelivery?.lastError ? ` / ${message.smsDelivery.lastError}` : ''}
                  </p>
                )}
                {!inbound &&
                  companyId &&
                  canManageSms &&
                  message.smsDelivery &&
                  message.smsDelivery.status !== 'DELIVERED' && (
                    <SmsDeliveryActions companyId={companyId} delivery={message.smsDelivery} />
                  )}
                <p
                  className={`mt-2.5 text-[10px] ${inbound ? 'text-slate-400' : 'text-indigo-100'}`}
                >
                  {new Date(message.createdAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
