# CloudWatch MCP — Complete Flow (Diagrams Only)

---

## 1. System actors & responsibilities

```mermaid
flowchart TB
  subgraph Human["👤 Human / On-call"]
    U[Pastes raw incident text<br/>e.g. API 500ing / trace UUID / service name]
  end

  subgraph Cursor["🖥️ Cursor IDE"]
    subgraph Orchestrator["Agent A — SRE Orchestrator<br/>(Cursor chat agent)"]
      O1[Receives incident in chat]
      O2[Rule: NEVER run AWS CLI,<br/>kubectl, or SSH directly]
      O3[Calls MCP tool sre_run_pipeline<br/>query = exact user message]
      O4[Reads JSON schema 1.1 response]
      O5{status?}
      O6[error / timeout → report message only<br/>NO RCA attempt]
      O7[no_explicit_errors OR confidence LOW<br/>→ state silent failure / logical bug]
      O8[success / partial → hand off to synthesis rules]
      O9[Secondary tools ONLY if listed in<br/>suggestedFollowUps with exact prefilledArgs]
    end

    subgraph Synthesis["Agent B — Synthesis profile<br/>(gpt-4o-mini, .cursorrules)"]
      S1[Single-turn RCA writer]
      S2[Uses ONLY topBlocks +<br/>infrastructureContext.findings]
      S3[Outputs exactly 3 bullet RCA<br/>when status success/partial]
      S4[Uses topologyContext for<br/>dependency-aware narrative]
      S5[Must NOT invent log groups,<br/>windows, or filters]
    end
  end

  subgraph MCP["⚙️ cloudwatch-mcp server (Node, stdio)"]
    subgraph Server["MCP Transport — index-mini.js"]
      M1[ListTools / CallTool handler]
      M2[Primary: sre_run_pipeline]
      M3[Secondary: trace, k8s, infra tools]
      M4[Tool Gate validates secondary args<br/>against suggestedFollowUps lock]
    end

    subgraph Pipeline["Pipeline Engine — sre-run-pipeline.js<br/>(100% deterministic, NO LLM)"]
      P0[120s total budget<br/>90s app · 30s infra]
      P1[Phase 1 — Parse + Direction]
      P2[Phase 2 — App log fetch]
      P3[Phase 3 — Infra correlate]
      P4[Phase 4 — Chunk + score]
      P5[emitPayload → JSON 1.1]
    end

    subgraph Direction["Agent C — Direction Agent<br/>(Phase 1, deterministic, NO LLM)"]
      D1[resolveTopologyContext<br/>reads dependency-map.json]
      D2[Longest keyword match → primary service]
      D3[Expands downstream deps →<br/>scopedLogGroupPrefixes]
      D4[Aggregates knownInfrastructure<br/>OpenAI, MongoDB, Redis, etc.]
    end
  end

  subgraph Remote["🌐 Remote execution (two-hop SSH)"]
    R1[Local → Bastion<br/>MCP_JUMP_HOST + MCP_SSH_KEY]
    R2[Bastion → Inner host<br/>MCP_INNER_HOST + MCP_INNER_SSH_KEY]
    R3[bash -s runs CloudWatch / kubectl scripts<br/>built by buildScanCommand]
  end

  U --> O1 --> O2 --> O3
  O3 -->|stdio MCP| M1 --> M2 --> P0
  P0 --> P1 --> D1
  D1 --> D2 --> D3 --> D4
  P1 --> P2 --> P3 --> P4 --> P5
  P2 & P3 --> R1 --> R2 --> R3
  P5 -->|JSON text| O4 --> O5
  O5 -->|error/timeout| O6
  O5 -->|no errors/low conf| O7
  O5 -->|success/partial| O8 --> S1
  S1 --> S2 --> S3
  S4 --> S3
  O5 --> O9
  O9 -->|gated CallTool| M3 --> M4
```

---

## 2. End-to-end request lifecycle

