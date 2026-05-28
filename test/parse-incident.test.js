import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseIncident,
  extractTraceId,
  matchServiceCatalog,
  parseWidenHoursHint,
} from '../lib/parse-incident.js';
import { clearDependencyMapCache } from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dependencyMap = JSON.parse(
  readFileSync(resolve(__dirname, '../config/dependency-map.json'), 'utf8'),
);

const catalog = {
  defaultPrefix: '/eks/prod/default/',
  services: [
    { keywords: ['user', 'user-service'], logGroupPrefix: '/eks/prod/default/user-service/' },
    { keywords: ['payment'], logGroupPrefix: '/eks/prod/default/payment-service/' },
  ],
};

describe('parse-incident', () => {
  it('detects trace → trace mode exact 6h', () => {
    const trace = 'a1b2c3d4e5f6789012345678901234ab';
    const plan = parseIncident(`errors for trace ${trace}`);
    assert.equal(plan.mode, 'trace');
    assert.equal(plan.traceId, trace);
    assert.equal(plan.hoursBack, 6);
    assert.equal(plan.scanMode, 'exact');
    assert.ok(plan.filterPattern.includes(trace));
  });

  it('detects UUID trace', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    assert.equal(extractTraceId(`id ${uuid}`), uuid);
  });

  it('no trace → broad 15m insights', () => {
    const plan = parseIncident('API is 500ing');
    assert.equal(plan.mode, 'broad');
    assert.equal(plan.hoursBack, 0.25);
    assert.ok(['insights', 'auto'].includes(plan.scanMode));
  });

  it('catalog keyword → prefix', () => {
    const m = matchServiceCatalog('payment service failing', catalog);
    assert.equal(m.logGroupPrefix, '/eks/prod/default/payment-service/');
    const plan = parseIncident('payment checkout error');
    assert.equal(plan.logGroupPrefix, '/eks/prod/default/payment-service/');
  });

  it('custom hours hint overrides broad window', () => {
    assert.equal(parseWidenHoursHint('errors in last 2h'), 2);
    const plan = parseIncident('user API errors last 2h');
    assert.equal(plan.mode, 'broad');
    assert.equal(plan.hoursBack, 2);
  });

  it('broad + dependency map → scoped prefixes', () => {
    clearDependencyMapCache(dependencyMap);
    const plan = parseIncident('ai-tutor-service errors');
    assert.equal(plan.mode, 'broad');
    assert.equal(plan.matchedService, 'ai-tutor-service');
    assert.ok(plan.scopedLogGroupPrefixes?.length >= 4);
    assert.equal(plan.topologyContext?.primaryTarget, 'ai-tutor-service');
    clearDependencyMapCache(null);
  });

  it('trace id bypasses topology map', () => {
    clearDependencyMapCache(dependencyMap);
    const trace = 'a1b2c3d4e5f6789012345678901234ab';
    const plan = parseIncident(`ai-tutor-service trace ${trace}`);
    assert.equal(plan.mode, 'trace');
    assert.equal(plan.topologyContext, null);
    assert.equal(plan.scopedLogGroupPrefixes, undefined);
    clearDependencyMapCache(null);
  });
});
