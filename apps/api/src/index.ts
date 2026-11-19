import { env } from './env.js';
import { createApiApp } from './app.js';
import { prisma } from '@lead-recovery/database';

const server = createApiApp().listen(
  env.API_PORT,
  env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
  () => {
    console.log(JSON.stringify({ event: 'api_started', port: env.API_PORT }));
  },
);
server.requestTimeout = 90000;
server.headersTimeout = 10000;
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: 'api_draining' }));
  const deadline = setTimeout(() => {
    console.error(JSON.stringify({ event: 'api_shutdown_deadline_exceeded' }));
    server.closeAllConnections();
    process.exitCode = 1;
  }, 30000);
  deadline.unref();
  server.close((error) => {
    clearTimeout(deadline);
    if (error) {
      console.error(JSON.stringify({ event: 'api_shutdown_failed', errorType: error.name }));
      process.exitCode = 1;
    }
    prisma.$disconnect().catch((failure: unknown) => {
      console.error(
        JSON.stringify({
          event: 'api_database_disconnect_failed',
          errorType: failure instanceof Error ? failure.name : 'Unknown',
        }),
      );
      process.exitCode = 1;
    });
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
