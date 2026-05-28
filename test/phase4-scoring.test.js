import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { phase4ChunkScore, groupEventsIntoBlocks } from '../lib/pipeline/phase4-chunk-score.js';

describe('phase4-scoring', () => {
  it('trace ID in block scores +100 and ranks high', () => {
    const trace = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const report = {
      events: [
        {
          timestamp: '2026-05-25T10:00:00.000Z',
          logGroup: '/eks/prod/a',
          message: `traceId=${trace} NullPointerException in handler`,
        },
      ],
    };
    const { topBlocks } = phase4ChunkScore(report, { userTraceId: trace });
    assert.ok(topBlocks.length >= 1);
    assert.ok(topBlocks[0].score >= 100);
  });

  it('INFO-only block dropped (score <= 0)', () => {
    const report = {
      events: [
        {
          timestamp: '2026-05-25T10:00:00.000Z',
          logGroup: '/eks/prod/a',
          message: 'INFO HealthCheck ok',
        },
      ],
    };
    const { topBlocks, blocksDiscarded } = phase4ChunkScore(report, {});
    assert.equal(topBlocks.length, 0);
    assert.ok(blocksDiscarded >= 1);
  });

  it('cross-service same trace +20', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const report = {
      events: [
        {
          timestamp: '2026-05-25T10:00:00.000Z',
          logGroup: '/eks/prod/a',
          message: `requestId=${id} ERROR connection failed`,
        },
        {
          timestamp: '2026-05-25T10:00:01.000Z',
          logGroup: '/eks/prod/b',
          message: `requestId=${id} ERROR downstream`,
        },
      ],
    };
    const { topBlocks } = phase4ChunkScore(report, {});
    assert.ok(topBlocks[0].score >= 50);
  });

  it('stack lines grouped via groupEventsIntoBlocks', () => {
    const events = [
      {
        timestamp: '2026-05-25T10:00:00.000Z',
        logGroup: '/eks/prod/a',
        message: 'ERROR java.lang.RuntimeException: boom',
      },
      {
        timestamp: '2026-05-25T10:00:00.100Z',
        logGroup: '/eks/prod/a',
        message: '    at com.example.Handler.run(Handler.java:42)',
      },
    ];
    const blocks = groupEventsIntoBlocks(events);
    const combined = blocks.some((b) => b.lines.length >= 2);
    assert.ok(combined);
  });
});
