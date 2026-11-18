export function formatCurrency(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatMoney(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

export function formatServicePrice(pricing: ServicePricing, currency = 'USD'): string {
  if (pricing.pricingType === 'QUOTE_REQUIRED') return 'Quote required';
  if (pricing.pricingType === 'RANGE') {
    if (pricing.minPrice === null || pricing.maxPrice === null)
      throw new RangeError('An estimated service range is missing its minimum or maximum price.');
    return `${formatMoney(pricing.minPrice, currency)} - ${formatMoney(pricing.maxPrice, currency)}`;
  }
  if (pricing.unitPrice === null)
    throw new RangeError('A fixed-price service is missing its price.');
  return formatMoney(pricing.unitPrice, currency);
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase() || 'LR'
  );
}

export function displayOrDash(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '--';
  return value;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return last4.length === 4 ? `***${last4}` : phone;
}

export function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}
import type { ServicePricing } from '@lead-recovery/types';
