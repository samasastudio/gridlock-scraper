# ADR-0007: Adaptive Infrastructure Acceptance Testing

## Status
Accepted

## Context & Problem Statement
Multiple backlog tickets in `gridlock-scraper` deal with infrastructure boundaries:
- **Ticket 19**: Docker containerization with Playwright base image.
- **Ticket 20**: Ingestion CLI entrypoint and exit codes.
- **Ticket 21**: Cloudflare R2 state hydration and snapshot publishing.
- **Ticket 22**: Scheduled ingestion workflow and webhook alerts.

Running real Docker builds, calling live Cloudflare R2 buckets, or requiring external webhook receivers during standard test execution violates ADR-0005 (Fixture-First Hermetic Testing) and causes brittle test failures in CI or offline development environments.

## Decision
All infrastructure ticket acceptance tests must follow an **Adaptive Gating** pattern:
1. **Default Hermetic Execution (Offline)**:
   - **Docker**: Static inspection of Dockerfile instructions (base image `mcr.microsoft.com/playwright`, non-root user `pwuser`, working directory, command entrypoint).
   - **CLI**: Execute entrypoint using Node `child_process` against isolated in-memory or fixture environments, verifying standard output, standard error, and exit codes (0 for clean execution, 1 for anomaly quarantine, 2 for fatal configuration error).
   - **Cloudflare R2**: Contract testing using an in-memory S3/R2 mock adapter validating API calls, metadata headers, and upload/download streams.
   - **Webhooks & Schedulers**: In-process loopback `node:http` servers validating dispatch payloads, headers, and retry policies.
2. **Gated Live Execution (Optional)**:
   - When explicit environment variables are present (`LIVE_TEST=1`, `DOCKER_TEST=1`), execute real container builds or live network integration tests.
   - If flags are absent, skip the live phase cleanly without failing the suite.

## Consequences
- **Positive**: 100% test pass rate in offline environments. Instant test feedback (< 2 seconds). Preserves ADR-0005 invariants while thoroughly testing infrastructure logic.
- **Negative / Trade-offs**: Real container runtime nuances (e.g. Linux kernel cgroup constraints, live R2 authentication failures) are not caught unless live flags are explicitly enabled.
