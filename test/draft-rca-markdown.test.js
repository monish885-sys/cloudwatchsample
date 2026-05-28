import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDraftRcaMarkdown } from '../lib/pipeline/draft-rca-markdown.js';
import { emitPayload } from '../lib/pipeline/emit-payload.js';

describe('draft-rca-markdown', () => {
  it('includes fixed report sections', () => {
    const md = buildDraftRcaMarkdown({
      status: 'success',
      confidenceScore: 'HIGH',
      topBlocks: [
        {
          score: 80,
          logGroup: '/eks/prod/payments-api/',
          timestamp: '2026-05-25T10:00:00.000Z',
          signals: ['ERROR', '500'],
          snippet: 'ERROR payments handler returned 500 Internal Server Error',
        },
      ],
      infrastructureContext: { correlated: false, findings: [] },
      suggestedFollowUps: [],
      topologyContext: { primaryTarget: 'payments-api' },
    });
    assert.match(md, /🚨 \*\*SRE Incident Report\*\* 🚨/);
    assert.match(md, /\*\*Status:\*\* success/);
    assert.match(md, /\*\*Confidence:\*\* HIGH/);
    assert.match(md, /### 🔍 Root Cause Analysis/);
    assert.match(md, /payments-api/);
    assert.match(md, /500 Internal Server Error/);
  });

  it('no_explicit_errors uses insufficient-evidence bullets', () => {
    const md = buildDraftRcaMarkdown({
      status: 'no_explicit_errors',
      confidenceScore: 'LOW',
      topBlocks: [],
      infrastructureContext: { correlated: false, findings: [] },
      suggestedFollowUps: [],
      topologyContext: { primaryTarget: 'ai-tutor-service' },
      message: 'Pipeline found 0 error signatures in app logs.',
    });
    assert.match(md, /\*\*Status:\*\* no explicit errors/);
    assert.match(md, /No hard error signatures/);
    assert.match(md, /ai-tutor-service/);
  });

  it('emitPayload attaches draftRcaMarkdown on schema 1.2', () => {
    const p = emitPayload({
      status: 'no_explicit_errors',
      topBlocks: [],
      phasesExecuted: [],
    });
    assert.equal(p.schemaVersion, '1.2');
    assert.ok(typeof p.draftRcaMarkdown === 'string');
    assert.ok(p.draftRcaMarkdown.length > 50);
    assert.match(p.draftRcaMarkdown, /SRE Incident Report/);
  });
});
