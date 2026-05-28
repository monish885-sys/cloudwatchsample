import { config, loadDependencyMap, loadServiceCatalog } from './config.js';
import { resolveTopologyContext } from './resolve-topology-context.js';

const TRACE_HEX = /\b[a-f0-9]{32}\b/i;
const TRACE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const BROAD_FILTER = '?ERROR ?Exception ?fail ?REJECT ?CRITICAL ?5xx';
const HOURS_HINT = /(?:last\s+)?(\d+(?:\.\d+)?)\s*h(?:ours?)?|hours?\s+back\s+(\d+(?:\.\d+)?)/i;

/**
 * @param {string} text
 * @returns {string|undefined}
 */
export function extractTraceId(text) {
  if (!text) return undefined;
  const uuid = text.match(TRACE_UUID);
  if (uuid) return uuid[0];
  const hex = text.match(TRACE_HEX);
  if (hex) return hex[0];
  return undefined;
}

/**
 * @param {string} text
 * @param {import('./config.js').loadServiceCatalog extends Function ? ReturnType<typeof loadServiceCatalog> : object} catalog
 */
export function matchServiceCatalog(text, catalog) {
  const lower = (text || '').toLowerCase();
  let best = null;
  let bestLen = 0;

  for (const svc of catalog?.services || []) {
    for (const kw of svc.keywords || []) {
      const k = kw.toLowerCase();
      if (lower.includes(k) && k.length > bestLen) {
        bestLen = k.length;
        best = { matchedService: kw, logGroupPrefix: svc.logGroupPrefix };
      }
    }
  }

  if (best) return best;
  return {
    matchedService: undefined,
    logGroupPrefix: catalog?.defaultPrefix || config.defaultLogPrefix,
  };
}

/**
 * @param {string} text
 * @returns {number|undefined}
 */
export function parseWidenHoursHint(text) {
  const m = (text || '').match(HOURS_HINT);
  if (!m) return undefined;
  const val = parseFloat(m[1] || m[2]);
  return Number.isFinite(val) && val > 0 ? val : undefined;
}

/**
 * @typedef {Object} RoutingPlan
 * @property {'trace'|'broad'} mode
 * @property {string} [traceId]
 * @property {string} logGroupPrefix
 * @property {number} hoursBack
 * @property {string} filterPattern
 * @property {'exact'|'insights'|'auto'} scanMode
 * @property {string} [matchedService]
 * @property {import('./config.js').TopologyContext|null} [topologyContext]
 * @property {string[]} [scopedLogGroupPrefixes]
 */

/**
 * @param {string} query
 * @returns {RoutingPlan}
 */
export function parseIncident(query) {
  const traceId = extractTraceId(query);
  let topologyContext = null;
  let logGroupPrefix;
  let matchedService;
  let scopedLogGroupPrefixes;

  if (!traceId) {
    const dependencyMap = loadDependencyMap();
    topologyContext = resolveTopologyContext(query, dependencyMap);
    if (topologyContext) {
      matchedService = topologyContext.primaryTarget;
      logGroupPrefix = topologyContext.logGroupPrefix;
      scopedLogGroupPrefixes = topologyContext.scopedLogGroupPrefixes;
    }
  }

  if (!logGroupPrefix) {
    const catalog = loadServiceCatalog();
    const match = matchServiceCatalog(query, catalog);
    logGroupPrefix = match.logGroupPrefix;
    matchedService = match.matchedService;
  }

  if (traceId) {
    return {
      mode: 'trace',
      traceId,
      logGroupPrefix,
      hoursBack: 6,
      filterPattern: `"${traceId}"`,
      scanMode: 'exact',
      matchedService,
      topologyContext: null,
    };
  }

  const hintHours = parseWidenHoursHint(query);
  const envMode = config.scanMode;
  let scanMode = /** @type {'exact'|'insights'|'auto'} */ ('insights');
  if (envMode === 'exact' || envMode === 'insights') scanMode = envMode;
  else if (envMode === 'auto') scanMode = 'auto';

  return {
    mode: 'broad',
    logGroupPrefix,
    hoursBack: hintHours ?? 0.25,
    filterPattern: BROAD_FILTER,
    scanMode,
    matchedService,
    topologyContext,
    scopedLogGroupPrefixes,
  };
}
