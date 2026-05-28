import { getEffectiveCaps } from '../config.js';
import { toTopologyPayload } from '../resolve-topology-context.js';
import { computeConfidence } from './confidence.js';
import { buildDraftRcaMarkdown } from './draft-rca-markdown.js';

/**
 * @typedef {'success'|'no_explicit_errors'|'partial'|'error'|'timeout'} PipelineStatus
 */

/**
 * @param {Object} input
 */
export function emitPayload(input) {
  const {
    status,
    topBlocks = [],
    infrastructureContext = { correlated: false, findings: [] },
    phasesExecuted = [],
    payloadMetrics = {},
    suggestedFollowUps = [],
    topologyContext,
    message,
    hardError,
  } = input;

  const confidenceScore = computeConfidence(topBlocks, infrastructureContext);
  const caps = getEffectiveCaps();

  let finalBlocks = [...topBlocks];
  let totalBytes = finalBlocks.reduce((s, b) => s + Buffer.byteLength(b.snippet || '', 'utf8'), 0);

  while (
    (finalBlocks.length > caps.maxBlocks || totalBytes > caps.maxOutputBytes) &&
    finalBlocks.length > 0
  ) {
    finalBlocks.pop();
    totalBytes = finalBlocks.reduce((s, b) => s + Buffer.byteLength(b.snippet || '', 'utf8'), 0);
  }

  const findings = (infrastructureContext.findings || []).slice(0, 8).map((f) => String(f).slice(0, 500));

  const topology = toTopologyPayload(topologyContext);

  const payload = {
    schemaVersion: '1.2',
    status,
    confidenceScore,
    ...(topology ? { topologyContext: topology } : {}),
    phasesExecuted,
    payloadMetrics: {
      eventsScanned: payloadMetrics.eventsScanned ?? 0,
      blocksDiscarded: payloadMetrics.blocksDiscarded ?? 0,
      blocksReturned: finalBlocks.length,
    },
    topBlocks: finalBlocks,
    infrastructureContext: {
      correlated: Boolean(infrastructureContext.correlated),
      findings,
    },
    suggestedFollowUps: suggestedFollowUps.slice(0, 5),
  };

  if (input.matchedService) {
    payload.debug = { matchedService: input.matchedService };
  }

  if (message || hardError) {
    payload.message = message || hardError;
  }

  if (status === 'no_explicit_errors' && !payload.message) {
    payload.message =
      'Pipeline found 0 error signatures in app logs. Suspect logical bug or silent failure.';
  }

  // Enforce total JSON size cap
  let json = JSON.stringify(payload);
  while (Buffer.byteLength(json, 'utf8') > caps.maxOutputBytes + 2048 && finalBlocks.length > 0) {
    finalBlocks.pop();
    payload.topBlocks = finalBlocks;
    payload.payloadMetrics.blocksReturned = finalBlocks.length;
    json = JSON.stringify(payload);
  }

  payload.draftRcaMarkdown = buildDraftRcaMarkdown(payload);

  return payload;
}

/**
 * Determine final pipeline status.
 */
export function resolveStatus(ctx) {
  const {
    hardError,
    totalTimedOut,
    infraTimedOut,
    statusHint,
    topBlocks = [],
    infraFindings = [],
    hasAppData,
  } = ctx;

  if (hardError && !hasAppData) return 'error';
  if (totalTimedOut) return 'timeout';
  if (infraTimedOut && hasAppData) return 'partial';
  if (statusHint === 'no_explicit_errors' && topBlocks.length === 0 && infraFindings.length === 0) {
    return 'no_explicit_errors';
  }
  if (topBlocks.length > 0 || infraFindings.length > 0) return 'success';
  if (statusHint === 'no_explicit_errors') return 'no_explicit_errors';
  return 'success';
}
