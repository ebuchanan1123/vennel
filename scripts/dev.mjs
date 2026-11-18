import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from 'dotenv';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

config({ path: '.env' });
if (process.env.NODE_ENV === 'production')
  throw new Error('Use production build/start commands for deployment, not pnpm dev.');
let authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret) {
  const directory = resolve('.local');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink())
    throw new Error('The local secret directory must not be a symbolic link.');
  const path = resolve(directory, 'auth-secret');
  if (!existsSync(path))
    writeFileSync(path, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error('The local auth secret must be a private regular file (mode 600).');
  authSecret = readFileSync(path, 'utf8').trim();
}
if (authSecret.length < 32)
  throw new Error('BETTER_AUTH_SECRET must contain at least 32 high-entropy characters.');
const child = spawn('pnpm', ['exec', 'turbo', 'run', 'dev', 'dev:worker'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    BETTER_AUTH_SECRET: authSecret,
    API_INTERNAL_URL:
      process.env.API_INTERNAL_URL || `http://127.0.0.1:${process.env.API_PORT || '4000'}`,
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error('Could not start the workspace', error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
