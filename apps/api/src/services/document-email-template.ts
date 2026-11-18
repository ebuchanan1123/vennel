import { calculateDocumentTotals, type FinalizedDocumentSnapshot } from '@lead-recovery/types';

import { emailDisplayName, escapeEmailHtml as escape } from './email-provider.service.js';

export function renderDocumentEmail(document: FinalizedDocumentSnapshot): {
  subject: string;
  text: string;
  html: string;
} {
  const title = document.kind === 'ESTIMATE' ? 'Estimate' : 'Invoice';
  const money = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: document.currency }).format(
      value,
    );
  const totals = calculateDocumentTotals(document.items, document.discountAmount, document.taxRate);
  const dateLabel = document.kind === 'ESTIMATE' ? 'Valid until' : 'Due date';
  const notice =
    document.kind === 'ESTIMATE'
      ? 'This is an estimate, not a request for payment.'
      : 'This invoice does not record payment. Contact the business with questions about payment arrangements.';
  const items = document.items.map((item) => ({
    ...item,
    amount: money(calculateDocumentTotals([item]).subtotal),
  }));
  const subject = `${title} ${document.number} from ${emailDisplayName(document.businessName)}`;
  const text = [
    `${document.businessName}\n${title} ${document.number}\n${document.title}`,
    ...[
      document.billingProfile?.address,
      document.billingProfile?.email,
      document.billingProfile?.phone,
      document.billingProfile?.taxRegistrationNumber
        ? `Tax registration: ${document.billingProfile.taxRegistrationNumber}`
        : null,
    ].filter((value): value is string => Boolean(value)),
    `Prepared for: ${document.customer.name}`,
    ...[document.customer.address, document.customer.email, document.customer.phone].filter(
      (value): value is string => Boolean(value),
    ),
    ...(document.dueDate ? [`${dateLabel}: ${document.dueDate}`] : []),
    `Currency: ${document.currency}`,
    ...items.map(
      (item) =>
        `${item.description}: ${item.quantity}${item.unit ? ` ${item.unit}` : ''} x ${money(item.unitPrice)} = ${item.amount}`,
    ),
    `Subtotal: ${money(totals.subtotal)}`,
    `Discount: -${money(totals.discount)}`,
    `Tax (${document.taxRate}%): ${money(totals.tax)}`,
    `Total: ${money(totals.total)}`,
    ...(document.notes ? [`Notes & terms:\n${document.notes}`] : []),
    notice,
  ].join('\n\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;background:#f7f9fc;font-family:Arial,sans-serif;color:#182338">
<main style="max-width:680px;margin:24px auto;padding:28px;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
<h1 style="font-size:22px;margin-top:0">${escape(document.businessName)}</h1>
${[document.billingProfile?.address, document.billingProfile?.email, document.billingProfile?.phone]
  .filter((value): value is string => Boolean(value))
  .map((value) => `<p style="white-space:pre-wrap">${escape(value)}</p>`)
  .join('')}
${document.billingProfile?.taxRegistrationNumber ? `<p>Tax registration: ${escape(document.billingProfile.taxRegistrationNumber)}</p>` : ''}
<h2 style="font-size:18px">${title} ${escape(document.number)}</h2><p>${escape(document.title)}</p>
<p><strong>Prepared for ${escape(document.customer.name)}</strong></p>
${[document.customer.address, document.customer.email, document.customer.phone]
  .filter((value): value is string => Boolean(value))
  .map((value) => `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(value)}</p>`)
  .join('')}
${document.dueDate ? `<p>${dateLabel}: ${escape(document.dueDate)}</p>` : ''}<p>Currency: ${escape(document.currency)}</p>
<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc"><th scope="col" style="text-align:left;padding:10px">Description</th><th scope="col" style="padding:10px">Qty / unit</th><th scope="col" style="text-align:right;padding:10px">Rate</th><th scope="col" style="text-align:right;padding:10px">Amount</th></tr></thead><tbody>
${items.map((item) => `<tr><td style="border-bottom:1px solid #eef2f6;padding:10px;overflow-wrap:anywhere">${escape(item.description)}</td><td style="text-align:center;padding:10px">${item.quantity} ${escape(item.unit ?? '')}</td><td style="text-align:right;padding:10px">${escape(money(item.unitPrice))}</td><td style="text-align:right;padding:10px">${escape(item.amount)}</td></tr>`).join('')}
</tbody></table>
<p style="text-align:right">Subtotal: ${escape(money(totals.subtotal))}</p><p style="text-align:right">Discount: -${escape(money(totals.discount))}</p>
<p style="text-align:right">Tax (${document.taxRate}%): ${escape(money(totals.tax))}</p><p style="text-align:right;font-size:20px"><strong>Total: ${escape(money(totals.total))}</strong></p>
${document.notes ? `<h3 style="font-size:14px">Notes &amp; terms</h3><p style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(document.notes)}</p>` : ''}
<p style="font-size:12px;color:#64748b">${notice}</p></main></body></html>`;
  return { subject, text, html };
}
