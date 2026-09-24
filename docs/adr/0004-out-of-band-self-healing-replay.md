# ADR-0004: Out-of-Band Self-Healing Replay Sandbox

## Status
Accepted

## Context & Problem Statement
State agency websites (TDLR, TCEQ, municipal clerks) periodically alter their HTML layouts, class names, and table structures. When CSS/XPath selectors break, standard scrapers either fail completely or silently inject corrupt, truncated records into downstream stores.
Inline runtime LLM repair causes nondeterministic latency spikes, high API costs, and risks writing hallucinated data directly to the production database.

## Decision
Implement an **Out-of-Band Self-Healing Replay Sandbox**:
1. **Anomaly Isolation**:
   - When an extractor returns null for mandatory elements or extracted observations fail Zod invariants, mark `connector_configs.last_status = "anomaly"`.
   - Quarantine and persist the failing raw payload to `source_artifacts`.
   - Abort current pipeline run without corrupting target entities.
2. **Asynchronous Repair Engine (`src/repair/`)**:
   - Operates out-of-band (via scheduled worker or dedicated CLI command).
   - Analyzes failing HTML structure against the connector's invariant schema to propose candidate selector mutations.
3. **Historical Replay Sandbox**:
   - Replays candidate selectors against a historical benchmark set (last $N$ verified `source_artifacts` + the failing artifact).
   - Invariants must achieve a 100% pass rate with zero regression on historical fixtures.
4. **Audit & Promotion**:
   - Results are written to `repair_audits` (`proposed_patch`, `replay_results`, `status`).
   - If verified, manifest patch is either committed to `connector_configs.manifest` or staged for manual confirmation.

## Consequences
- **Positive**:
  - Live ingestion remains fast, deterministic, and isolated from LLM latency.
  - Zero hallucinated or corrupted data can enter canonical entity tables.
  - Full audit trail of all upstream layout breaks and selector revisions.
- **Negative / Trade-offs**:
  - Scraper remains in an `"anomaly"` state until the out-of-band repair loop executes.
  - Historical artifacts must be persisted and accessible to serve as the replay test suite.
