import { runClusterScan, buildScanReportFromEvents } from '../run-cluster-scan.js';
import { buildScanReport, reportEventCount } from '../format-report.js';

const BROAD_WINDOWS = [0.25, 1, 4];
const TRACE_WINDOWS = [6, 24];

/**
 * @param {import('../parse-incident.js').RoutingPlan} plan
 * @returns {string[]}
 */
function resolveScanPrefixes(plan) {
  if (plan.mode === 'trace') {
    return [plan.logGroupPrefix];
  }
  if (plan.scopedLogGroupPrefixes?.length) {
    return plan.scopedLogGroupPrefixes;
  }
  return [plan.logGroupPrefix];
}

/**
 * @param {import('../parse-incident.js').RoutingPlan} planWindow
 * @param {'insights'|'exact'} engine
 * @param {{ timeoutMs?: number }} opts
 */
async function runScopedClusterScan(planWindow, engine, opts) {
  const prefixes = resolveScanPrefixes(planWindow);
  let allEvents = [];
  let timedOut = false;
  let insightsFailed = false;
  let lastEngine = engine;

  for (const prefix of prefixes) {
    const scan = await runClusterScan({ ...planWindow, logGroupPrefix: prefix }, engine, opts);
    if (scan.hardError) {
      return { hardError: true, error: scan.error, events: [], timedOut, insightsFailed };
    }
    if (scan.timedOut) timedOut = true;
    if (scan.insightsFailed) insightsFailed = true;
    lastEngine = scan.scanEngine;
    allEvents = allEvents.concat(scan.events);
  }

  return { hardError: false, events: allEvents, timedOut, insightsFailed, scanEngine: lastEngine };
}

/**
 * @param {import('../parse-incident.js').parseIncident extends Function ? ReturnType<import('../parse-incident.js').parseIncident> : object} plan
 * @param {{ appBudgetMs: number, startedAt: number, perCallTimeoutMs?: number }} budgets
 */
export async function phase2Fetch(plan, budgets) {
  const phasesExecuted = [];
  let timedOut = false;
  let statusHint;
  let lastEngine = 'exact';
  let report = buildScanReport([], { logGroupPrefix: plan.logGroupPrefix });

  const elapsed = () => Date.now() - budgets.startedAt;
  const remaining = () => budgets.appBudgetMs - elapsed();
  const canContinue = () => remaining() > 1000;

  if (plan.mode === 'trace') {
    for (let i = 0; i < TRACE_WINDOWS.length; i++) {
      if (!canContinue()) {
        timedOut = true;
        break;
      }
      const hours = TRACE_WINDOWS[i];
      const phaseName = hours === 6 ? 'trace_exact_6h' : 'trace_exact_24h';
      phasesExecuted.push(phaseName);

      const scan = await runScopedClusterScan(
        { ...plan, hoursBack: hours },
        'exact',
        { timeoutMs: Math.min(budgets.perCallTimeoutMs || 60000, remaining()) },
      );

      if (scan.hardError) {
        return { hardError: true, error: scan.error, phasesExecuted, timedOut };
      }
      if (scan.timedOut) timedOut = true;

      lastEngine = 'exact';
      if (scan.events.length > 0) {
        report = buildScanReportFromEvents(scan.events, {
          logGroupPrefix: plan.logGroupPrefix,
          windowHours: hours,
          scanEngine: 'exact',
        });
        break;
      }
    }

    if (reportEventCount(report) === 0) {
      statusHint = 'no_explicit_errors';
    }

    return {
      report,
      scanEngine: lastEngine,
      phasesExecuted,
      eventsScanned: reportEventCount(report),
      statusHint,
      timedOut,
    };
  }

  // Broad path
  for (const hours of BROAD_WINDOWS) {
    if (!canContinue()) {
      timedOut = true;
      break;
    }

    const windowLabel = hours === 0.25 ? '15m' : hours === 1 ? '60m' : '4h';
    const planWindow = { ...plan, hoursBack: hours };
    let totalEvents = [];

    // Insights first
    phasesExecuted.push(`app_fetch_insights_${windowLabel}`);
    const insights = await runScopedClusterScan(planWindow, 'insights', {
      timeoutMs: Math.min(budgets.perCallTimeoutMs || 60000, remaining()),
    });

    if (insights.hardError) {
      return { hardError: true, error: insights.error, phasesExecuted, timedOut };
    }
    if (insights.timedOut) timedOut = true;

    lastEngine = 'insights';
    totalEvents = insights.events;

    if (insights.insightsFailed || insights.timedOut || totalEvents.length === 0) {
      if (!canContinue()) {
        timedOut = true;
        break;
      }
      phasesExecuted.push(`app_fetch_exact_fallback_${windowLabel}`);
      const exact = await runScopedClusterScan(planWindow, 'exact', {
        timeoutMs: Math.min(budgets.perCallTimeoutMs || 60000, remaining()),
      });
      if (exact.hardError) {
        return { hardError: true, error: exact.error, phasesExecuted, timedOut };
      }
      if (exact.timedOut) timedOut = true;
      lastEngine = 'exact';
      totalEvents = exact.events;
    }

    if (totalEvents.length > 0) {
      report = buildScanReportFromEvents(totalEvents, {
        logGroupPrefix: plan.logGroupPrefix,
        windowHours: hours,
        scanEngine: lastEngine,
      });
      break;
    }

    if (hours < 4) {
      phasesExecuted.push(`app_fetch_auto_widen_${hours === 0.25 ? '60m' : '4h'}`);
    }
  }

  if (reportEventCount(report) === 0) {
    statusHint = 'no_explicit_errors';
  }

  return {
    report,
    scanEngine: lastEngine,
    phasesExecuted,
    eventsScanned: reportEventCount(report),
    statusHint,
    timedOut,
  };
}
