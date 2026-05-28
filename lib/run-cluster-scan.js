import { buildScanCommand } from './build-scan-command.js';
import { runRemoteScript } from './remote.js';
import { parseScanStdout } from './parse-scan.js';
import { buildScanReport } from './format-report.js';
import { shouldUseInsights } from './filter-to-insights.js';

/**
 * @param {Object} plan
 * @param {string} plan.logGroupPrefix
 * @param {number} plan.hoursBack
 * @param {string} plan.filterPattern
 * @param {'exact'|'insights'|'auto'} [plan.scanMode]
 * @param {'insights'|'exact'} [forceMode]
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function runClusterScan(plan, forceMode, opts = {}) {
  const mode =
    forceMode ||
    (plan.mode === 'trace' ? 'exact' : shouldUseInsights(plan.scanMode) ? 'insights' : 'exact');

  const script = buildScanCommand({
    logGroupPrefix: plan.logGroupPrefix,
    hoursBack: plan.hoursBack,
    filterPattern: plan.filterPattern,
    mode,
  });

  let result;
  try {
    result = await runRemoteScript(script, opts);
  } catch (err) {
    return {
      ok: false,
      hardError: true,
      error: err.message,
      events: [],
      scanEngine: mode,
      insightsFailed: mode === 'insights',
    };
  }

  if (result.timedOut) {
    return {
      ok: false,
      timedOut: true,
      events: [],
      scanEngine: mode,
      insightsFailed: mode === 'insights',
      stderr: result.stderr,
    };
  }

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    return {
      ok: false,
      hardError: true,
      error: result.stderr || `exit ${result.exitCode}`,
      events: [],
      scanEngine: mode,
      insightsFailed: mode === 'insights',
    };
  }

  const events = parseScanStdout(result.stdout);
  const insightsFailed = mode === 'insights' && events.length === 0;

  return {
    ok: true,
    events,
    scanEngine: mode,
    insightsFailed,
    timedOut: result.timedOut,
    stderr: result.stderr,
  };
}

/**
 * @param {Array<{ timestamp: string, logGroup: string, message: string }>} events
 * @param {Object} meta
 */
export function buildScanReportFromEvents(events, meta) {
  return buildScanReport(events, meta);
}
