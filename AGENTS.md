# Agent Steering & Repository Rules — Gridlock Scraper

## 1. Operating Doctrine & Communication
- **Brevity & Technical Exactness**: Speak in concise, high-density phrases and direct bullet points. Code blocks, diffs, commands, and file paths remain 100% exact.
- **Active Skills**:
  - `scraper-architecture-standards`: Enforces architecture, layer separation, data integrity, and review standards.

---

## 2. Project Stack & Invariants
- **Runtime**: Node.js >= 22 (ESM) + TypeScript 5.9 + tsx.
- **Browser Automation**: Playwright (Headless Chromium).
- **Database & Storage**: Drizzle ORM (`drizzle-orm`, `drizzle-kit`) with SQLite (`node:sqlite`). Content-addressable raw `ArtifactStore`.
- **Validation**: Zod for schema contracts and domain invariants.
- **Architectural Reference**: Decisions documented under `docs/adr/` (ADR-0001 through ADR-0005) and `CONTEXT.md`.

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

---

## 4. Verification Commands
- `npm test`: Runs hermetic offline test suite via `tsx --test`.
- `npm run typecheck`: TypeScript verification (`tsc --noEmit`).
- Git commits gated by Husky and Conventional Commits (`@commitlint/cli`).
