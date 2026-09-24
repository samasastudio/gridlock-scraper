# ADR-0005: Fixture-First Offline Testing and Quality Gates

## Status
Accepted

## Context & Problem Statement
Scraping pipelines are inherently vulnerable to flaky tests and external network dependencies. Hitting live government websites (TDLR, ERCOT, TCEQ) during continuous integration (CI) or local test runs leads to:
1. False-positive test failures caused by third-party downtime or network flakiness.
2. IP banning or WAF rate-limiting from public agency servers.
3. Leaking test-run artifacts into remote audit logs.

We needed a deterministic testing strategy that guarantees rapid, hermetic test execution while preserving rigorous verification of parser logic, schema contracts, and database integrity.

## Decision
Adopt **Fixture-First Offline Testing**:
1. **Frozen Fixture Repository (`tests/fixtures/<source_family>/`)**:
   - Store sanitized, compressed HTML, PDF, and XLSX snapshots representing canonical government responses.
   - Parsers (`src/parsers/`) are verified exclusively against these frozen fixtures.
2. **In-Memory SQLite Contract Testing**:
   - Repository and pipeline tests execute against in-memory SQLite (`node:sqlite` `DatabaseSync(":memory:")`) with `PRAGMA foreign_keys = ON;`.
   - Tests assert zero foreign key constraint violations and verify transactional atomicity.
3. **Hermetic CI Execution**:
   - Default test suite (`npm test`) executes 100% offline with zero outbound network calls.
   - Live network smoke tests are strictly isolated in `tests/live/` and gated behind an explicit environment flag (`LIVE_TEST=1`).
4. **Code Quality & Commit Gates**:
   - Strict TypeScript configuration (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true`).
   - Conventional Commits enforced at git commit time via Husky and `@commitlint/cli`.

## Consequences
- **Positive**:
  - Test suites execute in hundreds of milliseconds without external network latency.
  - Zero risk of IP rate-limiting from automated test runs.
  - Clear baseline fixtures available for regression testing and self-healing replay harnesses.
- **Negative / Trade-offs**:
  - Upstream agency changes will not fail offline tests until new fixtures are captured or live smoke tests are triggered.
