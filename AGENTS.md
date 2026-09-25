# Agent Steering & Repository Rules — Gridlock Scraper

## 1. Operating Doctrine & Communication
- **Brevity & Technical Exactness**: Speak in concise, high-density phrases and direct bullet points. Code blocks, diffs, commands, and file paths remain 100% exact.
- **Active Skills**:
  - `scraper-architecture-standards`: Enforces architecture, layer separation, data integrity, and review standards.
  - `agent-validation-gates`: Enforces ticket acceptance harness, falsifiable RED gates, and verification commands (`npm run test:ticket <id>`, `npm run test:tickets:audit`).

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

---

## 4. Verification Commands
- `npm test`: Runs hermetic offline test suite via `tsx --test`.
- `npm run typecheck`: TypeScript verification (`tsc --noEmit`).
- `npm run test:ticket <id>`: Runs the validation gate for a specific ticket (e.g. `npm run test:ticket 23`).
- `npm run test:tickets:audit`: Prints the backlog compliance audit matrix.
- `npm run test:tickets`: Runs all ticket acceptance suites.
- Git commits gated by Husky and Conventional Commits (`@commitlint/cli`).
