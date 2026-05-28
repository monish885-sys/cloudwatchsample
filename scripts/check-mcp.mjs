#!/usr/bin/env node
/**
 * Load .env, probe SSH path, and verify MCP server responds to initialize.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq);
    const val = t.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(envPath);

const { config } = await import('../lib/config.js');
const { probeRemote } = await import('../lib/remote.js');

console.log('Config:');
console.log('  MCP_JUMP_HOST:', config.jumpHost || '(missing)');
console.log('  MCP_INNER_HOST:', config.innerHost || '(direct)');
console.log('  MCP_INNER_SSH_KEY:', config.innerSshKey || '(same as bastion)');
console.log('  MCP_LOG_PREFIX:', config.defaultLogPrefix);
console.log('  MCP_SCAN_MODE:', config.scanMode);
console.log('  MCP_SSH_KEY exists:', config.sshKey ? existsSync(config.sshKey) : false);

console.log('\nSSH probe...');
try {
  const probe = await probeRemote();
  console.log('  ok:', probe.ok);
  console.log('  exit:', probe.exitCode);
  if (probe.stdout) console.log('  stdout:', probe.stdout);
  if (probe.stderr) console.log('  stderr:', probe.stderr);
  if (!probe.ok) {
    console.log('  hint: test two-hop SSH: ssh -i <bastion-key> <bastion> "ssh -i <inner-key> <inner-host> hostname"');
  }
} catch (err) {
  console.log('  FAILED:', err.message);
}

console.log('\nMCP stdio probe...');
const initReq = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'check-mcp', version: '1.0.0' },
  },
}) + '\n';

const mcp = spawn('node', ['index-mini.js'], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});

let mcpOut = '';
mcp.stdout.on('data', (d) => {
  mcpOut += d.toString();
});

const done = new Promise((resolve) => {
  mcp.on('close', (code) => resolve({ code, mcpOut }));
});

mcp.stdin.write(initReq);
setTimeout(() => {
  mcp.kill();
}, 3000);

const { code, mcpOut: out } = await done;
const mcpOk = out.includes('cloudwatch-mcp-mini') || out.includes('serverInfo');
console.log('  process exit:', code);
console.log('  initialize response:', mcpOk ? 'OK' : 'no response');
if (!mcpOk && out) console.log('  raw:', out.slice(0, 400));

process.exit(mcpOk && existsSync(envPath) ? 0 : 1);
