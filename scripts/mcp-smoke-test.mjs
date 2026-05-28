#!/usr/bin/env node
import Ajv from 'ajv';
import { execute } from '../tools/sre-run-pipeline.js';
import { setRemoteOverride, clearRemoteOverride } from '../lib/remote.js';

const schema = {
  type: 'object',
  required: [
    'schemaVersion',
    'status',
    'confidenceScore',
    'phasesExecuted',
    'payloadMetrics',
    'topBlocks',
    'infrastructureContext',
    'suggestedFollowUps',
    'draftRcaMarkdown',
  ],
  properties: {
    schemaVersion: { const: '1.2' },
    draftRcaMarkdown: { type: 'string', minLength: 1 },
    status: { enum: ['success', 'no_explicit_errors', 'partial', 'error', 'timeout'] },
    confidenceScore: { enum: ['HIGH', 'MEDIUM', 'LOW'] },
    topBlocks: { type: 'array' },
    infrastructureContext: {
      type: 'object',
      required: ['correlated', 'findings'],
    },
    suggestedFollowUps: { type: 'array' },
  },
};

setRemoteOverride(async () => ({
  stdout: '',
  stderr: '',
  exitCode: 0,
  timedOut: false,
}));

try {
  const payload = await execute({ query: 'test' });
  const ajv = new Ajv();
  const valid = ajv.validate(schema, payload);
  if (!valid) {
    console.error('Schema validation failed:', ajv.errors);
    process.exit(1);
  }
  console.log('Smoke test OK:', payload.status, payload.confidenceScore);
} finally {
  clearRemoteOverride();
}
