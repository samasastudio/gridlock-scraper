---
name: scraper-architecture-standards
description: Enforces architectural, organizational, data integrity, and code style standards for gridlock-scraper. Use when designing, authoring, refactoring, or reviewing scrapers, extractors, parsers, and repair loops.
---

# Scraper Architecture & Engineering Standards

Comprehensive architectural, organizational, and code standards for `gridlock-scraper`. Governs data ingestion across Texas regulatory agencies, grid queues, and municipal dockets.

---

## 1. System Invariants (Non-Negotiable)

| Invariant | Description | Authority |
| :--- | :--- | :--- |
| **Provenance First** | Zero observations or entities written without a linked `source_artifact` and SHA-256 hash. | ADR-0001, ADR-0003 |
| **Browser-Only Runtime** | Ingestion driven exclusively via headless Playwright browser contexts (`chromium`). | ADR-0001 |
| **Step-Layered Separation** | Code organized by pipeline stage: `jobs/`, `extractors/`, `parsers/`, `schemas/`, `storage/`, `repair/`. | ADR-0002 |
| **Content-Hash Idempotency** | Raw payloads hashed with SHA-256 upon capture. Existing hashes short-circuit downstream parsing. | ADR-0003 |
| **Out-of-Band Self-Healing** | Selector breaks trigger `"anomaly"` state; candidate patches tested via historical replay harness before audit promotion. | ADR-0004 |
| **Fixture-First Testing** | Default test suites (`npm test`) run 100% offline using frozen fixtures and in-memory SQLite (`node:sqlite`). | ADR-0005 |
| **Texas Grid Scope** | Ingestion covers ERCOT, TDLR, TCEQ, and Texas statewide infrastructure. Never restrict scope to Austin limits. | CONTEXT.md |
| **Typed ORM Only** | All database mutations use typed Drizzle schema (`src/schema.ts`). Raw untyped SQL strings are forbidden. | AGENTS.md |
| **Zero Synthetic Defaults** | Parsers must never fall back to default values (`\|\| 0`, `\|\| "zoning"`) when selectors break; missing fields must fail Zod validation to trigger quarantine. | ADR-0004 |
| **Atomic Transactional Writes** | `source_artifacts` and `observations` must be committed together inside a database transaction to prevent orphan hashes from deadlocking retries. | ADR-0003 |
| **Non-Empty Stream Gate** | Continuous regulatory queues (ERCOT, municipal dockets) must assert $\ge 1$ parsed record; 0 records indicate an upstream outage or breaking layout shift. | ADR-0004 |
| **Semantic Replay Oracles** | Every replay test fixture must define strict semantic expectations (`expectedMinCount`, `expectedSubjectIds`); loose `obs.length > 0` checks are banned. | ADR-0004 |

---

## 2. Directory Layout & Layer Responsibilities

```text
src/
├── extractors/     # Playwright automation per source family (produces raw payload Buffer/string)
├── parsers/        # Pure functions: f(raw_payload) -> Zod-validated Observation candidates
├── schemas/        # Zod validation contracts, domain invariants, and manifest types
├── jobs/           # Pipeline runners, scheduling, transactions, and early-exit deduplication
├── storage/        # Content-addressable ArtifactStore (local/GCS) + Drizzle SQLite repository
├── repair/         # Out-of-band replay test harness and repair audit logger
├── index.ts        # Public module exports
└── schema.ts       # Canonical Drizzle ORM schema definitions
tests/
├── fixtures/       # Frozen, sanitized HTML/XLSX/PDF captures per source family
├── live/           # Gated integration smoke tests (LIVE_TEST=1 only)
└── *.test.ts       # Hermetic in-memory SQLite and parser unit tests
```

---

## 3. Step-by-Step Implementation Workflow

When adding or refactoring a scraper for an upstream source family:

### Step 1: Define Schemas & Invariants (`src/schemas/<family>.ts`)
- Define Zod schemas for raw extracted data and domain invariants.
- Ensure all numeric, date, and categorical fields have strict validation bounds (e.g., `power_mw > 0`, ISO date strings, valid Texas counties).

