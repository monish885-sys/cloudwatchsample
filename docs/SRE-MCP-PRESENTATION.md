---
marp: true
theme: default
paginate: false
size: 16:9
style: |
  section { font-size: 28px; }
  h1 { font-size: 42px; margin-bottom: 0.3em; }
  h2 { font-size: 32px; color: #444; }
  .mermaid { font-size: 22px; }
---

# Problem

**Incident RCA is slow, manual, and error-prone**

```mermaid
flowchart LR
  A[🚨 Incident<br/>API 500 / timeout] --> B[On-call SRE]
  B --> C[Bastion SSH]
  C --> D[Inner host SSH]
  D --> E[Manual AWS CLI /<br/>kubectl / Insights]
  E --> F{Guess log group,<br/>window, filter?}
  F -->|Wrong| G[❌ Missed errors /<br/>wasted time]
  F -->|Retry| E
  G --> H[Hours to RCA]
```

---

# Solution

**CloudWatch MCP — one tool, server-owned pipeline, strict JSON out**

```mermaid
flowchart TB
  subgraph Agent["Cursor / SRE Agent"]
    U[User: paste incident text]
    S[gpt-4o-mini synthesis<br/>3-bullet RCA only]
  end

  subgraph MCP["cloudwatch-mcp server"]
    P1[Phase 1<br/>Parse + topology map]
    P2[Phase 2<br/>Targeted log fetch<br/>Insights → exact → widen]
    P3[Phase 3<br/>Infra correlate]
    P4[Phase 4<br/>Chunk + score]
    J[JSON schema 1.1<br/>topBlocks · topology · follow-ups]
  end

  subgraph Remote["Two-hop SSH → inner host"]
    CW[(CloudWatch)]
    K8s[(K8s / metrics)]
  end

  U -->|sre_run_pipeline| P1 --> P2 --> P3 --> P4 --> J
  P2 & P3 --> Remote
  J --> S
  J -.->|gated only| FU[Secondary tools<br/>trace · pods · infra logs]
```

---

# Future Plans

**From reactive log hunt → proactive, broader coverage**

```mermaid
flowchart LR
  subgraph Now["✅ Today"]
    N1[Deterministic 4-phase pipeline]
    N2[Dependency-map topology scans]
    N3[Schema 1.1 + gated follow-ups]
  end

  subgraph Next["🔜 Planned"]
    X1[Alert webhook → auto-run pipeline]
    X2[Richer service catalog + multi-env]
    X3[Metrics anomaly pre-check<br/>before log widen]
  end

  subgraph Later["🎯 Roadmap"]
    L1[Multi-cluster profiles]
    L2[RCA timeline / canvas dashboard]
    L3[Feedback loop: scored blocks → map tuning]
  end

  Now --> Next --> Later
```
