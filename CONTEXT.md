# CONTEXT.md — Gridlock Scraper System Context & Architecture

## Ubiquitous Language

- **Source Family**: Classification of upstream data provider (`tdlr_tabs`, `ercot_queue`, `tceq`, `municipal_agenda`, `austin_permits`).
- **Source Artifact**: Immutable, content-addressed raw payload (HTML, PDF, JSON, XLSX) stamped with SHA-256 hash and capture metadata.
- **Atomic Observation**: Immutable, append-only assertion about a real-world entity property (e.g. `power_mw = 800`, `status = "under_review"`), linked to a parent `source_artifact`.
- **Target Entity / Projection**: Resolved domain entity (`project`, `facility`, `organization`, `location`) materialized from competing observations.
- **Connector Manifest**: Declarative configuration specifying entry URLs, pagination strategy, DOM/API selectors, and extraction schema.
- **Domain Invariants**: Semantic rules that must hold true regardless of upstream DOM changes (e.g. `power_mw > 0`, `county in TEXAS_COUNTIES`, non-empty project names).
- **Selector Drift**: Upstream DOM or layout mutations that cause CSS/XPath queries to fail or return malformed data.
- **Out-of-Band Self-Healing**: Asynchronous repair loop that captures failed artifacts, diagnoses selector drift, tests candidate patches against historical replay fixtures, and writes audit records to `repair_audits`.
- **Ticket Acceptance Suite**: Dedicated test specifications located under `tests/tickets/ticket-XX.test.ts` that directly validate the acceptance criteria and definition of done for specific backlog tickets.
- **Agent Validation Gate**: A deterministic CLI command (`npm run test:ticket <id>`) and exit code protocol (0 = pass, 1 = fail) that evaluates a ticket's acceptance criteria, outputs structured checklist results, and provides autonomous agents with an unambiguous verification oracle.

## System Constraints & Invariants

1. **Provenance First**: No observation or entity may be written without a verified `source_artifact_id` and SHA-256 hash.
2. **Deterministic Extraction**: Parsers must be pure functions of raw payload: `parse(artifact: Buffer | string) -> Result<Observation[]>`.
3. **Texas Grid Scope**: Coverage spans ERCOT, TDLR, TCEQ, and municipal bodies across Texas. Ingestion must not be artificially restricted to Austin municipal limits.
4. **Decoupled Architecture**: `gridlock-scraper` is an independent headless service. Downstream presentation layers (`gridlock-graphical-atlas`, `gridlock-generative-console`, `sam-johnson-portfolio`) consume materialized projections or exports; zero shared cross-repo runtime code.
5. **Typed ORM Invariant**: All database access uses Drizzle ORM (`src/schema.ts`). Untyped SQL strings are forbidden.
6. **Playwright-Standard Runtime**: All source ingestion executes strictly via Playwright browser contexts. Single execution model ensures uniform handling of ASP.NET ViewState, postbacks, file downloads, and client-side hydration (ADR-0001).
7. **Step-Layered Structure**: Codebase is organized by technical execution layer (`src/jobs/`, `src/extractors/`, `src/parsers/`, `src/schemas/`, `src/storage/`, `src/repair/`). All extractors produce raw artifacts; all parsers are pure functions that yield validated observations (ADR-0002).
8. **Content-Hash Gated Idempotency**: Raw payloads are hashed with SHA-256 upon capture. Existing hashes short-circuit downstream parsing and storage, eliminating database bloat and redundant entity mutation (ADR-0003).
9. **Out-of-Band Self-Healing Replay**: Upstream selector breaks trigger an `"anomaly"` state and isolate raw payloads. Candidate patches are synthesized out-of-band and must achieve 100% invariant pass rates across historical replay fixtures before audit promotion (ADR-0004).
10. **Fixture-First Hermetic Testing**: All standard test suites (`npm test`) run 100% offline using frozen fixtures in `tests/fixtures/` and in-memory SQLite (`node:sqlite`). Live network smoke tests are isolated and gated behind `LIVE_TEST=1` (ADR-0005).
11. **Adaptive Infrastructure Acceptance Testing**: Ticket acceptance tests for infrastructural boundaries (Docker, Cloudflare R2, webhooks, CLI) execute 100% hermetically by default using static contract verification, subprocess exit assertions, and loopback in-process servers. Live integration checks are gated behind optional environment flags (e.g. `LIVE_TEST=1`, `DOCKER_TEST=1`).
12. **Agent Validation Gate Protocol**: Every backlog ticket in `gridlock-scraper` must have a corresponding verification target (`tests/tickets/ticket-XX.test.ts`). Autonomous agents declare a ticket complete if and only if `npm run test:ticket XX` exits with code 0 and reports 100% acceptance criteria satisfied.
