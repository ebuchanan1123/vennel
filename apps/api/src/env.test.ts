import { describe, expect, it } from 'vitest';

import { envSchema } from './env.js';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/isolated_test',
  BETTER_AUTH_SECRET: 'synthetic-production-config-validation-secret-only',
  API_BASE_URL: 'https://api.example.test',
  DASHBOARD_BASE_URL: 'https://app.example.test',
  RESEND_API_KEY: 'synthetic-provider-key',
  RESEND_FROM_EMAIL: 'notifications@example.test',
};

describe('production configuration boundaries', () => {
  it('accepts canonical HTTPS origins and bounded worker/provider settings', () => {
    const parsed = envSchema.parse({ ...production, API_BASE_URL: 'https://api.example.test/' });
    expect(parsed.API_BASE_URL).toBe('https://api.example.test');
    expect(parsed.WORKER_CONCURRENCY).toBe(4);
    expect(parsed.OPENAI_TIMEOUT_MS).toBe(20000);
    expect(parsed.SMS_DAILY_SEND_LIMIT).toBe(500);
  });

  it.each([
    { BETTER_AUTH_SECRET: undefined },
    { API_BASE_URL: 'http://api.example.test' },
    { DASHBOARD_BASE_URL: 'http://app.example.test' },
    { API_BASE_URL: 'https://api.example.test/path' },
    { API_BASE_URL: 'https://api.example.test?token=synthetic' },
    { DASHBOARD_BASE_URL: 'https://user:password@app.example.test' },
    { TWILIO_VALIDATE_SIGNATURES: 'false' },
    { TWILIO_VALIDATE_SIGNATURES: 'typo' },
    { TWILIO_SMS_REPLY_MODE: 'hardcoded' },
    { TWILIO_ACCOUNT_SID: 'AC-synthetic-without-token' },
    { WORKER_CONCURRENCY: '0' },
    { OPENAI_TIMEOUT_MS: '120000' },
    { SMS_PROVIDER_TIMEOUT_MS: '0' },
    { AI_DAILY_REQUEST_LIMIT: '0' },
    { RESEND_FROM_EMAIL: undefined },
  ])('refuses unsafe or incomplete production settings: %j', (override) => {
    expect(envSchema.safeParse({ ...production, ...override }).success).toBe(false);
  });
});
