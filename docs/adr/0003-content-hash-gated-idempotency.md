# ADR-0003: Content-Hash Gated Early-Exit for Idempotent Ingestion

## Status
Accepted

## Context & Problem Statement
Gridlock Scraper executes frequent periodic sweeps against Texas regulatory and grid portals. Most government assets (e.g., ERCOT monthly queue spreadsheets, TDLR filing records) remain static between runs. Re-parsing and re-inserting unchanged data wastes compute, inflates SQLite database size, and triggers spurious entity mutation events downstream.

## Decision
Implement **Content-Hash Gated Early-Exit**:
1. When Playwright captures a raw payload (HTML, PDF, XLSX, or JSON), calculate its cryptographic `SHA-256` hash immediately.
2. Query `source_artifacts` for an existing record matching `sha256_hash`.
3. **If hash exists**:
   - Touch `connector_configs.last_run_at` and log `status: "unchanged"`.
   - Short-circuit the pipeline immediately before parsing, schema validation, or observation emission.
4. **If hash is new**:
   - Persist payload to `ArtifactStore` (content-addressable storage).
   - Insert new `source_artifacts` record.
   - Run pure parser (`src/parsers/`) and validate data through Zod contracts (`src/schemas/`).
   - Persist atomic `observations` and update target entity projections inside a SQLite transaction.

## Consequences
- **Positive**:
  - Near-zero redundant database write amplification.
  - High-throughput verification of unchanged remote endpoints.
  - Guaranteed cryptographic immutability: observations always link to exact payload bitstreams.
- **Negative / Trade-offs**:
  - Pages with dynamic ephemeral markers (e.g., server timestamps in footer) require lightweight pre-hashing DOM sanitization to avoid false-positive drift.
