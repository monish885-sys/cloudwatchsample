const SIGNAL_PATTERNS = [
  { label: 'OOM', regex: /OutOfMemory|OOM|Killed process|memory limit/i },
  { label: 'timeout', regex: /timeout|timed out|deadline exceeded|context deadline/i },
  { label: 'conn-refused', regex: /connection refused|ECONNREFUSED|connect: connection refused/i },
  { label: 'gateway-502', regex: /\b502\b|Bad Gateway/i },
  { label: 'gateway-503', regex: /\b503\b|Service Unavailable/i },
  { label: 'gateway-504', regex: /\b504\b|Gateway Timeout/i },
  { label: 'db-pool', regex: /pool exhausted|HikariPool|connection pool/i },
  { label: 'memory', regex: /heap space|GC overhead|memory pressure/i },
  { label: 'ERROR', regex: /\bERROR\b/ },
  { label: 'SQLException', regex: /SQLException|SQLSyntaxError/i },
  { label: 'NullPointerException', regex: /NullPointerException/i },
  { label: '500', regex: /\b500\b|Internal Server Error/i },
  { label: 'FATAL', regex: /\bFATAL\b/ },
  { label: 'Exception', regex: /\bException\b/ },
];

/**
 * Detect human-readable signals in text.
 * @param {string} text
 * @returns {string[]}
 */
export function detectSignals(text) {
  if (!text) return [];
  const found = new Set();
  for (const { label, regex } of SIGNAL_PATTERNS) {
    if (regex.test(text)) found.add(label);
  }
  return [...found];
}

/**
 * @param {import('./format-report.js').buildScanReport extends Function ? ReturnType<import('./format-report.js').buildScanReport> : { events: Array<{ message: string }> }} report
 */
export function briefFromReport(report) {
  const allSignals = new Set();
  for (const e of report?.events || []) {
    for (const s of detectSignals(e.message)) allSignals.add(s);
  }
  return { signals: [...allSignals], eventCount: report?.events?.length ?? 0 };
}
