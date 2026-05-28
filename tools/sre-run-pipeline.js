import { config } from '../lib/config.js';
import { parseIncident } from '../lib/parse-incident.js';
import { phase2Fetch } from '../lib/pipeline/phase2-fetch.js';
import { phase3Infra } from '../lib/pipeline/phase3-infra.js';
import { phase4ChunkScore } from '../lib/pipeline/phase4-chunk-score.js';
import { emitPayload, resolveStatus } from '../lib/pipeline/emit-payload.js';
import { suggestedFollowUps } from '../lib/signal-followups.js';
import { setLastFollowUps } from '../lib/tool-gate.js';
import { extractTraceId } from '../lib/parse-incident.js';

export const definition = {
  name: 'sre_run_pipeline',
  description:
    'Deterministic SRE pipeline: parse intent, fetch logs with widen/fallback, correlate infra, score and return JSON schema 1.2 (includes draftRcaMarkdown). Pass raw user incident text only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Raw user incident message' },
    },
    required: ['query'],
  },
};

/**
 * @param {{ query: string }} args
 * @param {{ toolExecutors?: Record<string, { execute: Function }>, sessionId?: string }} [ctx]
 */
export async function execute(args, ctx = {}) {
  const pipelineStart = Date.now();
  const phasesExecuted = [];
  const totalBudget = config.pipelineTotalBudgetMs;

  const checkTotalTimeout = () => Date.now() - pipelineStart >= totalBudget;

  let plan;
  try {
    plan = parseIncident(args.query);
    phasesExecuted.push('phase1_parse_incident');
    if (plan.topologyContext) {
      phasesExecuted.push('phase1_topology_resolve');
    }
  } catch (err) {
    return emitPayload({
      status: 'error',
      message: err.message,
      phasesExecuted,
      topBlocks: [],
    });
  }

  if (checkTotalTimeout()) {
    return emitPayload({
      status: 'timeout',
      message: 'Pipeline exceeded total budget before phase 2',
      phasesExecuted,
      topBlocks: [],
    });
  }

  let phase2;
  try {
    phase2 = await phase2Fetch(plan, {
      appBudgetMs: config.pipelineAppBudgetMs,
      startedAt: pipelineStart,
      perCallTimeoutMs: config.execTimeoutMs,
    });
    phasesExecuted.push(...(phase2.phasesExecuted || []));
  } catch (err) {
    return emitPayload({
      status: 'error',
      message: err.message,
      phasesExecuted,
      topBlocks: [],
    });
  }

  if (phase2.hardError) {
    return emitPayload({
      status: 'error',
      message: phase2.error,
      phasesExecuted,
      topBlocks: [],
    });
  }

  if (checkTotalTimeout()) {
    return emitPayload({
      status: 'timeout',
      message: 'Pipeline exceeded 120s total budget',
      phasesExecuted,
      topBlocks: [],
      payloadMetrics: { eventsScanned: phase2.eventsScanned ?? 0 },
    });
  }

  const report = phase2.report;
  let infrastructureContext = { correlated: false, findings: [] };
  let infraTimedOut = false;

  const infraBudgetRemaining =
    config.pipelineInfraBudgetMs -
    Math.max(0, Date.now() - pipelineStart - config.pipelineAppBudgetMs);

  if (!checkTotalTimeout() && infraBudgetRemaining > 0) {
    const phase3 = await phase3Infra(
      report,
      {
        infraBudgetMs: Math.min(config.pipelineInfraBudgetMs, infraBudgetRemaining),
        startedAt: Date.now(),
        namespace: config.k8sNamespace,
      },
      ctx.toolExecutors || {},
    );
    phasesExecuted.push(...(phase3.phasesExecuted || []));
    infrastructureContext = phase3.infrastructureContext;
    infraTimedOut = phase3.infraTimedOut;
  }

  const userTraceId = plan.traceId || extractTraceId(args.query);
  const phase4 = phase4ChunkScore(report, { userTraceId });

  const followUps = suggestedFollowUps(report, {
    traceId: userTraceId,
    logGroupPrefix: plan.logGroupPrefix,
  });

  if (ctx.sessionId !== undefined) {
    setLastFollowUps(ctx.sessionId, followUps);
  } else {
    setLastFollowUps('default', followUps);
  }

  const hasAppData = (phase2.eventsScanned ?? 0) > 0;
  const status = resolveStatus({
    hardError: false,
    totalTimedOut: checkTotalTimeout(),
    infraTimedOut,
    statusHint: phase2.statusHint,
    topBlocks: phase4.topBlocks,
    infraFindings: infrastructureContext.findings,
    hasAppData,
  });

  return emitPayload({
    status,
    topBlocks: phase4.topBlocks,
    infrastructureContext,
    phasesExecuted,
    payloadMetrics: {
      eventsScanned: phase2.eventsScanned ?? 0,
      blocksDiscarded: phase4.blocksDiscarded,
      blocksReturned: phase4.blocksReturned,
    },
    suggestedFollowUps: followUps,
    matchedService: plan.matchedService,
    topologyContext: plan.topologyContext,
    message:
      status === 'no_explicit_errors'
        ? 'Pipeline found 0 error signatures in app logs. Suspect logical bug or silent failure.'
        : checkTotalTimeout()
          ? 'Pipeline exceeded total time budget'
          : undefined,
  });
}
