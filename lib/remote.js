import { spawn } from 'node:child_process';
import { config } from './config.js';

/** @type {typeof runRemoteScript | null} */
let remoteOverride = null;

export function setRemoteOverride(fn) {
  remoteOverride = fn;
}

export function clearRemoteOverride() {
  remoteOverride = null;
}

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];

/** SSH args for local → bastion hop */
function buildBastionSshArgs() {
  const args = [...SSH_OPTS];
  if (config.sshKey) args.push('-i', config.sshKey);
  return args;
}

/** SSH args for bastion → inner hop (key lives on bastion, e.g. /tmp/ubuntu.pem) */
function buildInnerSshArgs() {
  const args = [...SSH_OPTS];
  if (config.innerSshKey) args.push('-i', config.innerSshKey);
  return args;
}

/**
 * Execute a bash script on the inner host via bastion.
 * Matches: ssh -i staging.pem ubuntu@bastion ssh -i /tmp/ubuntu.pem ubuntu@inner bash -s
 * @param {string} script
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function runRemoteScript(script, opts = {}) {
  if (remoteOverride) {
    return remoteOverride(script, opts);
  }

  const timeoutMs = opts.timeoutMs ?? config.execTimeoutMs;
  const jumpHost = config.jumpHost;
  if (!jumpHost) {
    throw new Error('MCP_JUMP_HOST is not configured');
  }

  const maxBytes = config.maxBuffer;
  const sshArgs = [...buildBastionSshArgs()];

  if (config.innerHost) {
    sshArgs.push(jumpHost, 'ssh', ...buildInnerSshArgs(), config.innerHost, 'bash', '-s');
  } else {
    sshArgs.push(jumpHost, 'bash', '-s');
  }

  return new Promise((resolvePromise, reject) => {
    const child = spawn('ssh', sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(stdout, 'utf8') < maxBytes) {
        stdout += chunk.toString();
      }
    });
    child.stderr.on('data', (chunk) => {
      if (Buffer.byteLength(stderr, 'utf8') < maxBytes) {
        stderr += chunk.toString();
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        stdout,
        stderr,
        exitCode: code ?? 1,
        timedOut,
      });
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

/**
 * Quick connectivity probe (bastion → inner when configured).
 */
export async function probeRemote() {
  const result = await runRemoteScript(
    '#!/usr/bin/env bash\necho MCP_PROBE_OK\nhostname\n',
    { timeoutMs: 20000 },
  );
  return {
    ok: result.exitCode === 0 && result.stdout.includes('MCP_PROBE_OK'),
    timedOut: result.timedOut,
    exitCode: result.exitCode,
    stdout: result.stdout.trim().slice(0, 500),
    stderr: result.stderr.trim().slice(0, 500),
  };
}
