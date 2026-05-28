import { runRemoteScript } from '../lib/remote.js';

export const definition = {
  name: 'scan_infrastructure_logs',
  description: 'Scan infrastructure logs',
  inputSchema: {
    type: 'object',
    properties: {
      hoursBack: { type: 'number' },
    },
    required: ['hoursBack'],
  },
};

export async function execute(args) {
  const hours = args.hoursBack || 0.5;
  const script = `aws logs filter-log-events --log-group-name /infra/system --start-time $(($(date +%s)*1000-${Math.round(hours * 3600000)})) --filter-pattern '?ERROR ?timeout ?refused' --max-items 20 2>/dev/null | jq -r '.events[]?.message' 2>/dev/null || echo "no infra logs"`;
  try {
    const result = await runRemoteScript(script, { timeoutMs: 20000 });
    const lines = result.stdout.split('\n').filter(Boolean).slice(0, 8);
    return { findings: lines.length ? lines : [] };
  } catch (err) {
    return { findings: [] };
  }
}
