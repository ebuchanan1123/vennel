const IRRELEVANT_PATTERNS = [
  /\bcrypto\b/i,
  /\bbitcoin\b/i,
  /\bnft\b/i,
  /\bcasino\b/i,
  /\bloan\b/i,
  /\bforex\b/i,
  /\bseo\b/i,
  /\bmarketing\b/i,
  /\bviagra\b/i,
  /https?:\/\//i,
];

export const IRRELEVANT_MESSAGE_REPLY =
  'This number is for HVAC service requests only. If you need heating or cooling help, reply with your issue and location.';

export function isIrrelevantMessage(message: string): boolean {
  return IRRELEVANT_PATTERNS.some((pattern) => pattern.test(message));
}
