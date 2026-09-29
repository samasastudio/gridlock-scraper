---
name: gridlock-code-review
description: Comprehensive dual-mode code review engine for Gridlock repositories. Handles inbound pull request review comment triage with standardized 4-part analysis and outbound pre-PR diff auditing enforcing the 32 Gridlock Core Architectural Invariants and validation gates.
---

# Gridlock Code Review & Invariant Enforcement

Dual-mode code review workflow built specifically for Gridlock repositories, combining rigorous outbound pre-PR diff auditing with standardized inbound review comment triage.

---

## 1. Priority & Severity Taxonomy

Every finding or comment must carry an explicit plain-text priority tag:

* **`[P0]` — Critical / Security / Irreversible Data Loss**: Vulnerabilities, credential leaks, destructive data operations without rollback, or remote state deletion/overwriting.
* **`[P1]` — Architectural Invariant Breach / Functional Defect**: Violations of the 32 Core Architectural Invariants (ADRs), schema bypasses, untyped raw SQL, unhandled promise rejections, logic regressions, or false-positive pass gates.
* **`[P2]` — Resilience / Edge Case / Telemetry Mismatch**: Improper MIME/extension deduction, incomplete error logging, missing boundary conditions, or unmapped telemetry metrics.
* **`[Nit]` — Stylistic Polish / Optimization Opportunity**: Naming clarity, dead code removal, minor refactoring, or documentation typos.

---

## 2. Mode A: Inbound PR Review Comment Triage

When reviewing, presenting, or addressing pull request comments (from human reviewers, automated bots like Codex, or static analyzers), structure **every comment** into four explicit sections:

### Mandatory 4-Part Structure:

1. **Comment**:
   * Plainly state the comment identifier and verbatim content.
   * Prefix with the plain-text priority tag (`[P0]`, `[P1]`, `[P2]`, `[Nit]`).
   * **STRICT UI INVARIANT**: Never embed raw markdown image badges (e.g. `![P1 Badge](https://img.shields.io/...)` or shields.io SVGs). In the Antigravity chat renderer, unconstrained SVGs expand to 100% container width, creating illegible full-screen billboards. Use plain text only.

2. **Explanation**:
   * Explain plainly what the comment means.
   * Detail the concrete failure scenario, edge case, or bug the reviewer identified.
   * State the operational or data integrity impact if left unaddressed.

3. **Thoughts**:
   * Provide an evidence-based, critical assessment.
   * Evaluate validity, severity, and architectural alignment.
   * Explicitly cite relevant ADRs (ADR-0001 through ADR-0008) or numbered invariants from `AGENTS.md`.
   * **Spec Anchor & Anti-Bloat Audit**:
     * *Falsifiable Defect Check*: Does this comment fix a demonstrable bug or enforce an existing invariant, or is it speculative defensiveness?
     * *Domain Semantics Check*: Does the suggested check break legitimate domain behavior (e.g. treating valid empty query results as fatal anomalies)?
     * *Layer Seam Defense*: Does the change contaminate component boundaries (e.g. passing patch manifests to binary extractors)?
     * *Pushback Protocol*: If the recommendation causes lateral drift, bloat, or violates domain rules, explicitly push back and reject or scope down the recommendation. Do NOT reflexively adopt comments to please the reviewer.

4. **Proposed Solution**:
   * Provide concrete, technically exact code blocks or diffs.
   * Specify exact file paths and line ranges.
   * State the verification command to confirm the fix.
   * If rejected during pushback, state the rationale and why no code changes are warranted.

---

## 3. Mode B: Outbound Pre-PR Diff Audit

Before submitting a pull request, creating a branch, or concluding a coding task, audit the full `git diff` against the following checklists:

### Checklist 1: The 32 Gridlock Core Architectural Invariants

