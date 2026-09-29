# Agent Steering & Repository Rules — Gridlock Scraper

## 1. Always-On Communication Style: Caveman Mode
- **Always active**: Adhere strictly to the [`caveman`](./.agents/skills/caveman/SKILL.md) skill on every turn.
- **Drop fluff & pleasantries**: Never say *"Certainly"*, *"Sure"*, *"I'd be happy to help"*, *"Of course"*, or conversational filler (*"basically"*, *"actually"*, *"simply"*).
- **High-density brevity**: Speak in short phrases, fragments, and direct bullet points.
- **Preserve technical exactness**: Code blocks, diffs, terminal commands, file paths, and error traces remain 100% exact and complete.
- **Safety override**: Revert to full clarity only for destructive operations or critical security warnings.
- **Active Skills**:
  - `scraper-architecture-standards`: Enforces architecture, layer separation, data integrity, and review standards.
  - `agent-validation-gates`: Enforces ticket acceptance harness, falsifiable RED gates, and verification commands (`npm run test:ticket <id>`, `npm run test:tickets:audit`).
  - `gridlock-code-review`: Dual-mode code review engine for inbound review comment triage (4-part format, no SVG badges) and outbound pre-PR invariant auditing.

---

## 2. Project Stack & Invariants
- **Runtime**: Node.js >= 22 (ESM) + TypeScript 5.9 + tsx.
- **Browser Automation**: Playwright (Headless Chromium).
- **Database & Storage**: Drizzle ORM (`drizzle-orm`, `drizzle-kit`) with SQLite (`node:sqlite`). Content-addressable raw `ArtifactStore`.
- **Validation**: Zod for schema contracts and domain invariants.
- **Architectural Reference**: Decisions documented under `docs/adr/` (ADR-0001 through ADR-0008) and `CONTEXT.md`.

---

## 3. Core Architectural Invariants
1. **Provenance First**: Every observation must link to a cryptographically hashed `source_artifact`.
2. **Browser-Only Playwright**: Single execution runtime for all Texas state agency portals and asset downloads (ADR-0001).
3. **Step-Layered Structure**: Separation of concerns across `src/jobs/`, `src/extractors/`, `src/parsers/`, `src/schemas/`, `src/storage/`, and `src/repair/` (ADR-0002).
4. **Content-Hash Early-Exit**: Deduplicate runs using SHA-256 hashes before running parsers or database mutations (ADR-0003).
5. **Out-of-Band Self-Healing**: Selector drift halts with `"anomaly"` state; repair patches verified against replay harness (ADR-0004).
6. **Fixture-First Offline Testing**: All standard tests in `npm test` execute hermetically offline against frozen fixtures in `tests/fixtures/` and in-memory SQLite (ADR-0005).
7. **Texas Infrastructure Scope**: Ingestion spans ERCOT, TDLR, TCEQ, and Texas statewide bodies; never restrict scope to Austin municipal limits.
8. **Typed ORM Only**: Untyped raw SQL strings are prohibited; use typed Drizzle schema (`src/schema.ts`).
9. **Windows PowerShell Invariant**: Never use `&&` to chain commands in PowerShell (causes fatal `ParserError`). Separate sequential commands with `;` or execute them in separate tool invocations.
10. **The Legible Diagram Invariant**: Never cram end-to-end architectures into a single monolithic, multi-subgraph Mermaid chart (causes container auto-scaling and unreadable text). When generating architectural diagrams for review:
    - Deconstruct into modular sub-flows (Macro Flow, Core Execution/Gate, Failure/Repair Loop).
    - Enforce explicit readable font size variables in Mermaid blocks (`%%{init: {'theme': 'neutral', 'themeVariables': { 'fontSize': '15px' }}}%%`).
    - When preparing documentation for formal review, deliver as a dedicated markdown review artifact rather than a single compressed chat message.
