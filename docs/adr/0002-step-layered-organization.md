# ADR-0002: Step-Layered Architectural Organization

## Status
Accepted

## Context & Problem Statement
Gridlock Scraper requires a standard directory and code organizational model to support multiple Texas source families (`tdlr_tabs`, `ercot_queue`, `tceq`, `municipal_agenda`, `austin_permits`).
We evaluated whether to organize code by source domain package (`src/connectors/<source_family>/`), autonomous actors, or by technical pipeline layer (`src/extractors/`, `src/parsers/`, `src/schemas/`, `src/jobs/`).

## Decision
Adopt **Step-Layered Organization** grouped by technical pipeline stage:
- `src/jobs/`: Pipeline orchestration, scheduling, and transaction boundaries.
- `src/extractors/`: Headless Playwright automation scripts per source family producing raw `SourceArtifact` blobs.
- `src/parsers/`: Pure functions per source family transforming raw payloads into structured `Observation` candidates.
- `src/schemas/`: Centralized Zod validation contracts and invariant definitions.
- `src/storage/`: Content-addressable raw storage (`ArtifactStore`) and Drizzle ORM persistence.
- `src/repair/`: Invariant anomaly detection, selector drift auditing, and out-of-band repair replay.

## Consequences
- **Positive**:
  - Clear separation of technical concerns (browser orchestration vs pure data parsing vs storage).
  - Centralized schema and invariant registry makes domain validation discoverable and uniform.
  - Easy cross-cutting instrumentation (e.g. wrapping all extractors with uniform timeout/error telemetry).
- **Negative / Trade-offs**:
  - Adding or modifying a source family requires touching multiple directories (`extractors/`, `parsers/`, `schemas/`).
  - Strict naming discipline required to ensure source family names match across layers (e.g., `extractors/tdlr.ts` $\leftrightarrow$ `parsers/tdlr.ts` $\leftrightarrow$ `schemas/tdlr.ts`).