```mermaid
flowchart TD
  START([User incident in Cursor chat]) --> A[Orchestrator Agent A<br/>forwards raw query unchanged]

  A --> B[MCP CallTool: sre_run_pipeline<br/>args: query string only]

  B --> C{Phase 1<br/>parseIncident}

  C -->|trace ID found| TRACE_MODE[mode = trace<br/>filter = quoted traceId<br/>bypass topology map]
  C -->|no trace ID| TOPO{Direction Agent C<br/>keyword in dependency-map?}

  TOPO -->|match| TOPO_MODE[mode = broad<br/>scoped prefixes = primary + downstream<br/>topologyContext populated]
  TOPO -->|no match| CAT[service-catalog.json keyword match<br/>or default log prefix]
  CAT --> BROAD_MODE[mode = broad<br/>single prefix cluster scan]

  TRACE_MODE --> P2
  TOPO_MODE --> P2
  BROAD_MODE --> P2[Phase 2 phase2Fetch<br/>budget: 90s app]

  P2 --> P3{Infra symptoms<br/>in app logs?}
  P3 -->|OOM, 502, db-pool, etc.| P3RUN[Phase 3 phase3Infra<br/>budget: 30s<br/>calls k8s + infra tools internally]
  P3 -->|none| SKIP3[Skip infra — empty findings]

  P3RUN --> P4
  SKIP3 --> P4[Phase 4 phase4ChunkScore<br/>group by trace/request ID<br/>score blocks, cap output]

  P4 --> FU[suggestedFollowUps generator<br/>max 5 tools with prefilledArgs]
  FU --> GATE[Tool Gate stores follow-ups<br/>per sessionId]
  GATE --> EMIT[emitPayload<br/>confidenceScore + resolveStatus]
  EMIT --> JSON[JSON schema 1.1<br/>returned as MCP text content]

  JSON --> ORCH[Orchestrator Agent A parses JSON]

  ORCH --> ST{status routing}
  ST -->|error| E1[Report failure message — stop]
  ST -->|timeout| E2[Report timeout — stop]
  ST -->|no_explicit_errors| E3[Synthesis: no hard errors —<br/>logical bug / silent failure]
  ST -->|partial| E4[Synthesis: 3 bullets from<br/>topBlocks + infra findings<br/>note infra may be incomplete]
  ST -->|success| E5[Synthesis: 3 bullet RCA]

  E4 --> SEC{Agent A calls<br/>secondary tool?}
  E5 --> SEC
  SEC -->|yes| VAL[Tool Gate: args must match<br/>suggestedFollowUps prefilledArgs]
  VAL -->|pass| SECRUN[Execute trace-logs / k8s / infra tool<br/>via same SSH path]
  VAL -->|fail| REJECT[Throw — args mismatch]
  SEC -->|no| END([Done])
  SECRUN --> END
  E1 --> END
  E2 --> END
  E3 --> END
```

---

## 3. Phase 1 — Parse incident & Direction Agent (detailed)

```mermaid
flowchart TD
  IN([query string from Agent A]) --> P1A[parseIncident — phase1_parse_incident]

  P1A --> T{extractTraceId<br/>UUID or 32-hex?}

  T -->|YES| TR[TRACE ROUTING PLAN]
  TR --> TR1[mode = trace]
  TR --> TR2[filterPattern = traceId in quotes]
  TR --> TR3[hoursBack = 6 initial]
  TR --> TR4[scanMode forced exact]
  TR --> TR5[topologyContext = null<br/>dependency map BYPASSED]
  TR --> TR6[logGroupPrefix from catalog<br/>if service keyword present<br/>else default prefix]

  T -->|NO| DIR[Direction Agent C — phase1_topology_resolve]
  DIR --> DIR1[Load dependency-map.json groups/services]
  DIR --> DIR2[Longest keyword match in user text]
  DIR --> DIR3{Match found?}

  DIR3 -->|YES| TC[topologyContext object]
  TC --> TC1[primaryTarget service name]
  TC --> TC2[logGroupPrefix for primary]
  TC --> TC3[knownDownstreamDependencies names]
  TC --> TC4[scopedLogGroupPrefixes:<br/>primary prefix + each downstream prefix]
  TC --> TC5[knownInfrastructure merged<br/>from primary + downstream infra deps]

  DIR3 -->|NO| CAT[matchServiceCatalog]
  CAT --> CAT1[Longest keyword in service-catalog.json]
  CAT --> CAT2[Else defaultPrefix from catalog/env]

  TC --> BROAD
  CAT --> BROAD[BROAD ROUTING PLAN]
  BROAD --> B1[mode = broad]
  BROAD --> B2[filterPattern = ERROR Exception fail<br/>REJECT CRITICAL 5xx]
  BROAD --> B3[hoursBack = parseWidenHoursHint<br/>or default 0.25h = 15m]
  BROAD --> B4[scanMode from MCP_SCAN_MODE<br/>insights | exact | auto]

  TR --> OUT([RoutingPlan → Phase 2])
  BROAD --> OUT
```

