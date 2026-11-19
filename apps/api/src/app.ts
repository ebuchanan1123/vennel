import cors from 'cors';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';

import { env } from './env.js';
import { getAccountAuth } from './auth.js';
import {
  accountSessionMiddleware,
  currentAccount,
  requireSameOrigin,
} from './middleware/account-access.js';
import { asyncHandler } from './middleware/async-handler.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { companiesRouter } from './routes/companies.js';
import { dashboardRouter } from './routes/dashboard.js';
import { devRouter } from './routes/dev.js';
import { healthRouter } from './routes/health.js';
import { leadsRouter } from './routes/leads.js';
import { smsRouter } from './routes/sms.js';
import { voiceRouter } from './routes/voice.js';
import { workspaceRouter } from './routes/workspace.js';
import { publicNotificationsRouter } from './routes/notifications.js';
import { resendWebhookRouter } from './routes/document-delivery.js';
import { accountsRouter } from './routes/accounts.js';
import { apiRateLimit } from './middleware/api-rate-limit.js';

export function createApiApp(authProvider: typeof getAccountAuth = getAccountAuth) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: new URL(env.DASHBOARD_BASE_URL).origin, credentials: true }));
  app.all(
    '/api/auth/*',
    asyncHandler(async (req, res) => {
      // Replace client-supplied rate-limit metadata with the actual connection address.
      req.headers['x-auth-client-ip'] = req.socket.remoteAddress ?? '';
      await toNodeHandler(authProvider())(req, res);
    }),
  );
  app.use(
    '/webhooks/resend',
    express.raw({ type: 'application/json', limit: '256kb' }),
    resendWebhookRouter,
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 100 }));
  app.get('/', (_req, res) =>
    res.json({ service: 'lead-recovery-api', docs: 'Use /health and /api endpoints' }),
  );
  app.use('/health', healthRouter);
  app.use('/api/notifications', publicNotificationsRouter);
  app.use('/api', requireSameOrigin, accountSessionMiddleware(authProvider), apiRateLimit);
  app.get('/api/account', (req, res) => res.json(currentAccount(req)));
  app.use('/api/accounts', accountsRouter);
  app.use('/api/companies', companiesRouter);
  app.use('/api/leads', leadsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/workspace/:companyId', workspaceRouter);
  app.use('/webhooks/twilio', voiceRouter);
  app.use('/webhooks/twilio', smsRouter);
  if (env.NODE_ENV === 'development')
    app.use('/dev', requireSameOrigin, accountSessionMiddleware(authProvider), devRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
