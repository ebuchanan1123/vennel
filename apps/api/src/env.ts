import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envCandidates = [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

const originUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    );
  }, 'Use a fixed HTTP(S) origin without credentials, a path, query or fragment.')
  .transform((value) => new URL(value).origin);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_BASE_URL: originUrl.default('http://localhost:4000'),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    DASHBOARD_BASE_URL: originUrl.default('http://localhost:3000'),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().email().optional(),
    RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
    OPENAI_TRANSCRIPTION_MODEL: z.string().default('gpt-transcribe'),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(1000),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
    API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(120),
    AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).max(100000).default(200),
    AI_DAILY_AUDIO_BYTE_LIMIT: z.coerce.number().int().min(1).max(1073741824).default(20971520),
    SMS_DAILY_SEND_LIMIT: z.coerce.number().int().min(1).max(100000).default(500),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
    SMS_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(15000),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_PHONE_NUMBER: z.string().optional(),
    TWILIO_SMS_REPLY_MODE: z.enum(['hardcoded', 'openai']).default('openai'),
    DEMO_BUSINESS_PHONE: z.string().optional(),
    TWILIO_VALIDATE_SIGNATURES: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  .superRefine((value, context) => {
    if (Boolean(value.TWILIO_ACCOUNT_SID) !== Boolean(value.TWILIO_AUTH_TOKEN))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_ACCOUNT_SID'],
        message: 'Configure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN together.',
      });
    if (value.NODE_ENV !== 'production') return;
    if (!value.BETTER_AUTH_SECRET)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BETTER_AUTH_SECRET'],
        message: 'A persistent high-entropy auth secret is required in production.',
      });
    if (!value.DASHBOARD_BASE_URL.startsWith('https://'))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DASHBOARD_BASE_URL'],
        message: 'Production sessions require an HTTPS application origin.',
      });
    if (!value.API_BASE_URL.startsWith('https://'))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_BASE_URL'],
        message: 'Production provider callbacks require a public HTTPS API origin.',
      });
    if (value.TWILIO_SMS_REPLY_MODE !== 'openai')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_SMS_REPLY_MODE'],
        message: 'Hardcoded webhook verification replies are development-only.',
      });
    if (!value.TWILIO_VALIDATE_SIGNATURES)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_VALIDATE_SIGNATURES'],
        message: 'Twilio signature verification cannot be disabled in production.',
      });
    if (!value.RESEND_API_KEY || !value.RESEND_FROM_EMAIL)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'Production account verification requires a configured email provider.',
      });
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