---

## 4. Phase 2 — App log fetch (trace vs broad vs topology)

```mermaid
flowchart TD
  PLAN([RoutingPlan from Phase 1]) --> MODE{plan.mode}

  MODE -->|trace| TPATH[TRACE PATH — no widen ladder]

  TPATH --> T6[trace_exact_6h<br/>runScopedClusterScan exact]
  T6 --> T6E{events > 0?}
  T6E -->|yes| TDONE[buildScanReportFromEvents<br/>STOP trace path]
  T6E -->|no| T24[trace_exact_24h<br/>single widen to 24h only]
  T24 --> T24E{events > 0?}
  T24E -->|yes| TDONE
  T24E -->|no| TZERO[statusHint = no_explicit_errors]

  MODE -->|broad| BPATH[BROAD PATH — window ladder]

  BPATH --> PREFIX{scopedLogGroupPrefixes?}

  PREFIX -->|yes — topology match| TOPSCAN[For EACH prefix in order:<br/>primary service + downstream deps only<br/>NOT full cluster blind scan]
  PREFIX -->|no — catalog/default| SINGLE[Single logGroupPrefix scan]

  TOPSCAN --> WIN
  SINGLE --> WIN

  WIN[For each window: 15m → 60m → 4h<br/>stop on first hit or 90s budget]

  WIN --> INS[app_fetch_insights_15m/60m/4h<br/>CloudWatch Logs Insights batches<br/>MCP_INSIGHTS_BATCH_SIZE per group]
  INS --> INSC{insights failed OR<br/>timed out OR 0 events?}
  INSC -->|yes| EX[app_fetch_exact_fallback_same_window<br/>filter-log-events parallel<br/>MCP_SCAN_PARALLEL]
  INSC -->|no| EVENTS[accumulate events]
  EX --> EVENTS

  EVENTS --> HIT{totalEvents > 0?}
  HIT -->|yes| REPORT[buildScanReportFromEvents<br/>record scanEngine insights/exact]
  HIT -->|no| WIDEN[app_fetch_auto_widen<br/>advance to next window]
  WIDEN --> WIN

  TDONE --> REMOTE
  REPORT --> REMOTE
  TZERO --> REMOTE

  subgraph REMOTE["Per-prefix scan — runClusterScan"]
    RS1[buildScanCommand bash script]
    RS2[runRemoteScript → 2-hop SSH]
    RS3[Inner host: aws logs describe-log-groups<br/>+ start-query OR filter-log-events]
    RS4[parseScanStdout → event array]
    RS5[Merge events across topology prefixes]
  end

  REMOTE --> OUT2([report + eventsScanned<br/>+ phasesExecuted labels])
```

---

## 5. Remote execution layer (SSH + AWS)

```mermaid
flowchart LR
  subgraph Local["MCP Node process"]
    L1[buildScanCommand<br/>insights OR exact bash]
    L2[spawn ssh BatchMode]
  end

  subgraph Hop1["Hop 1 — Bastion"]
    H1[ubuntu@MCP_JUMP_HOST<br/>-i MCP_SSH_KEY]
  end

  subgraph Hop2["Hop 2 — Inner"]
    H2[ssh -i MCP_INNER_SSH_KEY<br/>ubuntu@MCP_INNER_HOST bash -s]
    H3[Script stdin piped]
    H4[describe-log-groups by PREFIX]
    H5{mode}
    H6[Insights: start-query per group<br/>sleep 2 · get-query-results · jq TSV]
    H7[Exact: filter-log-events<br/>xargs parallel MCP_SCAN_PARALLEL]
    H8[stdout TSV: timestamp, logGroup, message]
    H9[__SCAN_META__ trailer line]
  end

  subgraph Limits["Timeouts & caps"]
    X1[MCP_EXEC_TIMEOUT_MS per call]
    X2[MCP_MAX_BUFFER stdout/stderr bytes]
    X3[Pipeline kills scan if app budget exceeded]
  end

  L1 --> L2 --> H1 --> H2 --> H3 --> H4 --> H5
  H5 -->|insights| H6 --> H8
  H5 -->|exact| H7 --> H8
  H8 --> H9
  H9 -->|stdout back to MCP| L2
  X1 -.-> H2
  X2 -.-> H8
```

