/**
 * Normalize events and build scan report structure.
 * @param {Array<{ timestamp: string, logGroup: string, message: string }>} events
 * @param {{ logGroupPrefix?: string, windowHours?: number, scanEngine?: string }} meta
 */
export function buildScanReport(events, meta = {}) {
  const normalized = (events || []).map((e) => ({
    timestamp: normalizeTimestamp(e.timestamp),
    logGroup: e.logGroup || 'unknown',
    message: e.message || '',
  }));

  return {
    events: normalized,
    meta: {
      logGroupPrefix: meta.logGroupPrefix || '',
      windowHours: meta.windowHours ?? 0,
      scanEngine: meta.scanEngine || 'exact',
      eventCount: normalized.length,
    },
  };
}

function normalizeTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString();
}

/**
 * @param {ReturnType<typeof buildScanReport>} report
 */
export function reportEventCount(report) {
  return report?.events?.length ?? 0;
}
