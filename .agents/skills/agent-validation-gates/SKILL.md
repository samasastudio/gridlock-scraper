---
name: agent-validation-gates
description: Enforces the ticket acceptance harness and verification gates for gridlock-scraper backlog tickets. Use when validating ticket completion, checking backlog status, or authoring ticket acceptance tests.
---

# Agent Validation Gates & Ticket Acceptance Harness

Deterministic testing harness and verification protocol for autonomous agents working on `gridlock-scraper` backlog tickets.

---

## 1. Agent Commands & Verification Protocol

Autonomous agents implementing a ticket must execute the validation gate before declaring the work complete:

### Primary Verification Gate (Targeted Ticket)
```bash
npm run test:ticket <ticket-number>
# Examples:
#   npm run test:ticket 23
#   npm run test:ticket 27
#   npm run test:ticket 04
```
- **Exit Code 0**: Implementation 100% complete. All acceptance criteria and domain invariants verified.
- **Exit Code 1**: Implementation incomplete or regressing. Failing criteria and test output displayed.

### Backlog Compliance Audit Matrix
```bash
npm run test:tickets:audit
```
Executes all ticket suites and outputs the high-density compliance matrix showing which tickets are `PASS [x]` vs `FAIL [ ]`.

### Suite Execution
- `npm run test:tickets`: Runs all ticket acceptance suites sequentially.
- `npm test`: Runs standard production regression tests (`tests/*.test.ts`).

---

## 2. Core Harness Invariants

1. **Falsifiable RED Rule**:
   - Acceptance tests must be written as genuine behavioral specifications against target interfaces, Zod schemas, fixtures, and database transactions.
   - Tests for pending tickets must fail (RED) for exact technical reasons (e.g. missing module, schema invariant error, unhandled status).
   - **Banned**: Placeholder stubs like `assert.fail("Pending implementation")` or expectation-free tests.
2. **Deterministic Exit Codes**:
   - Gating commands must exit with `0` on complete success and `1` on any unmet criteria.
3. **Adaptive Gating for Infrastructure**:
   - System/external boundary tickets (Docker, Cloudflare R2, webhooks, CLI) execute 100% hermetically offline by default using static contract assertions, subprocess exit assertions, and in-process loopback servers (ADR-0007).
4. **Decoupled Production Suite**:
   - `npm test` remains the hermetic regression suite for current production code so Husky pre-commit hooks pass, while `npm run test:ticket <id>` acts as the active TDD validation gate.

---

## 3. Directory Layout & Registry

- **Harness Registry**: `scripts/harness/tickets.ts`
- **Runner Script**: `scripts/test-tickets.ts`
- **Ticket Acceptance Tests**: `tests/tickets/ticket-XX.test.ts`

When creating a new ticket gate:
1. Register ticket metadata, objective, and acceptance criteria in `scripts/harness/tickets.ts`.
2. Author the acceptance suite in `tests/tickets/ticket-XX.test.ts`.
3. Verify test is falsifiable RED with `npm run test:ticket <id>`.