---

## 6. Phase 3 — Infrastructure correlate (conditional)

```mermaid
flowchart TD
  RPT([Phase 2 report with events]) --> SYM{reportHasInfraSymptoms<br/>signal-followups.js}

  SYM -->|false| SKIP[phasesExecuted empty<br/>infrastructureContext.correlated=false]
  SYM -->|true| BUDGET[30s infra budget<br/>from pipeline start offset]

  BUDGET --> T1[get_k8s_cluster_events<br/>phase: infra_k8s_events<br/>namespace MCP default · 1h back]
  T1 --> T2[get_k8s_pod_health<br/>phase: infra_k8s_pods]
  T2 --> T3[scan_infrastructure_logs<br/>phase: infra_logs · 0.5h]
  T3 --> TXT[Scan event text for patterns]
  TXT --> G{502/503/504/gateway?}
  TXT --> D{SQL/database/RDS?}

  G -->|yes + time left| M1[get_aws_infra_metrics<br/>resourceTypes ALB]
  D -->|yes + time left| M2[get_aws_infra_metrics<br/>resourceTypes RDS]

  M1 --> CAP
  M2 --> CAP
  T3 --> CAP[Cap findings: max 8 × 500 chars]
  CAP --> OUT[infrastructureContext<br/>correlated=true if any findings]

  SKIP --> MERGE
  OUT --> MERGE([→ Phase 4])

  note1[Phase 3 uses toolExecutors map<br/>same secondary tools as Agent A<br/>but invoked server-side during pipeline]
```

---

## 7. Phase 4 — Chunk, score, emit & confidence

```mermaid
flowchart TD
  REP([report.events array]) --> GRP[groupEventsIntoBlocks]
  GRP --> G1[Key by traceId / requestId /<br/>correlationId / UUID / 32-hex]
  GRP --> G2[Fallback key: logGroup + 2s time bucket]
  GRP --> G3[Attach stack trace lines<br/>at lines within 10s same logGroup]

  GRP --> SC[scoreBlock per block]
  SC --> S1[+100 if matches user traceId]
  SC --> S2[+50 Exception/FATAL]
  SC --> S3[+30 ERROR/5xx/500]
  SC --> S4[+20 multi logGroup block]
  SC --> S5[-100 INFO/DEBUG only or HealthCheck noise]

  SC --> FILT[Discard score ≤ 0]
  FILT --> SORT[Sort descending score]
  SORT --> CAP[Apply caps:<br/>maxBlocks · maxSnippetBytes · maxOutputBytes]
  CAP --> TOP[topBlocks array]

  TOP --> CONF[computeConfidence → LOW/MED/HIGH]
  TOP --> STAT[resolveStatus]

  STAT --> ST1[hardError + no app data → error]
  STAT --> ST2[total > 120s → timeout]
  STAT --> ST3[infra timed out + app data → partial]
  STAT --> ST4[0 blocks + 0 infra + hint → no_explicit_errors]
  STAT --> ST5[blocks or infra findings → success]

  CONF --> EMIT[emitPayload schema 1.1]
  STAT --> EMIT
  EMIT --> FIELDS[schemaVersion · status · confidenceScore<br/>topologyContext slice · phasesExecuted<br/>payloadMetrics · topBlocks<br/>infrastructureContext · suggestedFollowUps<br/>message if applicable]
  FIELDS --> JSON([Strict JSON — no markdown])
```

---

## 8. Post-pipeline — Orchestrator, Synthesis & gated secondary tools

