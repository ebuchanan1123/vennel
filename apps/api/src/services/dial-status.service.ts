export function isMissedDialStatus(status?: string): boolean {
  if (!status) {
    return false;
  }

  const normalized = status.trim().toLowerCase();
  return normalized === 'no-answer' || normalized === 'busy' || normalized === 'failed';
}
