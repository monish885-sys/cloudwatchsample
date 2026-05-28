import { detectSignals } from './format-brief.js';

const INFRA_SIGNALS = new Set([
  'OOM',
  'timeout',
  'conn-refused',
  'gateway-502',
  'gateway-503',
  'gateway-504',
  'db-pool',
  'memory',
]);

/**
 * @param {{ events?: Array<{ message: string }> }} report
 */
export function reportHasInfraSymptoms(report) {
  for (const e of report?.events || []) {
    const signals = detectSignals(e.message);
    if (signals.some((s) => INFRA_SIGNALS.has(s))) return true;
  }
  return false;
}

/**
 * @param {{ events?: Array<{ message: string, logGroup?: string }>, meta?: { logGroupPrefix?: string } }} report
 * @param {{ traceId?: string, logGroupPrefix?: string }} ctx
 */
export function suggestedFollowUps(report, ctx = {}) {
  const followUps = [];
  const prefix = ctx.logGroupPrefix || report?.meta?.logGroupPrefix || '';
  const traceId = ctx.traceId;

  if (traceId) {
    followUps.push({
      tool: 'search_logs_by_trace',
      prefilledArgs: { traceId, logGroupPrefix: prefix, hoursBack: 24 },
    });
  }

  if (reportHasInfraSymptoms(report)) {
    followUps.push({
      tool: 'get_k8s_cluster_events',
      prefilledArgs: { namespace: 'default', hoursBack: 1 },
    });
    followUps.push({
      tool: 'get_k8s_pod_health',
      prefilledArgs: { namespace: 'default' },
    });
    followUps.push({
      tool: 'scan_infrastructure_logs',
      prefilledArgs: { hoursBack: 0.5 },
    });

    const text = (report?.events || []).map((e) => e.message).join('\n');
    if (/502|503|504|gateway/i.test(text)) {
      followUps.push({
        tool: 'get_aws_infra_metrics',
        prefilledArgs: { resourceTypes: ['ALB'] },
      });
    }
    if (/SQL|database|pool|RDS/i.test(text)) {
      followUps.push({
        tool: 'get_aws_infra_metrics',
        prefilledArgs: { resourceTypes: ['RDS'] },
      });
    }
  }

  return followUps.slice(0, 5);
}
