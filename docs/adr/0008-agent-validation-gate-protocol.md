# ADR-0008: Agent Validation Gate Protocol & Ticket Runner

## Status
Accepted

## Context & Problem Statement
Autonomous AI coding agents working on the `gridlock-scraper` backlog require an objective, deterministic, machine-verifiable Definition of Done (DoD). Without dedicated verification gates per ticket, agents may:
1. Rely on generic test suites (`npm test`) that do not assert the ticket's specific acceptance criteria.
2. Assume an implementation is finished before all edge cases and domain invariants are satisfied.
3. Prematurely close or mark issues as "Done".

## Decision
Establish an automated **Agent Validation Gate Protocol**:
1. **Targeted Runner Interface**:
   - `npm run test:ticket <id>`: Runs the dedicated acceptance test file `tests/tickets/ticket-<id>.test.ts`.
   - `npm run test:tickets`: Runs all ticket acceptance tests.
   - `npm run test:tickets:audit`: Executes all ticket test suites and outputs a high-density tabular audit of all scraper backlog items, their pass/fail status, and acceptance criteria coverage.
2. **Deterministic Exit Codes**:
   - `0`: Ticket is 100% complete; all acceptance criteria and invariants verified.
   - `1`: Ticket is incomplete or failing; exact failing criteria and stack traces printed to stdout/stderr.
3. **Structured Checklist Output**:
   - Test suites structure individual acceptance criteria as explicit sub-tests, producing readable markdown/terminal checklist items (`[x]` / `[ ]`).
4. **Agent Workflow Contract**:
   - An agent implementing Ticket XX must execute `npm run test:ticket XX` as its final verification step. If the command exits with code 0, the implementation is certified complete.

## Consequences
- **Positive**: Eliminates hallucinated completions. Provides agents with immediate, actionable feedback loops during development. Clean integration into CI and automated workflows.
- **Negative / Trade-offs**: Requires scaffolding test files for pending tickets with failing/skipped assertions representing pending work.
