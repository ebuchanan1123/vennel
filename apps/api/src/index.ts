import { env } from './env.js';
import { createApiApp } from './app.js';

createApiApp().listen(env.API_PORT, () => {
  console.log(`API listening on ${env.API_BASE_URL}`);
});
