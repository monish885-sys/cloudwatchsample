import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveTopologyContext,
  toTopologyPayload,
} from '../lib/resolve-topology-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dependencyMap = JSON.parse(
  readFileSync(resolve(__dirname, '../config/dependency-map.json'), 'utf8'),
);

describe('resolve-topology-context', () => {
  it('matches ai-tutor-service with downstream and infra', () => {
    const ctx = resolveTopologyContext('ai-tutor-service returning 500 errors', dependencyMap);
    assert.ok(ctx);
    assert.equal(ctx.primaryTarget, 'ai-tutor-service');
    assert.equal(ctx.logGroupPrefix, '/eks/prod/default/ai-tutor-service/');
    assert.ok(ctx.knownDownstreamDependencies.includes('innerscore-chatbot'));
    assert.ok(ctx.knownDownstreamDependencies.includes('auth-service'));
    assert.ok(ctx.knownInfrastructure.includes('OpenAI API'));
    assert.ok(ctx.knownInfrastructure.includes('MongoDB'));
    assert.ok(ctx.knownInfrastructure.includes('Redis'));
    assert.ok(ctx.scopedLogGroupPrefixes.length >= 4);
  });

  it('prefers longest keyword match', () => {
    const ctx = resolveTopologyContext('question-bank-service timeout', dependencyMap);
    assert.equal(ctx?.primaryTarget, 'question-bank-service');
  });

  it('returns null when no service matched', () => {
    assert.equal(resolveTopologyContext('random unrelated outage', dependencyMap), null);
  });

  it('toTopologyPayload strips internal scan fields', () => {
    const ctx = resolveTopologyContext('auth-service login failure', dependencyMap);
    const payload = toTopologyPayload(ctx);
    assert.equal(payload?.primaryTarget, 'auth-service');
    assert.ok(payload?.knownInfrastructure.includes('Redis'));
    assert.equal(payload?.scopedLogGroupPrefixes, undefined);
  });
});
