import { runRemoteScript } from '../lib/remote.js';

export const definition = {
  name: 'get_aws_infra_metrics',
  description: 'Quick RDS/ALB infra metrics',
  inputSchema: {
    type: 'object',
    properties: {
      resourceTypes: {
        type: 'array',
        items: { type: 'string', enum: ['RDS', 'ALB'] },
      },
    },
    required: ['resourceTypes'],
  },
};

export async function execute(args) {
  const types = args.resourceTypes || [];
  const findings = [];
  for (const t of types) {
    const script =
      t === 'RDS'
        ? `aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name DatabaseConnections --dimensions Name=DBInstanceIdentifier,Value=prod --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%S) --end-time $(date -u +%Y-%m-%dT%H:%M:%S) --period 300 --statistics Average 2>/dev/null | jq -r '.Datapoints[-1].Average // "n/a"'`
        : `aws cloudwatch get-metric-statistics --namespace AWS/ApplicationELB --metric-name HTTPCode_Target_5XX_Count --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%S) --end-time $(date -u +%Y-%m-%dT%H:%M:%S) --period 300 --statistics Sum 2>/dev/null | jq -r '.Datapoints[-1].Sum // "n/a"'`;
    try {
      const result = await runRemoteScript(script, { timeoutMs: 15000 });
      findings.push(`${t} metric: ${result.stdout.trim().slice(0, 200)}`);
    } catch {
      findings.push(`${t} metrics unavailable`);
    }
  }
  return { findings };
}
