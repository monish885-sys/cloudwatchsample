#!/usr/bin/env node
import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execute as runPipeline } from './tools/sre-run-pipeline.js';
import { config, loadDependencyMap } from './lib/config.js';
import { buildToolExecutors } from './tools/registry-mini.js';

const app = express();
const port = Number(process.env.WEB_PORT || 3000);
const responseMode = (process.env.CHAT_RESPONSE_MODE || 'OPENAI_SUMMARY').toUpperCase();
const openAIModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const openAITimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
const memoryTurns = Number(process.env.CHAT_MEMORY_TURNS || 5);
const memoryStore = new Map();
const toolExecutors = buildToolExecutors();

const promptPresets = JSON.parse(
  readFileSync(resolve(config.rootDir, './config/prompt-presets.json'), 'utf8'),
);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(resolve(config.rootDir, './public')));

function buildOrgPromptPresets() {
  try {
    const map = loadDependencyMap();
    const services = (map.groups || []).flatMap((g) => g.services || []);
    const topServices = services.slice(0, 10).map((s) => s.name);
    const seeded = [
      'teacher-dashboard-service 400 on listSectionSubjectsWithTaskStatusCount',
      'auth-service latency spike for login APIs in last 30m',
      'ai-tutor-service errors after OpenAI calls',
    ];
    const generated = topServices.slice(0, 6).map((name) => `Investigate error rate increase in ${name}`);
    return [...new Set([...seeded, ...generated])].slice(0, 10);
  } catch {
    return promptPresets.predefinedPrompts || [];
  }
}

const orgPredefinedPrompts = buildOrgPromptPresets();

function normalizeSuggestedPrompts(payload) {
  const toolPrompts = (payload.suggestedFollowUps || [])
    .map((item) => item?.label || item?.reason || item?.tool || '')
    .filter(Boolean)
    .slice(0, 5);
  if (toolPrompts.length > 0) return toolPrompts;
  return promptPresets.fallbackSuggestedPrompts || [];
}

function getSessionMessages(sessionId) {
  return memoryStore.get(sessionId) || [];
}

function appendSessionTurn(sessionId, userMessage, assistantMessage) {
  const turns = getSessionMessages(sessionId);
  turns.push({ role: 'user', content: userMessage });
  turns.push({ role: 'assistant', content: assistantMessage });
  const keep = Math.max(1, memoryTurns) * 2;
  memoryStore.set(sessionId, turns.slice(-keep));
}

async function callOpenAIWithRetry({ sessionId, prompt, payload }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when CHAT_RESPONSE_MODE=OPENAI_SUMMARY');
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), openAITimeoutMs);
      const messages = [
        {
          role: 'system',
          content: [
            'You are an SRE copilot.',
            'Use provided pipeline and MCP follow-up tool results as source of truth.',
            'Return strictly structured markdown with these sections in order:',
            '1) 🚨 SRE Incident Report',
            '2) Incident Summary',
            '3) ### 🔍 Root Cause Analysis',
            '4) ### 🏗️ Infrastructure Context',
            '5) ### 🧰 MCP Tool Calls Executed',
            '6) ### Flow Diagram Steps (numbered, each step title in **bold**)',
            '7) ### ✅ Next Actions',
            'Do not include raw AWS CLI commands.',
            'When evidence is missing, say explicitly "insufficient log evidence".',
          ].join(' '),
        },
        ...getSessionMessages(sessionId),
        {
          role: 'user',
          content: [
            `User incident: ${prompt}`,
            '',
            'Pipeline JSON (authoritative):',
            JSON.stringify(payload),
          ].join('\n'),
        },
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: openAIModel,
          temperature: 0.2,
          messages,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI request failed (${response.status}): ${text.slice(0, 400)}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('OpenAI returned empty response text');
      }
      return {
        text: content,
        model: data.model || openAIModel,
        usage: data.usage || null,
      };
    } catch (err) {
      lastError = err;
      if (attempt === 2) break;
    }
  }
  throw lastError;
}

async function executeFollowUpTools(payload, sessionId, sendLog = null) {
  const followUps = payload.suggestedFollowUps || [];
  const results = [];
  for (const item of followUps) {
    const toolName = item?.tool;
    const args = item?.prefilledArgs || {};
    const exec = toolExecutors[toolName];
    if (!toolName || !exec || typeof exec.execute !== 'function') {
      results.push({ tool: toolName || 'unknown', args, error: 'Tool executor unavailable' });
      continue;
    }
    try {
      sendLog?.(`Running MCP follow-up: ${toolName}`);
      const output = await exec.execute(args, { toolExecutors, sessionId });
      results.push({ tool: toolName, args, output });
      sendLog?.(`Completed MCP follow-up: ${toolName}`);
    } catch (err) {
      results.push({ tool: toolName, args, error: err?.message || String(err) });
      sendLog?.(`MCP follow-up failed: ${toolName}`);
    }
  }
  return results;
}