11. **Zero Synthetic Defaults**: Never use fallbacks (`|| 0`, `|| "Austin"`, `|| "under_review"`, `|| "zoning"`) to satisfy schema contracts. Missing or unmapped fields must fail Zod invariants and trigger quarantine.
12. **Transactional Provenance**: `source_artifacts` insertion, observation emission, and connector status updates must execute atomically inside a typed Drizzle transaction (`this.drizzle.transaction`).
13. **Mandatory Replay Oracles**: Historical replay fixtures must specify semantic assertions (`expectedMinCount`, `expectedSubjectIds`); promoting patches based on loose `obs.length > 0` checks is strictly prohibited.
14. **Agent Validation Gate Invariant**: Every backlog ticket in `gridlock-scraper` must have a corresponding verification target (`tests/tickets/ticket-XX.test.ts`). Acceptance tests must be falsifiable RED (testing actual target contracts, schemas, and fixtures without placeholder stubs). Autonomous agents declare an issue complete if and only if `npm run test:ticket <id>` exits with code 0 and reports 100% acceptance criteria satisfied. Point to `agent-validation-gates` skill for verification protocol.
15. **Bounded Anomaly Promotion**: Candidate self-healing repair patches must be strictly bound to specific quarantined failure records (by failure ID and temporal window). Arbitrary or unanchored anomaly clearance is strictly prohibited.
16. **CLI Script Executability**: All operational scripts in `scripts/` must be directly invokable via CLI using entrypoint guards (`process.argv[1] === fileURLToPath(import.meta.url)`).
17. **Decomposed Factory Returns**: When authoring client or service factories, avoid defining multi-line asynchronous methods inline inside returned object literals. Extract operations into top-level single-responsibility functions and return an object composed of function references (`return { getObject, putObject, copyObject, deleteObject };`).
18. **Execution Integrity**: CLI entrypoints and Docker containers must wire live database repositories and pipeline runners; returning unconditional success without executing the pipeline is strictly prohibited.
19. **Functional Transforms & Flat Control Flow**: Prefer pure array methods (`flatMap`, `map`, `filter`, `reduce`) and Node 22 standard library primitives (`node:stream/consumers`, `fs.readdirSync({ recursive: true })`, `node:util.parseArgs`) over mutable loop accumulators and custom recursion. Replace nested condition ladders with early returns and Strategy Pattern dispatch. Where sequential iteration, mutative loops, or state-machine scanners are strictly required (e.g., SQLite write locks, agency rate limiting, RFC 4180 parsing), inline code comments must document the architectural rationale.
20. **No Silent Candidate Filtering**: Strategy pattern parsers must select extraction strategies by structural document presence, not candidate field validity. Discarding malformed elements via `.filter()` before validation is strictly prohibited; all discovered elements within a matched structure must pass through domain invariant validation (`validateInvariants`) to trigger anomaly quarantine on selector drift.
21. **Preserved Initial Attempt & Public Replay Diagnostics**: Network retry utilities (`fetchWithBackoff`) must treat `maxRetries` as retry attempts after the initial call, guaranteeing attempt 0 always executes even when `maxRetries: 0`. Replay verification interfaces (`evaluateCandidatePatch`) must expose structured per-fixture diagnostics (`details: SingleFixtureEvaluation[]`) directly on public return contracts.
22. **Terminal Quarantined Artifact Binding**: When evaluating candidate repair audits for anomaly promotion (`isArtifactEligibleForPromotion`), if an audit record specifies an explicit `quarantinedArtifactId`, any mismatch against the candidate artifact ID must immediately return `false`. Falling through to temporal fallback checks is strictly prohibited.
23. **Fail-Closed Remote State Hydration**: State synchronization utilities (S3/R2) must strictly isolate HTTP 404 / `NoSuchKey` for empty-store initialization. All network timeouts, authentication rejections, and 5xx errors must fail closed and terminate execution immediately, preventing an unpopulated local database from overwriting remote production state.
24. **Binary Buffer Preservation**: Pipeline runners and extractors handling binary payloads (e.g. `.xlsx`, `.pdf`, `.zip`) must preserve raw `Buffer` bitstreams without intermediate `toString("utf8")` conversion, using in-memory decompressors prior to tabular invariant validation.
25. **Container Ingress & Privilege Demotion**: Containerized HTTP servers must bind to `0.0.0.0` by default. Dockerfiles dropping to non-root users (`USER pwuser`) must pre-create all writable data directories (`/app/.artifacts`, database mounts) and transfer ownership (`chown -R`) prior to the `USER` instruction to prevent runtime `EACCES` crashes.
26. **Spreadsheet MIME Precedence**: MIME-type extension derivation must check OpenXML and Excel tokens (`spreadsheetml`, `xlsx`, `ms-excel`, `xls`) prior to generic XML/HTML checks to prevent binary spreadsheets from being mislabeled.
27. **Hydration-Gated State Publishing**: Workflow pipelines that publish state to persistent remote storage must strictly gate execution on successful pre-run hydration (`steps.sync-hydrate.outcome == 'success'`). Publishing under `always()` after a hydration failure is strictly prohibited.
28. **Fail-Fast Remote Sync Credentials**: State synchronization utilities and client factories (`createR2ClientFromEnv`) must throw fatal errors on absent or empty remote credentials (`CLOUDFLARE_R2_*`); returning mock no-op clients or synthesizing empty databases on publish is strictly prohibited.
29. **Replay Binary Preservation**: Self-healing replay verification harnesses (`evaluateCandidatePatch`, `evaluateSingleFixture`) must accept `string | Buffer` and pass binary fixtures directly to candidate parsers without `.toString("utf8")`.
30. **Blob-First State Publishing**: When publishing state to remote object storage (Cloudflare R2), content-addressable artifact blobs in `.artifacts/` must be synchronized prior to uploading the SQLite database snapshot (`gridlock.db`) to preserve cryptographic provenance under partial network disruption.
31. **Non-Empty Observation Guard**: Extractors and parsers handling continuous queue feeds (e.g. Austin building permits, ERCOT queues) must throw fatal errors when input payloads contain 0 records or extract 0 observations, routing empty payloads into anomaly quarantine rather than recording false healthy ingestion.
32. **Binary OLE Preservation**: Parsers and extractors handling spreadsheet bitstreams must inspect file signatures for legacy OLE CFBF binary formats (`\xD0\xCF\x11\xE0`) and reject them with descriptive errors prior to UTF-8 string conversion.
33. **Reprocessing Anomaly Restoration**: When reprocessing quarantined payloads against candidate repair patches (`handleExistingArtifactMatch`), if candidate parsing or domain validation throws an error, the runner must immediately restore `connector_configs.last_status = 'anomaly'`.

---

## 4. Verification Commands
- `npm test`: Runs hermetic offline test suite via `tsx --test` (live portal tests in `tests/live/` are intentionally skipped offline per ADR-0005 unless `LIVE_TEST=1`).
- `LIVE_TEST=1 npm test`: Opts into live integration smoke tests against external Texas agency portals (PowerShell: `$env:LIVE_TEST="1"; npm test; Remove-Item Env:\LIVE_TEST`).
- `npm run typecheck`: TypeScript verification (`tsc --noEmit`).
- `npm run test:ticket <id>`: Runs the validation gate for a specific ticket (e.g. `npm run test:ticket 23`).
- `npm run test:tickets:audit`: Prints the backlog compliance audit matrix.
- `npm run test:tickets`: Runs all ticket acceptance suites.
- Git commits gated by Husky and Conventional Commits (`@commitlint/cli`).
