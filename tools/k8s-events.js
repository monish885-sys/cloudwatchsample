import { runRemoteScript } from '../lib/remote.js';
import { config } from '../lib/config.js';

export const definition = {
  name: 'get_k8s_cluster_events',
  description: 'Fetch Kubernetes cluster events',
  inputSchema: {
    type: 'object',
    properties: {
      namespace: { type: 'string' },
      hoursBack: { type: 'number' },
    },
    required: ['namespace', 'hoursBack'],
  },
};

export async function execute(args) {
  const ns = args.namespace || config.k8sNamespace;
  const script = `kubectl get events -n ${ns} --sort-by='.lastTimestamp' 2>/dev/null | tail -50`;
  try {
    const result = await runRemoteScript(script, { timeoutMs: 15000 });
    const lines = result.stdout.split('\n').filter((l) => /Warning|Error|Failed|OOM|Kill/i.test(l));
    return { findings: lines.slice(0, 8) };
  } catch (err) {
    return { findings: [`k8s events unavailable: ${err.message}`] };
  }
}