app.get('/api/presets', (_req, res) => {
  res.json({
    predefinedPrompts: orgPredefinedPrompts,
    fallbackSuggestedPrompts: promptPresets.fallbackSuggestedPrompts || [],
  });
});

app.post('/api/chat', async (req, res) => {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const prompt = String(req.body?.message || '').trim();
  const sessionId = String(req.body?.sessionId || 'anon');

  if (!prompt) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const payload = await runPipeline({ query: prompt }, { toolExecutors, sessionId });
    const followUpResults = await executeFollowUpTools(payload, sessionId);
    const suggestedPrompts = normalizeSuggestedPrompts(payload);

    let answerText = payload.draftRcaMarkdown;
    let llmMeta = null;
    if (responseMode === 'OPENAI_SUMMARY') {
      const completion = await callOpenAIWithRetry({
        sessionId,
        prompt,
        payload: { ...payload, followUpToolResults: followUpResults },
      });
      answerText = completion.text;
      llmMeta = { model: completion.model, usage: completion.usage };
    }

    appendSessionTurn(sessionId, prompt, answerText);

    const durationMs = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'chat_request',
        requestId,
        sessionId,
        durationMs,
        mode: responseMode,
        status: payload.status,
        model: llmMeta?.model || null,
        usage: llmMeta?.usage || null,
      }),
    );

    return res.json({
      requestId,
      sessionId,
      mode: responseMode,
      answer: answerText,
      pipeline: payload,
      followUpToolResults: followUpResults,
      suggestedPrompts,
      usage: llmMeta?.usage || null,
      model: llmMeta?.model || null,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'chat_error',
        requestId,
        sessionId,
        durationMs,
        mode: responseMode,
        message: err?.message || String(err),
      }),
    );
    return res.status(500).json({ error: err?.message || 'Internal server error' });
  }
});

app.post('/api/chat/stream', async (req, res) => {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const prompt = String(req.body?.message || '').trim();
  const sessionId = String(req.body?.sessionId || 'anon');
  if (!prompt) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent('log', { message: 'Request received. Starting deterministic pipeline.' });
    const payload = await runPipeline({ query: prompt }, { toolExecutors, sessionId });
    sendEvent('log', {
      message: `Pipeline complete. Status=${payload.status}, confidence=${payload.confidenceScore}.`,
    });
    sendEvent('log', {
      message: `Pipeline suggested ${payload.suggestedFollowUps?.length || 0} MCP follow-up calls.`,
    });

    const followUpResults = await executeFollowUpTools(payload, sessionId, (line) =>
      sendEvent('log', { message: line }),
    );
    sendEvent('log', {
      message: `MCP follow-up phase complete. Executed ${followUpResults.length} calls.`,
    });

    const suggestedPrompts = normalizeSuggestedPrompts(payload);
    let answerText = payload.draftRcaMarkdown;
    let llmMeta = null;

    if (responseMode === 'OPENAI_SUMMARY') {
      sendEvent('log', { message: 'Formatting response with OpenAI model.' });
      const completion = await callOpenAIWithRetry({
        sessionId,
        prompt,
        payload: { ...payload, followUpToolResults: followUpResults },
      });
      answerText = completion.text;
      llmMeta = { model: completion.model, usage: completion.usage };
      sendEvent('log', {
        message: `OpenAI response complete. Model=${llmMeta.model || openAIModel}.`,
      });
    } else {
      sendEvent('log', { message: 'Using raw pipeline draftRcaMarkdown output.' });
    }

    appendSessionTurn(sessionId, prompt, answerText);

    const chunkSize = 120;
    for (let i = 0; i < answerText.length; i += chunkSize) {
      const chunk = answerText.slice(i, i + chunkSize);
      sendEvent('chunk', { chunk });
    }

    const durationMs = Date.now() - startedAt;
    sendEvent('log', { message: `Done in ${durationMs}ms.` });
    sendEvent('done', {
      done: true,
      requestId,
      sessionId,
      mode: responseMode,
      suggestedPrompts,
      model: llmMeta?.model || null,
      usage: llmMeta?.usage || null,
      pipelineStatus: payload.status,
      confidenceScore: payload.confidenceScore,
      primaryTarget: payload.topologyContext?.primaryTarget || null,
      followUpCalls: followUpResults.length,
      durationMs,
    });
    res.end();
  } catch (err) {
    sendEvent('log', { message: 'Request failed. Check error details below.' });
    sendEvent('done', { error: err?.message || String(err), done: true });
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Web chat server listening on http://localhost:${port}`);
});
