import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeConfidence } from '../lib/pipeline/confidence.js';

describe('confidence', () => {
  it('HIGH when aggregateScore >= 100', () => {
    assert.equal(computeConfidence([{ score: 100 }], {}), 'HIGH');
  });

  it('HIGH when score >= 50 and infra correlated', () => {
    assert.equal(computeConfidence([{ score: 50 }], { correlated: true }), 'HIGH');
  });

  it('MEDIUM for score 30-99', () => {
    assert.equal(computeConfidence([{ score: 30 }], {}), 'MEDIUM');
    assert.equal(computeConfidence([{ score: 99 }], {}), 'MEDIUM');
  });

  it('LOW when aggregateScore < 30', () => {
    assert.equal(computeConfidence([{ score: 10 }], {}), 'LOW');
    assert.equal(computeConfidence([], {}), 'LOW');
  });
});
