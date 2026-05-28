import { detectSignals } from '../format-brief.js';
import { getEffectiveCaps } from '../config.js';

const ID_PATTERNS = [
  /traceId[=:]\s*([a-f0-9-]{32,36})/i,
  /requestId[=:]\s*([a-f0-9-]{32,36})/i,
  /correlationId[=:]\s*([a-f0-9-]{32,36})/i,
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/i,
  /\b([a-f0-9]{32})\b/i,
];

function extractIds(message) {
  const ids = new Set();
  for (const re of ID_PATTERNS) {
    const m = message.match(re);
    if (m?.[1]) ids.add(m[1].toLowerCase());
  }
  return [...ids];
}

function scoreBlock(block, ctx) {
  let score = 0;
  const text = block.lines.map((l) => l.message).join('\n');
  const signals = detectSignals(text);
  const logGroups = new Set(block.lines.map((l) => l.logGroup));

  if (ctx.userTraceId && text.toLowerCase().includes(ctx.userTraceId.toLowerCase())) {
    score += 100;
  }

  if (/Exception|FATAL/i.test(text)) score += 50;
  if (/\bERROR\b|5xx|\b500\b/i.test(text)) score += 30;
  if (logGroups.size > 1) score += 20;
  if (/^\s*(INFO|DEBUG)\b/im.test(text) && !/ERROR|Exception|FATAL|5xx/i.test(text)) {
    score -= 100;
  }
  if (/HealthCheck|health check/i.test(text) && !/ERROR|Exception/i.test(text)) {
    score -= 100;
  }

  const ts = block.lines[0]?.timestamp || new Date().toISOString();
  return {
    score,
    logGroup: block.lines[0]?.logGroup || 'unknown',
    timestamp: ts,
    signals,
    snippet: text,
    logGroups: [...logGroups],
  };
}

function truncateSnippet(snippet, maxBytes) {
  const buf = Buffer.from(snippet, 'utf8');
  if (buf.length <= maxBytes) return snippet;
  const truncated = buf.subarray(0, maxBytes - 15).toString('utf8');
  return truncated + '...[truncated]';
}

/**
 * Group events into blocks.
 * @param {Array<{ timestamp: string, logGroup: string, message: string }>} events
 */
export function groupEventsIntoBlocks(events) {
  const blocks = [];
  const byId = new Map();

  for (const ev of events) {
    const ids = extractIds(ev.message);
    let key = ids[0];
    if (!key) {
      key = `prox:${ev.logGroup}:${Math.floor(new Date(ev.timestamp).getTime() / 2000)}`;
    }
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(ev);
  }

  for (const lines of byId.values()) {
    lines.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const extended = [...lines];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s+at /.test(lines[i].message)) {
        const end = new Date(lines[i].timestamp).getTime() + 10000;
        for (const other of events) {
          if (
            other.logGroup === lines[i].logGroup &&
            new Date(other.timestamp).getTime() <= end &&
            !extended.includes(other)
          ) {
            extended.push(other);
          }
        }
      }
    }
    blocks.push({ lines: extended });
  }

  return blocks;
}

/**
 * @param {{ events?: Array<{ timestamp: string, logGroup: string, message: string }> }} report
 * @param {{ userTraceId?: string }} ctx
 */
export function phase4ChunkScore(report, ctx = {}) {
  const caps = getEffectiveCaps();
  const events = report?.events || [];
  const rawBlocks = groupEventsIntoBlocks(events);
  const scored = rawBlocks.map((b) => scoreBlock(b, ctx));
  const discarded = scored.filter((b) => b.score <= 0).length;
  const kept = scored.filter((b) => b.score > 0).sort((a, b) => b.score - a.score);

  const topBlocks = [];
  let totalBytes = 0;

  for (const block of kept) {
    if (topBlocks.length >= caps.maxBlocks) break;
    const snippet = truncateSnippet(block.snippet, caps.maxSnippetBytes);
    const snippetBytes = Buffer.byteLength(snippet, 'utf8');
    if (totalBytes + snippetBytes > caps.maxOutputBytes) break;
    topBlocks.push({
      score: block.score,
      logGroup: block.logGroup,
      timestamp: block.timestamp,
      signals: block.signals,
      snippet,
    });
    totalBytes += snippetBytes;
  }

  return {
    topBlocks,
    blocksDiscarded: discarded + (kept.length - topBlocks.length),
    blocksReturned: topBlocks.length,
    allScoredCount: scored.length,
  };
}