### Step 2: Capture Fixture & Implement Pure Parser (`src/parsers/<family>.ts`)
- Save a canonical payload sample to `tests/fixtures/<family>/sample-01.<ext>`.
- Write parser as a **pure function**: `parse(rawContent: string | Buffer): ParsedObservation[]`.
- **Constraint**: Zero Playwright, network, or database dependencies inside `src/parsers/`.
- Write offline unit test in `tests/<family>.test.ts` asserting 100% test pass on fixture.

### Step 3: Implement Playwright Extractor (`src/extractors/<family>.ts`)
- Implement browser navigation, form fills, ASP.NET postback handling, and payload downloads.
- Return raw payload buffer/string alongside extraction metadata (`sourceUrl`, `contentType`, `byteSize`).

### Step 4: Wire Pipeline Runner (`src/jobs/<family>.ts`)
- Compute `sha256(payload)`.
- Check `source_artifacts` for existing hash. If found, update `last_run_at` and early-exit.
- If new: write to `ArtifactStore`, insert `source_artifacts`, run pure parser, and persist `observations` inside a SQLite transaction.

### Step 5: Configure Anomaly & Repair Hooks (`src/repair/`)
- On extraction failure or invariant violation, flag `connector_configs.last_status = "anomaly"`.
- Persist failing payload to quarantine for out-of-band replay testing.

---

## 4. Code Review & Verification Checklist

Review every scraper PR against this checklist:

- [ ] **Decoupled Parser**: Is `src/parsers/` completely free of browser or database dependencies?
- [ ] **Cryptographic Hash**: Is SHA-256 calculated directly on the raw bitstream before parsing?
- [ ] **Content-Hash Early-Exit**: Does identical content short-circuit pipeline before DB writes?
- [ ] **Zod Invariant Enforcement**: Are all extracted values strictly validated through Zod before emission?
- [ ] **Atomic Observations**: Are scraped values written to `observations` table with valid `source_artifact_id`?
- [ ] **Offline Tests**: Does `npm test` execute completely offline without network requests?
- [ ] **Fixture Presence**: Is there a corresponding frozen fixture in `tests/fixtures/`?
- [ ] **Typed Drizzle Queries**: Are all queries typed via Drizzle schema? Zero untyped SQL strings?
- [ ] **No Synthetic Fallbacks**: Does the parser omit default values (`|| 0`, `|| ""`) that disguise missing fields?
- [ ] **Atomic Transaction**: Are `source_artifacts` and `observations` wrapped in a single database transaction?
- [ ] **Non-Empty Verification**: For continuous queue sources, does the parser assert that at least one valid record was extracted?
- [ ] **Media Type Preservation**: Does quarantine preserve the raw bitstream's true `contentType` and file extension?
- [ ] **Replay Semantic Assertions**: Do all replay fixtures include explicit expected counts or subject IDs?
- [ ] **Commit Message**: Does commit conform to Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)?

---

## 5. Anti-Patterns to Reject

1. **Inline Monoliths**: Writing browser navigation, HTML parsing, and SQLite inserts inside one giant script.
2. **Direct Upserts Without Observations**: Writing directly to `projects` without emitting immutable `observations`.
3. **Live Network Calls in Default Tests**: Running tests that hit live agency URLs in standard CI.
4. **In-Flight LLM Scraping**: Calling LLMs mid-scrape during live runs to guess broken selectors.
5. **Austin-Only Blinders**: Restricting queues or municipal scrapers to Austin when infrastructure spans ERCOT and statewide Texas.
6. **Synthetic Fallback Defaults**: Using `|| 0`, `|| "under_review"`, or hardcoded enum values to prevent Zod errors when selectors drift.
7. **Silent Empty Ingestion**: Allowing continuous queue scrapers to return 0 records and report healthy status (`"ok"`).
8. **Split Artifact/Observation Writes**: Inserting raw artifacts outside a transaction, leaving orphan hashes when downstream inserts fail.
9. **Permissive Patch Promotion**: Counting a replay test as passing merely because `obs.length > 0`.
10. **Lossy Quarantine Media Types**: Saving non-HTML payloads (CSV, JSON, PDF) as `text/html` in quarantine.
