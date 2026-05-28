/** @typedef {import('./emit-payload.js').PipelineStatus} PipelineStatus */

const MAX_BULLET = 220;
const MAX_ERROR_LINE = 180;

/**
 * @param {string} s
 * @param {number} max
 */
function truncate(s, max) {
  if (!s) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 3)}...`;
}

/**
 * @param {string} logGroup
 */
function serviceFromLogGroup(logGroup) {
  const parts = String(logGroup || '')
    .split('/')
    .filter(Boolean);
  return parts[parts.length - 1] || logGroup || 'unknown';
}

/**
 * @param {string} snippet
 */
function extractErrorLine(snippet) {
  const lines = String(snippet || '').split('\n');
  for (const line of lines) {
    if (/ERROR|Exception|FATAL|\b5\d{2}\b|OOM|timeout|refused/i.test(line)) {
      return truncate(line, MAX_ERROR_LINE);
    }
  }
  return truncate(lines[0] || snippet, MAX_ERROR_LINE);
}

/** @param {string[]} signals */
function impactFromSignals(signals) {
  const set = new Set(signals || []);
  if (set.has('gateway-502') || set.has('gateway-503') || set.has('gateway-504')) {
    return 'Users likely see failed HTTP requests, elevated 5xx, or gateway errors.';
  }
  if (set.has('OOM') || set.has('memory')) {
    return 'Service instability or pod restarts may cause elevated latency and failed requests.';
  }
  if (set.has('timeout') || set.has('conn-refused')) {
    return 'Dependent calls may fail, causing user-facing errors or stalled workflows.';
  }
  if (set.has('db-pool') || set.has('SQLException')) {
    return 'Data access failures may block core user flows and API success rates.';
  }
  if (set.has('NullPointerException') || set.has('Exception') || set.has('ERROR')) {
    return 'Application errors may surface as failed API responses or broken user journeys.';
  }
  return 'Elevated error signatures indicate user-impacting failures in the scanned scope.';
}

/**
 * @param {PipelineStatus} status
 */
function statusLabel(status) {
  if (status === 'no_explicit_errors') return 'no explicit errors';
  return status;
}

/**
 * @param {Object} input
 * @param {PipelineStatus} input.status
 * @param {string} [input.message]
 * @param {Array<{ logGroup: string, timestamp: string, signals?: string[], snippet: string }>} input.topBlocks
 * @param {{ primaryTarget?: string, knownInfrastructure?: string[] }} [input.topologyContext]
 */
function buildRcaBullets({ status, message, topBlocks, topologyContext }) {
  if (status === 'error' || status === 'timeout') {
    return [
      truncate(
        `Pipeline ${status}: ${message || 'No additional details returned.'}`,
        MAX_BULLET,
      ),
      'No scored log blocks were available for evidence-based RCA.',
      'Verify bastion SSH, inner host access, and CloudWatch log prefixes before retrying.',
    ];
  }

  if (status === 'no_explicit_errors' || !topBlocks?.length) {
    const svc = topologyContext?.primaryTarget || 'scoped services';
    return [
      `No hard error signatures in standard windows for **${svc}**.`,
      truncate(
        message ||
          'Insufficient log evidence for a definitive root cause (possible logical or silent failure).',
        MAX_BULLET,
      ),
      'Expand time range, confirm service keywords, or check dependencies outside scanned prefixes.',
    ];
  }

  const block = topBlocks[0];
  const svc = topologyContext?.primaryTarget || serviceFromLogGroup(block.logGroup);
  const signals = (block.signals || []).length ? (block.signals || []).join(', ') : 'unspecified';
  const errLine = extractErrorLine(block.snippet);

  return [
    `**${svc}** — \`${block.logGroup}\` at ${block.timestamp}: error activity detected.`,
    `Signature (${signals}): \`${errLine}\``,
    truncate(impactFromSignals(block.signals || []), MAX_BULLET),
  ];
}

/**
 * @param {Object} input
 * @param {{ correlated?: boolean, findings?: string[] }} input.infrastructureContext
 * @param {{ knownInfrastructure?: string[] }} [input.topologyContext]
 * @param {PipelineStatus} input.status
 */
function buildInfraBullet({ infrastructureContext, topologyContext, status }) {
  const findings = infrastructureContext?.findings || [];
  if (findings.length > 0) {
    return truncate(findings[0], MAX_BULLET);
  }
  if (status === 'error' || status === 'timeout') {
    return 'Infra correlation was not completed due to pipeline failure.';
  }
  if (status === 'partial') {
    const deps = topologyContext?.knownInfrastructure?.join(', ');
    return deps
      ? `Infra phase incomplete (partial run). Monitored stack: ${deps}. No correlated infra findings in returned payload.`
      : 'Infra phase incomplete (partial run). No correlated infra findings in returned payload.';
  }
  const deps = topologyContext?.knownInfrastructure;
  if (deps?.length) {
    return `No correlated infra issues in scan (monitored: ${deps.join(', ')}).`;
  }
  return 'No correlated infra issues detected in the pipeline scan.';
}

/**
 * @param {Array<{ tool: string, prefilledArgs?: Record<string, unknown> }>} followUps
 * @param {PipelineStatus} status
 */
function buildNextSteps(followUps, status) {
  if (status === 'error' || status === 'timeout') {
    return ['Fix pipeline connectivity (`npm run check`) then re-run the same incident query.'];
  }
  if (!followUps?.length) {
    if (status === 'no_explicit_errors') {
      return [
        'Widen the incident time window or add a service keyword from config/dependency-map.json.',
      ];
    }
    return ['No gated follow-up tools suggested; continue manual investigation on dependent services.'];
  }
  return followUps.map((f) => {
    const args = f.prefilledArgs ? JSON.stringify(f.prefilledArgs) : '{}';
    return `Run \`${f.tool}\` with ${args}`;
  });
}

/**
 * Build deterministic incident markdown from pipeline JSON fields.
 * @param {Object} payload
 * @param {PipelineStatus} payload.status
 * @param {'HIGH'|'MEDIUM'|'LOW'} payload.confidenceScore
 * @param {Array<{ logGroup: string, timestamp: string, signals?: string[], snippet: string }>} payload.topBlocks
 * @param {{ correlated?: boolean, findings?: string[] }} payload.infrastructureContext
 * @param {Array<{ tool: string, prefilledArgs?: Record<string, unknown> }>} payload.suggestedFollowUps
 * @param {{ primaryTarget?: string, knownInfrastructure?: string[] }} [payload.topologyContext]
 * @param {string} [payload.message]
 */
export function buildDraftRcaMarkdown(payload) {
  const rca = buildRcaBullets(payload);
  const infra = buildInfraBullet(payload);
  const steps = buildNextSteps(payload.suggestedFollowUps, payload.status);
  const stepsLines = steps.map((s, i) => `${i + 1}.  ${s}`).join('\n');

  return `🚨 **SRE Incident Report** 🚨
**Status:** ${statusLabel(payload.status)}
**Confidence:** ${payload.confidenceScore}

### 🔍 Root Cause Analysis
*   ${rca[0]}
*   ${rca[1]}
*   ${rca[2]}

### 🏗️ Infrastructure Context
*   ${infra}

### 🛠️ Next Steps
${stepsLines}
`;
}
