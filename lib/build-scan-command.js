import { config } from './config.js';

/**
 * Build bash script for CloudWatch log scan on remote host.
 * @param {{
 *   logGroupPrefix: string,
 *   hoursBack: number,
 *   filterPattern: string,
 *   mode: 'insights' | 'exact',
 * }} opts
 */
export function buildScanCommand(opts) {
  const { logGroupPrefix, hoursBack, filterPattern, mode } = opts;
  // CloudWatch name-prefix match is literal; trailing "/" excludes groups like ".../service".
  const prefix = logGroupPrefix.replace(/\/$/, '').replace(/'/g, "'\\''");
  const pattern = filterPattern.replace(/'/g, "'\\''");
  const hours = hoursBack;
  const parallel = config.scanParallel;
  const batchSize = config.insightsBatchSize;
  const startMs = `$(($(date +%s) * 1000 - ${Math.round(hours * 3600 * 1000)}))`;

  if (mode === 'insights') {
    return `#!/usr/bin/env bash
set -euo pipefail
PREFIX='${prefix}'
START_MS=${startMs}
END_SEC=$(date +%s)
BATCH=${batchSize}
LOG_GROUPS=$(aws logs describe-log-groups --log-group-name-prefix "$PREFIX" --query 'logGroups[].logGroupName' --output text 2>/dev/null | tr '\\t' '\\n' | grep -v '^$' || true)
if [ -z "$LOG_GROUPS" ]; then
  echo "__SCAN_META__ insights ${hours}"
  exit 0
fi
echo "$LOG_GROUPS" | xargs -n "$BATCH" | while read -r batch; do
  for lg in $batch; do
    qid=$(aws logs start-query --log-group-names "$lg" --start-time $((START_MS/1000)) --end-time "$END_SEC" --query-string "fields @timestamp, @logStream, @message | filter @message like /ERROR|Exception|fail|REJECT|CRITICAL|5xx/ | sort @timestamp desc | limit 50" --query 'queryId' --output text 2>/dev/null) || true
    [ -n "$qid" ] && echo "$qid"
  done
done | while read -r qid; do
  sleep 2
  aws logs get-query-results --query-id "$qid" 2>/dev/null | jq -r '.results[]? | [.[] | select(.field=="@timestamp")|.value, .[] | select(.field=="@log")|.value, .[] | select(.field=="@message")|.value] | @tsv' 2>/dev/null || true
done
echo "__SCAN_META__ insights ${hours}"
`;
  }

  return `#!/usr/bin/env bash
set -euo pipefail
PREFIX='${prefix}'
PATTERN='${pattern}'
START_MS=${startMs}
PARALLEL=${parallel}
aws logs describe-log-groups --log-group-name-prefix "$PREFIX" --query 'logGroups[].logGroupName' --output text 2>/dev/null | tr '\\t' '\\n' | grep -v '^$' | xargs -P "$PARALLEL" -I {} bash -c '
  aws logs filter-log-events --log-group-name "$1" --start-time "$2" --filter-pattern "$3" --max-items 100 2>/dev/null | jq -r --arg lg "$1" ".events[]? | [.timestamp|todateiso8601, \\$lg, .message] | @tsv" 2>/dev/null || true
' _ {} "$START_MS" "$PATTERN"
echo "__SCAN_META__ exact ${hours}"
`;
}
