# Technical Specification: gridlock-scraper Deployment & Runtime Topology

## 1. Overview & Motivation
- **Purpose**: Defines the hosting, scheduling, persistence synchronization, and runtime execution specification for `gridlock-scraper`.
- **Target Invariant**: Decoupled batch compute execution. Browser automation must execute in a containerized Linux environment ([ADR-0001](file:///C:/Users/Owner/projects/gridlock-scraper/docs/adr/0001-playwright-browser-only-ingestion.md)) while remaining isolated from downstream presentation edge gateways ([docs/integration.md](file:///C:/Users/Owner/projects/gridlock-scraper/docs/integration.md)).

---

## 2. Architecture & Seams

### 2.1 Topology & Execution Phases

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 1 Ingestion Runtime: GitHub Actions Cron (.github/workflows/)    │
│ Phase 2 Ingestion Runtime: Cloud Run Job / Dedicated VPS (Hetzner)     │
│ • Container: mcr.microsoft.com/playwright:v1.63.0-noble (Node.js 22)   │
│ • Execution: Unprivileged 'pwuser' with Playwright Chromium            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌─────────────────────────────────────┐   ┌──────────────────────────────────┐
│ Pre-Run State Ingestion Hook        │   │ Post-Run State Publishing Hook   │
│ • Pull latest 'gridlock.db' from R2 │   │ • Push updated 'gridlock.db'     │
│ • Fetch artifact SHA-256 cache      │   │ • Sync new raw blobs to R2       │
│                                     │   │ • Publish dist/exports/*.json    │
└─────────────────────────────────────┘   └──────────────────────────────────┘
```

1. **Two-Phase Hosting Strategy**:
   - **Phase 1 (Immediate / MVP / Verification)**: **GitHub Actions Scheduled Workflow** (`.github/workflows/ingest.yml`).
     - **Cadence**: Cron schedule (`cron: '0 */6 * * *'`).
     - **Runner**: `ubuntu-latest` with native Playwright Chromium support.
     - **Storage Lifecycle**: Pulls previous `gridlock.db` state from Cloudflare R2 before sweep; pushes updated SQLite database and new artifacts to R2 upon completion.
   - **Phase 2 (Production / Dedicated)**: **Google Cloud Run Job** or **Dedicated Linux VPS** ($4–$6/mo on Hetzner Cloud / DigitalOcean).
     - **Rationale**: Provides static datacenter/residential IP to eliminate CDN bot challenges (Cloudflare Turnstile, Akamai) on Texas government portals (TDLR, ERCOT, TCEQ), and persistent NVMe disk for local SQLite without pre/post network sync overhead.

2. **Container Specification (`Dockerfile`)**:
   - **Base Image**: `mcr.microsoft.com/playwright:v1.63.0-noble`.
   - **Node Runtime**: Node.js >= 22 (ESM).
   - **Execution Command**: `node dist/cli.js --all`.
   - **Security**: Runs as non-root `pwuser`.

3. **CLI Execution Contract (`src/cli.ts`)**:
   - **Interface**:
     ```typescript
     export interface CliArgs {
       source?: "tdlr" | "ercot" | "tceq" | "municipal" | "all";
       dryRun?: boolean;
       force?: boolean;
     }
     ```
   - **Exit Codes**:
     - `0`: Ingestion completed cleanly or content-hash early exit triggered.
     - `1`: Fatal network / runtime crash.
     - `2`: Invariant breach / selector anomaly quarantined (triggers out-of-band repair alert).

4. **Environment & Secrets Matrix**:
   - `CLOUDFLARE_R2_ACCOUNT_ID`: Cloudflare account identifier.
   - `CLOUDFLARE_R2_ACCESS_KEY_ID`: S3-compatible R2 access key.
   - `CLOUDFLARE_R2_SECRET_ACCESS_KEY`: S3-compatible R2 secret key.
   - `CLOUDFLARE_R2_BUCKET_NAME`: Target artifact bucket (e.g. `gridlock-artifacts`).
   - `GEMINI_API_KEY`: Google GenAI API key for Gemini 2.5 Flash repair agent.
   - `ALERT_WEBHOOK_URL`: Optional Discord/Slack webhook for anomaly notifications.

---

## 3. Edge Cases & Resilience

1. **State Pull Failure (First Run / Network Blip)**:
   - If `gridlock.db` does not exist on R2 (initial boot), the pre-run hook initializes a fresh SQLite database using `DDL_SCHEMA` from `src/storage/db.ts`.
2. **Post-Run Push Failure**:
   - Uploads to R2 must be atomic. The new SQLite file is uploaded to a temporary key (`gridlock.db.tmp.<timestamp>`) and moved/promoted to `gridlock.db` only after checksum verification.
3. **Texas State Portal Bot Blocking**:
   - If an agency returns HTTP 403/503 or CAPTCHA challenge, the extractor halts without retry storms, records `bot_block` telemetry, and exits with code `2`.

---

## 4. Acceptance Criteria

- [ ] **Containerized Production Build**:
  - *Given* the official Playwright base image `mcr.microsoft.com/playwright:v1.63.0-noble`,
  - *When* `docker build -t gridlock-scraper .` executes,
  - *Then* the build completes with zero vulnerabilities, installs Chromium dependencies, and compiles TypeScript source cleanly.
- [ ] **Pre-Run State Hydration & Post-Run Push**:
  - *Given* an ephemeral runner execution (GitHub Actions / Cloud Run Job),
  - *When* the scraper initializes,
  - *Then* it pulls the latest `gridlock.db` and artifact manifest from Cloudflare R2; and upon successful ingestion, uploads the mutated SQLite database, new `.artifacts/` blobs, and `dist/exports/*.json` with verified SHA-256 checksums.
- [ ] **Deterministic CLI Exit Codes**:
  - *Given* a running connector sweep via `src/cli.ts`,
  - *When* an invariant failure or selector anomaly is quarantined,
  - *Then* the process logs the failure to `repair_audits` and exits with code `2`, notifying downstream monitoring without corrupting the canonical database.
- [ ] **Content-Hash Early Exit in Production**:
  - *Given* an unchanged remote filing on TDLR/ERCOT,
  - *When* the scheduled job executes against an existing hash,
  - *Then* the job terminates in $<5$ seconds with zero database writes, touching only `last_run_at`.

---

## 5. Non-Goals (Out of Scope)

1. **Continuous 24/7 Web Server**: `gridlock-scraper` is a batch job, not a public HTTP API server.
2. **Direct Edge Worker Hosting**: Headless Chromium will not run in standard Cloudflare Worker isolates.
3. **Automatic Git Commits from Repair Agent**: Repaired manifests are updated in `connector_configs.manifest` in SQLite, not written back to Git source files automatically.
