import { reportHasInfraSymptoms } from '../signal-followups.js';

/**
 * @param {{ events?: unknown[] }} report
 * @param {{ infraBudgetMs: number, startedAt: number, namespace?: string }} budgets
 * @param {Record<string, { execute: (args: object) => Promise<unknown> }>} toolExecutors
 */
export async function phase3Infra(report, budgets, toolExecutors = {}) {
  const phasesExecuted = [];
  let infraTimedOut = false;
  const findings = [];

  if (!reportHasInfraSymptoms(report)) {
    return {
      infrastructureContext: { correlated: false, findings: [] },
      phasesExecuted,
      infraTimedOut: false,
    };
  }

  const deadline = budgets.startedAt + budgets.infraBudgetMs;
  const timeLeft = () => deadline - Date.now();

  const runTool = async (name, args, phaseLabel) => {
    if (timeLeft() < 500) {
      infraTimedOut = true;
      return null;
    }
    phasesExecuted.push(phaseLabel);
    const tool = toolExecutors[name];
    if (!tool?.execute) return null;
    try {
      const result = await Promise.race([
        tool.execute(args),
        new Promise((_, rej) =>
          setTimeout(() => {
            infraTimedOut = true;
            rej(new Error('infra timeout'));
          }, timeLeft()),
        ),
      ]);
      return result;
    } catch {
      infraTimedOut = true;
      return null;
    }
  };

  const ns = budgets.namespace || 'default';

  const k8sEvents = await runTool(
    'get_k8s_cluster_events',
    { namespace: ns, hoursBack: 1 },
    'infra_k8s_events',
  );
  if (k8sEvents?.findings) findings.push(...k8sEvents.findings);

  const k8sPods = await runTool('get_k8s_pod_health', { namespace: ns }, 'infra_k8s_pods');
  if (k8sPods?.findings) findings.push(...k8sPods.findings);

  const infraLogs = await runTool(
    'scan_infrastructure_logs',
    { hoursBack: 0.5 },
    'infra_logs',
  );
  if (infraLogs?.findings) findings.push(...infraLogs.findings);

  const text = (report?.events || []).map((e) => e.message).join('\n');
  const resourceTypes = [];
  if (/502|503|504|gateway/i.test(text)) resourceTypes.push('ALB');
  if (/SQL|database|pool|RDS/i.test(text)) resourceTypes.push('RDS');

  if (resourceTypes.length > 0 && timeLeft() > 500) {
    const metrics = await runTool(
      'get_aws_infra_metrics',
      { resourceTypes },
      'infra_metrics',
    );
    if (metrics?.findings) findings.push(...metrics.findings);
  }

  const capped = findings.slice(0, 8).map((f) => String(f).slice(0, 500));

  return {
    infrastructureContext: {
      correlated: capped.length > 0,
      findings: capped,
    },
    phasesExecuted,
    infraTimedOut,
  };
}