- [ ] **1. Provenance First**: Every observation links to a cryptographically hashed `source_artifact`.
- [ ] **2. Browser-Only Playwright**: Single execution runtime for external Texas portals (ADR-0001).
- [ ] **3. Step-Layered Organization**: Strict layer separation across `extractors`, `parsers`, `schemas`, `storage`, and `repair` (ADR-0002).
- [ ] **4. Content-Hash Early-Exit**: Deduplicates runs using SHA-256 before parser execution or database mutation (ADR-0003).
- [ ] **5. Out-of-Band Self-Healing**: Selector drift halts with `"anomaly"` state; repair patches verified against replay harness (ADR-0004).
- [ ] **6. Fixture-First Offline Testing**: All standard tests execute hermetically offline against frozen fixtures in `tests/fixtures/` and in-memory SQLite (ADR-0005).
- [ ] **7. Texas Infrastructure Scope**: Ingestion spans ERCOT, TDLR, TCEQ, and Texas statewide bodies; never restrict scope to Austin municipal limits.
- [ ] **8. Typed ORM Only**: Untyped raw SQL strings (`db.prepare(...)`) are strictly prohibited; all queries use typed Drizzle schema (`src/schema.ts`).
- [ ] **9. Windows PowerShell Invariant**: Never chain commands with `&&` in PowerShell (causes fatal `ParserError`); separate with `;` or run in distinct invocations.
- [ ] **10. The Legible Diagram Invariant**: Modular sub-flows with explicit font sizes (`fontSize: 15px`); never cram monolithic charts.
- [ ] **11. Zero Synthetic Defaults**: Never use fallbacks (`|| 0`, `|| "Austin"`, `|| "under_review"`, `|| "zoning"`) to satisfy schema contracts. Missing fields must fail Zod invariants and trigger quarantine.
- [ ] **12. Transactional Provenance**: `source_artifacts` insertion, observation emission, and connector status updates execute atomically inside `this.drizzle.transaction`.
- [ ] **13. Mandatory Replay Oracles**: Replay fixtures specify semantic assertions (`expectedMinCount`, `expectedSubjectIds`, `expectedAssertion`); loose count-only promotion is banned.
- [ ] **14. Agent Validation Gate Invariant**: Backlog tickets verified with dedicated falsifiable RED gates (`tests/tickets/ticket-XX.test.ts`).
- [ ] **15. Bounded Anomaly Promotion**: Candidate self-healing repair patches are strictly bound to specific quarantined failure records.
- [ ] **16. CLI Script Executability**: Operational scripts in `scripts/` are directly invokable via CLI entrypoint guards.
- [ ] **17. Decomposed Factory Returns**: Client/service factories return composed function references; no multi-line async methods inline inside object literals.
- [ ] **18. Execution Integrity**: CLI entrypoints and Docker containers wire live database repositories and pipeline runners; returning unconditional success without executing pipelines is strictly prohibited.
- [ ] **19. Functional Transforms & Flat Control Flow**: Pure array methods and standard library primitives over mutable loops; inline architectural rationale comments on required loops.
- [ ] **20. No Silent Candidate Filtering**: Strategy parsers select by structural document presence, not candidate validity; filtering malformed items before validation is banned.
- [ ] **21. Preserved Initial Attempt & Public Replay Diagnostics**: Retry utilities execute attempt 0 even when `maxRetries: 0`; replay harnesses expose `details: SingleFixtureEvaluation[]` directly on public contracts.
- [ ] **22. Terminal Quarantined Artifact Binding**: When evaluating repair promotion, explicit `quarantinedArtifactId` mismatch immediately returns `false` without falling through to temporal checks.
- [ ] **23. Fail-Closed Remote State Hydration**: Remote sync utilities strictly isolate HTTP 404 / `NoSuchKey` for empty-store initialization. All timeouts, auth errors, and 5xx responses abort execution immediately.
- [ ] **24. Binary Buffer Preservation**: Handlers of binary payloads (`.xlsx`, `.pdf`, `.zip`) preserve raw `Buffer` bitstreams without intermediate `.toString("utf8")` conversion.
- [ ] **25. Container Ingress & Privilege Demotion**: HTTP servers bind to `0.0.0.0` by default; Dockerfiles pre-create and `chown -R pwuser:pwuser` writable directories before `USER pwuser`.
- [ ] **26. Spreadsheet MIME Precedence**: MIME-type extension derivation checks OpenXML and Excel tokens (`spreadsheetml`, `xlsx`, `ms-excel`, `xls`) prior to generic XML/HTML checks.
- [ ] **27. Hydration-Gated State Publishing**: Workflow pipelines that publish state to persistent remote storage strictly gate execution on successful pre-run hydration (`steps.sync-hydrate.outcome == 'success'`); publishing under `always()` is prohibited.
- [ ] **28. Fail-Fast Remote Sync Credentials**: State synchronization utilities throw fatal errors on absent or empty remote credentials (`CLOUDFLARE_R2_*`); returning mock no-op clients or synthesizing empty databases on publish is prohibited.
- [ ] **29. Replay Binary Preservation**: Replay verification harnesses accept `string | Buffer` and pass raw buffers directly to candidate parsers without `.toString("utf8")`.
- [ ] **30. Blob-First State Publishing**: Content-addressable artifact blobs in `.artifacts/` must be synchronized prior to uploading the SQLite database snapshot (`gridlock.db`).
- [ ] **31. Reprocessing Anomaly Restoration**: When reprocessing quarantined payloads against candidate repair patches (`handleExistingArtifactMatch`), candidate parse/validation failures immediately restore `connector_configs.last_status = 'anomaly'`.
- [ ] **32. Spec-Anchored Review & Anti-Bloat**: Inbound review comments audited against domain specifications, ADRs, and verification harnesses before adoption; speculative bloat, unnecessary layer parameter threading, and lateral drift rejected.

### Checklist 2: General Engineering Quality
- [ ] **TypeScript Strictness**: No implicit `any`, no untyped type assertions (`as any`) unless wrapping low-level external mocks.
- [ ] **Async Hygiene**: No unhandled promise rejections; all async operations within Express/HTTP handlers or background sweeps are guarded with `.catch()`.
- [ ] **Conventional Commits**: Commit messages follow `@commitlint/cli` standards (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`).

---

## 4. Mandatory Verification Gate Commands

Before approving an outbound diff or declaring inbound review comments resolved, execute all three verification gates:

```powershell
# 1. Typecheck
npm run typecheck

# 2. Hermetic Offline Test Suite
npm test

# 3. Backlog Compliance Gates (if tickets were touched)
npm run test:tickets
```

**Approval Criteria**:
A code review passes and may be merged if and only if:
1. Zero `[P0]` or `[P1]` issues remain unaddressed.
2. All 32 Core Architectural Invariants are satisfied.
3. All three verification commands exit with code `0`.
