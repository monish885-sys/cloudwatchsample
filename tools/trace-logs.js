import { runClusterScan, buildScanReportFromEvents } from '../lib/run-cluster-scan.js';

export const definition = {
  name: 'search_logs_by_trace',
  description: 'Search logs by trace ID',
  inputSchema: {
    type: 'object',
    properties: {
      traceId: { type: 'string' },
      logGroupPrefix: { type: 'string' },
      hoursBack: { type: 'number' },
    },
    required: ['traceId', 'logGroupPrefix', 'hoursBack'],
  },
};

export async function execute(args) {
  const scan = await runClusterScan(
    {
      logGroupPrefix: args.logGroupPrefix,
      hoursBack: args.hoursBack,
      filterPattern: `"${args.traceId}"`,
      scanMode: 'exact',
      mode: 'trace',
    },
    'exact',
  );
  if (scan.hardError) throw new Error(scan.error);
  return buildScanReportFromEvents(scan.events, {
    logGroupPrefix: args.logGroupPrefix,
    windowHours: args.hoursBack,
    scanEngine: 'exact',
  });
}
