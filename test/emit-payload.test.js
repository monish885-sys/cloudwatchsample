import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitPayload, resolveStatus } from '../lib/pipeline/emit-payload.js';

function mockBlock(score, snippetBytes) {
  const snippet = 'x'.repeat(snippetBytes);
  return {
    score,
    logGroup: '/eks/prod/test',
    timestamp: '2026-05-25T10:00:00.000Z',
    signals: ['ERROR'],
    snippet,
  };
}

describe('emit-payload', () => {
  it('schema 1.2 fields present including draftRcaMarkdown', () => {
    const p = emitPayload({
      status: 'success',
      topBlocks: [{ score: 50, logGroup: 'g', timestamp: '2026-05-25T10:00:00Z', signals: [], snippet: 'err' }],
      phasesExecuted: ['phase1'],
      payloadMetrics: { eventsScanned: 1, blocksDiscarded: 0, blocksReturned: 1 },
    });
    assert.equal(p.schemaVersion, '1.2');
    assert.equal(p.status, 'success');
    assert.equal(p.confidenceScore, 'MEDIUM');
    assert.ok(typeof p.draftRcaMarkdown === 'string' && p.draftRcaMarkdown.length > 0);
  });

  it('includes topologyContext when provided', () => {
    const p = emitPayload({
      status: 'success',
      topBlocks: [],
      phasesExecuted: ['phase1_topology_resolve'],
      topologyContext: {
        primaryTarget: 'ai-tutor-service',
        logGroupPrefix: '/aws/containerinsights/ai-tutor-service/',
        knownDownstreamDependencies: ['auth-service'],
        knownInfrastructure: ['Redis'],
        scopedLogGroupPrefixes: ['/aws/containerinsights/ai-tutor-service/'],
      },
    });
    assert.deepEqual(p.topologyContext, {
      primaryTarget: 'ai-tutor-service',
      knownDownstreamDependencies: ['auth-service'],
      knownInfrastructure: ['Redis'],
    });
    assert.equal(p.topologyContext.scopedLogGroupPrefixes, undefined);
  });

  it('partial status via resolveStatus', () => {
    assert.equal(
      resolveStatus({ infraTimedOut: true, hasAppData: true, topBlocks: [{ score: 30 }] }),
      'partial',
    );
  });

  it('no_explicit_errors includes message', () => {
    const p = emitPayload({
      status: 'no_explicit_errors',
      topBlocks: [],
      phasesExecuted: [],
    });
    assert.equal(p.status, 'no_explicit_errors');
    assert.ok(p.message.includes('0 error signatures'));
  });

  it('caps 11 blocks to 10', () => {
    const blocks = Array.from({ length: 11 }, (_, i) => ({
      score: 50 + i,
      logGroup: 'g',
      timestamp: '2026-05-25T10:00:00Z',
      signals: ['ERROR'],
      snippet: `block-${i}`,
    }));
    const p = emitPayload({ status: 'success', topBlocks: blocks, phasesExecuted: [] });
    assert.ok(p.topBlocks.length <= 10);
  });

  it('enforces 50KB total snippet budget', () => {
    const blocks = Array.from({ length: 8 }, () => mockBlock(50, 9000));
    const p = emitPayload({ status: 'success', topBlocks: blocks, phasesExecuted: [] });
    const total = p.topBlocks.reduce((s, b) => s + Buffer.byteLength(b.snippet, 'utf8'), 0);
    assert.ok(total <= 51200);
  });
});
