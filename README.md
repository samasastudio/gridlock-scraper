# Gridlock Scraper (`gridlock-scraper`)

Deterministic, provenance-first web scraping and data ingestion engine for Texas electric grid infrastructure, large flexible load queues, and municipal planning dockets.

---

## 1. System Architecture

`gridlock-scraper` follows a **Step-Layered Architecture** (ADR-0002) driven by an immutable event-sourcing and provenance model:

```text
Playwright Extractor (src/extractors/)
        │
        ▼ (raw payload: HTML / XLSX / PDF)
ArtifactStore (src/storage/) ──► SHA-256 Hash Check (ADR-0003)
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼ (Hash Exists)                               ▼ (New Hash)
         Early Exit                                    Pure Parser (src/parsers/)
     (Zero write overhead)                                   │
                                                             ▼ (Zod Invariant Gate)
                                                    Source Artifact & Observations
                                                    Committed to SQLite (src/storage/)
```

1. **Browser-Only Playwright Execution** ([ADR-0001](file:///c:/Users/Owner/projects/gridlock-scraper/docs/adr/0001-playwright-browser-only-ingestion.md)): Standardized on Chromium to handle ASP.NET WebForms session postbacks (`__VIEWSTATE`), dynamic SPAs, and file downloads uniformly.
2. **Step-Layered Organization** ([ADR-0002](file:///c:/Users/Owner/projects/gridlock-scraper/docs/adr/0002-step-layered-organization.md)): Strict layer separation between extraction (`src/extractors/`), pure parsing (`src/parsers/`), validation (`src/schemas/`), and storage (`src/storage/`).
3. **Content-Hash Gated Idempotency** ([ADR-0003](file:///c:/Users/Owner/projects/gridlock-scraper/docs/adr/0003-content-hash-gated-idempotency.md)): Raw payloads are hashed immediately with SHA-256; existing hashes short-circuit downstream processing.
4. **Out-of-Band Self-Healing Replay** ([ADR-0004](file:///c:/Users/Owner/projects/gridlock-scraper/docs/adr/0004-out-of-band-self-healing-replay.md)): Selector breaks trigger an `"anomaly"` quarantine. Candidate patches must pass 100% of historical fixture replays before promotion.
5. **Fixture-First Offline Testing** ([ADR-0005](file:///c:/Users/Owner/projects/gridlock-scraper/docs/adr/0005-fixture-first-offline-testing.md)): Default test runs (`npm test`) execute hermetically offline against frozen fixtures in `tests/fixtures/` and in-memory SQLite.

---

## 2. Texas Infrastructure Scope

Ingestion targets the Data Center Trilemma (Large, Fast, Firm) and grid constraints across Texas:
- **TDLR TABS**: Texas Architectural Barriers commercial project filings (substations, data center shells, industrial plants).
- **ERCOT Interconnection Queue**: Generation Interconnection Status (GIS) spreadsheets and Large Flexible Load queues (MW capacity, fuel, POI, county).
- **TCEQ**: Environmental air standard permits, water utility authorizations, and backup generator emissions dockets.
- **Municipal Agendas**: Planning commission and city council zoning, annexation, and utility tie-in dockets (Austin, Taylor, San Marcos, Round Rock, etc.).

---

## 3. Directory Layout

```text
src/
├── extractors/     # Playwright automation scripts per source family
├── parsers/        # Pure transformation functions: f(raw_payload) -> ObservationCandidate[]
├── schemas/        # Zod validation contracts and domain invariants
├── jobs/           # Pipeline runners, deduplication, and transaction boundaries
├── storage/        # Content-addressable ArtifactStore & Drizzle SQLite repository
├── repair/         # Quarantine handler and replay sandbox
├── index.ts        # Public library exports
└── schema.ts       # Canonical Drizzle ORM schema definitions
tests/
├── fixtures/       # Frozen sanitized HTML, PDF, and CSV captures
├── live/           # Gated live network smoke tests (LIVE_TEST=1)
├── parsers.test.ts # Pure offline parser unit tests
├── pipeline.test.ts# Pipeline idempotency and anomaly quarantine tests
└── schema.test.ts  # Database schema foreign key integrity tests
```

---

## 4. Verification & Testing

```bash
# Run hermetic offline test suite (node:test + in-memory SQLite)
npm test

# Run TypeScript typecheck
npm run typecheck

# Install Chromium browser binaries for Playwright
npm run install:browsers

# Run live network smoke tests against remote portals
LIVE_TEST=1 npm test
```

---

## 5. Architectural References

- [CONTEXT.md](file:///c:/Users/Owner/projects/gridlock-scraper/CONTEXT.md): Ubiquitous language glossary and 10 binding system constraints.
- [AGENTS.md](file:///c:/Users/Owner/projects/gridlock-scraper/AGENTS.md): Steering doctrine, project stack invariants, and test verification standards.
- [docs/adr/](file:///c:/Users/Owner/projects/gridlock-scraper/docs/adr/): Architecture Decision Records (ADR-0001 through ADR-0005).
- [docs/connectors/](file:///c:/Users/Owner/projects/gridlock-scraper/docs/connectors/): Source family connector specifications.
- [docs/integration.md](file:///c:/Users/Owner/projects/gridlock-scraper/docs/integration.md): Downstream export contract.
