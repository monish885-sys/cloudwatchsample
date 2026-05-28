/**
 * Parse stdout from cluster scan scripts into raw events.
 * @param {string} stdout
 * @returns {Array<{ timestamp: string, logGroup: string, message: string }>}
 */
export function parseScanStdout(stdout) {
  if (!stdout || !stdout.trim()) return [];

  const events = [];
  const lines = stdout.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // JSON line format: {"timestamp":"...","logGroup":"...","message":"..."}
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj.message !== undefined) {
          events.push({
            timestamp: obj.timestamp || obj['@timestamp'] || new Date().toISOString(),
            logGroup: obj.logGroup || obj.log_group || 'unknown',
            message: String(obj.message),
          });
          continue;
        }
      } catch {
        // fall through to tab format
      }
    }

    // Tab-separated: ISO\tlogGroup\tmessage
    const tabIdx = trimmed.indexOf('\t');
    if (tabIdx > 0) {
      const ts = trimmed.slice(0, tabIdx);
      const rest = trimmed.slice(tabIdx + 1);
      const tab2 = rest.indexOf('\t');
      if (tab2 > 0) {
        events.push({
          timestamp: ts,
          logGroup: rest.slice(0, tab2),
          message: rest.slice(tab2 + 1),
        });
        continue;
      }
    }
  }

  return events;
}
