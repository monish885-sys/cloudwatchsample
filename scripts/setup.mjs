#!/usr/bin/env node
/**
 * One-shot onboarding: .env bootstrap, Node version check, unit tests.
 * Optional live MCP check: npm run setup -- --check
 */
import { copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envExample = resolve(root, '.env.example');
const envFile = resolve(root, '.env');
const runCheck = process.argv.includes('--check');

const major = parseInt(process.version.slice(1).split('.')[0], 10);
if (major < 20) {
  console.error(`Node.js 20+ required (current: ${process.version})`);
  process.exit(1);
}

console.log(`Node ${process.version} OK`);

if (!existsSync(envFile)) {
  if (!existsSync(envExample)) {
    console.error('Missing .env.example — cannot create .env');
    process.exit(1);
  }
  copyFileSync(envExample, envFile);
  console.log('Created .env from .env.example');
  console.log('  → Edit MCP_JUMP_HOST, MCP_SSH_KEY, and MCP_LOG_PREFIX before live runs.');
} else {
  console.log('.env already exists — skipped copy');
}

console.log('\nInstalling dependencies (npm install)...');
const install = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: false });
if (install.status !== 0) process.exit(install.status ?? 1);

console.log('\nRunning unit tests (npm test)...');
const test = spawnSync('npm', ['test'], { cwd: root, stdio: 'inherit', shell: false });
if (test.status !== 0) process.exit(test.status ?? 1);

if (runCheck) {
  console.log('\nRunning live MCP check (npm run check)...');
  const check = spawnSync('npm', ['run', 'check'], { cwd: root, stdio: 'inherit', shell: false });
  if (check.status !== 0) process.exit(check.status ?? 1);
} else {
  console.log('\nSkipped live check. After editing .env, run: npm run setup -- --check');
}

console.log('\nSetup complete.');
console.log('  1. Open this folder in Cursor');
console.log('  2. Reload MCP servers (.cursor/mcp.json uses ${workspaceFolder})');
console.log('  3. Paste an incident — agent prints draftRcaMarkdown from pipeline JSON');
