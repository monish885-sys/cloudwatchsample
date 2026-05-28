import { assertValidArgs } from './validate.js';

/** @type {Map<string, { tool: string, prefilledArgs: Record<string, unknown> }[]>} */
const sessionFollowUps = new Map();

/** @type {Record<string, object>} */
let toolSchemas = {};

export function registerToolSchemas(schemas) {
  toolSchemas = { ...schemas };
}

export function setLastFollowUps(sessionId, followUps) {
  sessionFollowUps.set(sessionId || 'default', followUps || []);
}

export function getLastFollowUps(sessionId) {
  return sessionFollowUps.get(sessionId || 'default') || [];
}

function argsMatch(expected, actual) {
  const keys = Object.keys(expected);
  if (Object.keys(actual).length !== keys.length) return false;
  for (const k of keys) {
    if (JSON.stringify(expected[k]) !== JSON.stringify(actual[k])) return false;
  }
  return true;
}

/**
 * Validate secondary tool invocation against schema and optional prefilledArgs lock.
 */
export function validateSecondaryInvoke(toolName, args, sessionId) {
  const schema = toolSchemas[toolName];
  if (!schema) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  assertValidArgs(args, schema);

  const followUps = getLastFollowUps(sessionId);
  const match = followUps.find((f) => f.tool === toolName);
  if (match && !argsMatch(match.prefilledArgs, args)) {
    throw new Error(
      `Arguments must match prefilledArgs from suggestedFollowUps for tool ${toolName}`,
    );
  }
}