```mermaid
flowchart TD
  JSON([Pipeline JSON 1.1]) --> A[Agent A Orchestrator reads fields]

  A --> CHECK{status}

  CHECK -->|error| A1[Tell user: pipeline failed<br/>show message + phasesExecuted]
  CHECK -->|timeout| A2[Tell user: exceeded 120s budget]
  CHECK -->|no_explicit_errors| B1[Agent B: No hard errors in windows<br/>may be logical bug / silent failure<br/>include payload.message]
  CHECK -->|partial| B2[Agent B: 3 bullets from evidence<br/>note infra may be incomplete]
  CHECK -->|success| B3[Agent B: 3 bullets RCA<br/>topologyContext informs deps narrative]

  B2 --> FU
  B3 --> FU[suggestedFollowUps array]

  FU --> F1[search_logs_by_trace — if traceId in query]
  FU --> F2[get_k8s_cluster_events — if infra symptoms]
  FU --> F3[get_k8s_pod_health]
  FU --> F4[scan_infrastructure_logs]
  FU --> F5[get_aws_infra_metrics ALB/RDS]

  FU --> DEC{Agent A needs deeper dive?}

  DEC -->|yes| CALL[MCP CallTool secondary name]
  CALL --> GATE[Tool Gate validateSecondaryInvoke]
  GATE --> G1{tool in suggestedFollowUps?}
  G1 -->|no| DENY[Error: must match prefilledArgs lock]
  G1 -->|yes| G2{args === prefilledArgs exactly?}
  G2 -->|no| DENY
  G2 -->|yes| EXEC[Tool execute → runRemoteScript / kubectl script]
  EXEC --> RES[JSON result to Agent A]
  RES --> B3

  DEC -->|no| END([Conversation complete])

  subgraph Tools["Secondary MCP tools — registry-mini.js"]
    T1[search_logs_by_trace — trace-logs.js]
    T2[get_k8s_cluster_events — k8s-events.js]
    T3[get_k8s_pod_health — k8s-pods.js]
    T4[scan_infrastructure_logs — infra-logs.js]
    T5[get_aws_infra_metrics — infra-metrics.js]
    T6[scan_errors — manual broad scan escape hatch]
  end

  EXEC --> Tools
```

---

## 9. Agent vs deterministic component map

```mermaid
flowchart LR
  subgraph LLM["Uses LLM (Cursor)"]
    A[Agent A — Orchestrator<br/>tool selection · user comms]
    B[Agent B — Synthesis<br/>3-bullet RCA from JSON only]
  end

  subgraph Deterministic["NO LLM — code only"]
    C[Agent C — Direction<br/>topology + keyword routing]
    D[Pipeline Phases 1–4<br/>parse · fetch · infra · score]
    E[Tool Gate<br/>secondary arg lock]
    F[Remote bash scripts<br/>CloudWatch + kubectl]
    G[emitPayload + confidence<br/>status routing · caps]
  end

  A -->|calls| D
  D --> C
  D --> F
  D --> G
  G -->|JSON| B
  A -->|optional gated| E
  E --> F
```

---

## 10. Time & status budgets (control flow)

```mermaid
flowchart TD
  T0([pipelineStart]) --> T120{elapsed ≥ 120s?<br/>pipelineTotalBudgetMs}

  T120 -->|yes anytime after phase2| TIMEOUT[status = timeout]

  subgraph App["App phase — max 90s"]
    A0[phase2Fetch started]
    A1{remaining app budget > 1s?}
    A1 -->|no| AT[phase2 timedOut flag]
    A1 -->|yes| ASCAN[run cluster scan]
    ASCAN --> A1
  end

  subgraph Infra["Infra phase — max 30s"]
    I0[only if infra symptoms]
    I1{infraBudgetRemaining > 0?}
    I1 -->|no| SKIP
    I1 -->|yes| IRUN[phase3 tools sequential]
    IRUN --> IT{per-tool deadline}
    IT -->|exceeded| PARTIAL[infraTimedOut → may yield partial status]
  end

  App --> Infra
  Infra --> EMIT[resolveStatus + emitPayload]
  T120 --> EMIT
  TIMEOUT --> EMIT
```
