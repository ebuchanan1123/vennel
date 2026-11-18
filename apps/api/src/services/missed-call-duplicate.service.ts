export function hasRecentDuplicateMissedCall(
  lastOutboundBody: string | null | undefined,
  expectedBody: string,
  lastOutboundAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastOutboundBody || !lastOutboundAt) {
    return false;
  }

  if (lastOutboundBody.trim() !== expectedBody.trim()) {
    return false;
  }

  return now.getTime() - lastOutboundAt.getTime() <= 30 * 60 * 1000;
}
