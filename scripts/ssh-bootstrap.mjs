#!/usr/bin/env node
/** One-time: copy local bastion key to /tmp/ubuntu.pem on bastion for inner hop */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');

for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq > 0 && !process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const key = process.env.MCP_SSH_KEY?.replace(/^~/, process.env.HOME || '');
const jump = process.env.MCP_JUMP_HOST;
const innerKey = process.env.MCP_INNER_SSH_KEY || '/tmp/ubuntu.pem';

if (!key || !existsSync(key)) {
  console.error('MCP_SSH_KEY missing or not found');
  process.exit(1);
}

console.log(`Copying ${key} → ${jump}:${innerKey}`);
const scp = spawnSync(
  'scp',
  ['-o', 'BatchMode=yes', '-i', key, key, `${jump}:${innerKey}`],
  { stdio: 'inherit' },
);
if (scp.status !== 0) process.exit(scp.status ?? 1);

const chmod = spawnSync(
  'ssh',
  ['-o', 'BatchMode=yes', '-i', key, jump, `chmod 600 ${innerKey}`],
  { stdio: 'inherit' },
);
process.exit(chmod.status ?? 0);
