const EMERGENCY_PATTERNS = [
  /\bsmell\s+gas\b/i,
  /\bgas\s+leak\b/i,
  /\bcarbon\s+monoxide\b/i,
  /\bco\s+alarm\b/i,
  /\bfire\b/i,
  /\bsmoke\b/i,
  /\bsparking\b/i,
  /\belectrical\s+fire\b/i,
];

export const EMERGENCY_ESCALATION_MESSAGE =
  "This may require immediate attention. Please stop using this automated chat and contact the appropriate emergency service or your HVAC provider's emergency line. I've also flagged this request for urgent human review.";

export function isEmergencyMessage(message: string): boolean {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(message));
}
