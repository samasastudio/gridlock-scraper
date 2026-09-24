# ADR-0006: Dedicated Per-Ticket Acceptance Testing Harness

## Status
Accepted

## Context & Problem Statement
The `gridlock-scraper` backlog contains 18 distinct tickets covering schema definitions, artifact stores, source extractors, pure parsers, repair sandboxes, and infrastructure plumbing. We need an objective, verifiable mechanism to assert that each ticket's acceptance criteria are 100% satisfied before marking tickets as "Done" on the project board.

We evaluated three approaches:
1. **Option 1A**: Dedicated per-ticket test files (`tests/tickets/ticket-XX.test.ts`).
2. **Option 1B**: Metadata tags in living domain test suites (`@ticket(XX)`).
3. **Option 1C**: Central acceptance oracle manifest (JSON/YAML mapping).

## Decision
Adopt **Option 1A**: Create dedicated test suites under `tests/tickets/ticket-XX.test.ts` for each ticket pertaining to `gridlock-scraper`. Each test file will:
1. Mirror the exact acceptance criteria items defined in the corresponding GitHub Project ticket.
2. Provide explicit assertions for every requirement and edge case specified in the ticket specification.
3. Integrate into the standard test runner (`npm test`) as permanent regression assertions.

## Consequences
- **Positive**: Unambiguous 1:1 traceability between GitHub issues and automated test assertions. Fast localized test execution (`tsx --test tests/tickets/ticket-XX.test.ts`). Clear DoD gating for agents and developers.
- **Negative / Trade-offs**: Acceptance tests will live alongside domain unit/integration suites, resulting in some duplicated verification logic. Test maintenance burden increases if shared internal implementation details change.
