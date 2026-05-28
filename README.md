# CloudWatch MCP (v6 Mini Profile)

Production-ready MCP server exposing **`sre_run_pipeline`** as the primary tool. Runs a four-phase server-side state machine and returns **strict JSON** (schema 1.2) including **`draftRcaMarkdown`** — the IDE agent prints that string verbatim.

## Project layout

```
cloudwatch-mcp/
├── index-mini.js          # MCP server entry (mini profile)
├── index.js               # Alias to mini profile
├── package.json
├── .env.example           # Copy to .env (not committed)
├── .cursor/mcp.json       # Cursor MCP config template
├── .cursorrules           # Synthesis agent rules for Cursor
├── config/
│   ├── dependency-map.json   # Service topology (edit for your stack)
│   └── service-catalog.json  # Legacy fallback prefixes
├── lib/                   # Pipeline, remote SSH, parsing
├── tools/                 # MCP tool handlers
├── scripts/               # smoke test, health check, SSH bootstrap
├── test/                  # Unit tests (no live SSH)
└── docs/                  # Flow diagrams and presentation notes
```

## Prerequisites

- Node.js 20+
- Two-hop SSH to a host that can run AWS CLI / kubectl (bastion → inner)
- CloudWatch log groups under your configured prefix

## Quick start

```bash
cd cloudwatch-mcp
npm run setup     # npm install, create .env if missing, run unit tests
# Edit .env with your bastion, inner host, keys, and log prefix
npm run setup -- --check   # optional: live SSH/MCP probe after .env is filled
npm run smoke     # mocked pipeline (offline)
npm start         # MCP server on stdio
```

Manual alternative: `npm install`, `cp .env.example .env`, then `npm test`.

## Environment

See `.env.example` for all variables. Required for live pipeline:

| Variable | Description |
|----------|-------------|
| `MCP_JUMP_HOST` | Bastion, e.g. `ubuntu@bastion.example.com` |
| `MCP_SSH_KEY` | Local key for bastion, e.g. `~/.ssh/bastion.pem` |
| `MCP_INNER_HOST` | Inner host from bastion, e.g. `ubuntu@10.0.1.50` |
| `MCP_INNER_SSH_KEY` | Key on bastion for inner hop, e.g. `/tmp/inner.pem` |
| `MCP_LOG_PREFIX` | Default log group prefix |
| `MCP_SCAN_MODE` | `insights`, `exact`, or `auto` |
| `MCP_SCAN_PARALLEL` | Parallelism for exact log-group scans |
| `MCP_INSIGHTS_BATCH_SIZE` | Log groups per Insights batch |
| `MCP_EXEC_TIMEOUT_MS` | Per remote call timeout |
| `MCP_MAX_BUFFER` | Max stdout/stderr bytes per remote call |

## Run MCP server

```bash
npm start
# or: node index-mini.js
```

Stdio transport — intended for Cursor / MCP clients.

## Run web chat UI (v6.1)

Minimal local web UI with preset incident prompts and dynamic suggested prompts.

```bash
npm install
npm run start:web
# open http://localhost:3000
```

Flow for web mode:

1. Browser sends incident text to `POST /api/chat`
2. Backend runs deterministic pipeline (`sre_run_pipeline`)
3. Backend returns either:
   - raw `draftRcaMarkdown` (`CHAT_RESPONSE_MODE=RAW_PIPELINE`), or
   - OpenAI-formatted response (`CHAT_RESPONSE_MODE=OPENAI_SUMMARY`)

OpenAI is called server-side only using `OPENAI_API_KEY`; frontend never receives the key.

## Enable in Cursor

1. Open this folder as the workspace.
2. `.cursor/mcp.json` is preconfigured; reload MCP servers in Cursor settings.
3. Ensure `.cursorrules` is active (project rules).
4. Create `.env` from `.env.example` before live runs.

## Smoke test

```bash
npm run smoke
```

Uses mocked remote SSH — validates JSON shape without live AWS.

## Unit tests

```bash
npm test
```

Covers parser, scoring, truncation, confidence, status routing. No live SSH required.

## Primary tool

```json
{ "query": "API is 500ing" }
```

