import * as sreRunPipeline from './sre-run-pipeline.js';
import * as traceLogs from './trace-logs.js';
import * as k8sEvents from './k8s-events.js';
import * as k8sPods from './k8s-pods.js';
import * as infraLogs from './infra-logs.js';
import * as infraMetrics from './infra-metrics.js';
import * as scanErrors from './scan-errors.js';
import { registerToolSchemas } from '../lib/tool-gate.js';

const tools = [
  sreRunPipeline,
  traceLogs,
  k8sEvents,
  k8sPods,
  infraLogs,
  infraMetrics,
  scanErrors,
];

export function getMiniTools() {
  return tools.map((t) => ({
    definition: t.definition,
    execute: t.execute,
  }));
}

export function buildToolExecutors() {
  const map = {};
  for (const t of tools) {
    map[t.definition.name] = t;
  }
  return map;
}

export function initToolGate() {
  const schemas = {};
  for (const t of tools) {
    schemas[t.definition.name] = t.definition.inputSchema;
  }
  registerToolSchemas(schemas);
}

export const primaryToolName = 'sre_run_pipeline';
