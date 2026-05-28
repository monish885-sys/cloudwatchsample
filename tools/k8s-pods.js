import { runRemoteScript } from '../lib/remote.js';
import { config } from '../lib/config.js';

export const definition = {
  name: 'get_k8s_pod_health',
  description: 'Check pod health in namespace',
  inputSchema: {
    type: 'object',
    properties: {
      namespace: { type: 'string' },
    },
    required: ['namespace'],
  },
};

export async function execute(args) {
  const ns = args.namespace || config.k8sNamespace;
  const script = `kubectl get pods -n ${ns} -o wide 2>/dev/null | grep -v Running || true`;
  try {
    const result = await runRemoteScript(script, { timeoutMs: 15000 });
    const lines = result.stdout.split('\n').filter((l) => l.trim() && !/Running|Completed/i.test(l));
    return { findings: lines.length ? lines.slice(0, 8) : ['All pods Running'] };
  } catch (err) {
    return { findings: [`k8s pods unavailable: ${err.message}`] };
  }
}