Call via MCP tool `sre_run_pipeline`. Response is a single JSON text block (`schemaVersion: "1.2"`). The synthesis agent prints `draftRcaMarkdown` only.

### Example output (fixture)

```json
{
  "schemaVersion": "1.2",
  "status": "no_explicit_errors",
  "confidenceScore": "LOW",
  "topologyContext": {
    "primaryTarget": "ai-tutor-service",
    "knownDownstreamDependencies": ["innerscore-chatbot", "question-bank-service", "auth-service", "event-service"],
    "knownInfrastructure": ["OpenAI API", "ElevenLabs", "MongoDB", "Redis"]
  },
  "phasesExecuted": ["phase1_parse_incident", "phase1_topology_resolve", "app_fetch_insights_15m", "app_fetch_exact_fallback_15m"],
  "payloadMetrics": { "eventsScanned": 0, "blocksDiscarded": 0, "blocksReturned": 0 },
  "topBlocks": [],
  "infrastructureContext": { "correlated": false, "findings": [] },
  "suggestedFollowUps": [],
  "message": "Pipeline found 0 error signatures in app logs. Suspect logical bug or silent failure.",
  "draftRcaMarkdown": "🚨 **SRE Incident Report** 🚨\n..."
}
```

## Trace vs broad vs topology

| Mode | Detection | Fetch strategy |
|------|-----------|----------------|
| **Trace** | 32-hex or UUID in query | Exact 6h → exact 24h once if empty. **No** widen ladder. **Bypasses** dependency map. |
| **Topology (broad)** | No trace ID + service keyword in `config/dependency-map.json` | Phase 2 scans **only** the primary service log prefix and its known downstream dependencies (not a blind cluster-wide scan). |
| **Broad (fallback)** | No trace ID + no dependency match | 15m Insights → exact fallback (same window) → widen 60m → 4h on catalog/default prefix |

Phase 1 **Direction Agent** (`resolveTopologyContext`) is deterministic — no LLM. Matched topology is returned as `topologyContext` in schema 1.2 JSON; RCA markdown is built server-side in `draftRcaMarkdown`.

## Timeouts

| Budget | Default | Effect |
|--------|---------|--------|
| App phase | 90s | Stop widening; best-effort report |
| Infra phase | 30s | `partial` if app data exists |
| Total | 120s | `timeout` status |

## Status routing

| Condition | `status` |
|-----------|----------|
| SSH/AWS hard fail before useful data | `error` |
| Total > 120s | `timeout` |
| App ok, infra failed/timed out | `partial` |
| Exhausted windows, 0 signatures | `no_explicit_errors` |
| Has `topBlocks` or infra findings | `success` |

## Secondary tools

Only use tools listed in `suggestedFollowUps` with exact `prefilledArgs`:

- `search_logs_by_trace`
- `get_k8s_cluster_events`
- `get_k8s_pod_health`
- `scan_infrastructure_logs`
- `get_aws_infra_metrics`

## Manual E2E (live)

With `.env` configured:

```bash
node -e "
import { execute } from './tools/sre-run-pipeline.js';
const r = await execute({ query: 'API is 500ing' });
console.log(JSON.stringify(r, null, 2));
"
```

## Sharing this project

**Include:** source, `config/`, `docs/`, `package.json`, `package-lock.json`, `.env.example`, `.cursor/mcp.json`, `.cursorrules`, `.gitignore`

**Exclude:** `.env`, `node_modules/`, `*.pem`, `*.log`, `.DS_Store`

Recipients run `npm install`, copy `.env.example` → `.env`, and customize `config/dependency-map.json` for their services.

```bash
# Example: create a clean archive
tar -czvf cloudwatch-mcp.tar.gz \
  --exclude=node_modules --exclude=.env --exclude='*.pem' \
  -C .. cloudwatch-mcp
```

## Synthesis agent rules

See `.cursorrules` (v6) — call pipeline silently; print `draftRcaMarkdown` verbatim.

## Further reading

- [docs/SRE-MCP-FLOW-DIAGRAMS.md](docs/SRE-MCP-FLOW-DIAGRAMS.md)
- [docs/SRE-MCP-PRESENTATION.md](docs/SRE-MCP-PRESENTATION.md)
