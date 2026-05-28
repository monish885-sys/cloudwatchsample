#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getMiniTools, buildToolExecutors, initToolGate, primaryToolName } from './tools/registry-mini.js';
import { assertValidArgs } from './lib/validate.js';
import { jsonTextContent } from './lib/response.js';
import { emitPayload } from './lib/pipeline/emit-payload.js';
import { resolveTopologyContext } from './lib/resolve-topology-context.js';
import { loadDependencyMap } from './lib/config.js';
import { validateSecondaryInvoke } from './lib/tool-gate.js';

export { resolveTopologyContext, loadDependencyMap };

initToolGate();

const tools = getMiniTools();
const executors = buildToolExecutors();

const server = new Server(
  { name: 'cloudwatch-mcp-mini', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.definition.name,
    description: t.definition.description,
    inputSchema: t.definition.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = executors[name];

  if (!tool) {
    return jsonTextContent(
      emitPayload({
        status: 'error',
        message: `Unknown tool: ${name}`,
        topBlocks: [],
        phasesExecuted: [],
      }),
    );
  }

  try {
    assertValidArgs(args || {}, tool.definition.inputSchema);

    if (name !== primaryToolName) {
      validateSecondaryInvoke(name, args || {}, 'default');
    }

    let result;
    if (name === primaryToolName) {
      result = await tool.execute(args || {}, { toolExecutors: executors, sessionId: 'default' });
    } else {
      result = await tool.execute(args || {});
    }

    return jsonTextContent(result);
  } catch (err) {
    if (name === primaryToolName) {
      return jsonTextContent(
        emitPayload({
          status: 'error',
          message: err?.message || String(err),
          topBlocks: [],
          phasesExecuted: [],
        }),
      );
    }
    return jsonTextContent({ status: 'error', message: err?.message || String(err) });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
