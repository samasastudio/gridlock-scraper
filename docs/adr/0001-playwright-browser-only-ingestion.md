# ADR-0001: Headless Playwright Browser-Only Ingestion Architecture

## Status
Accepted

## Context & Problem Statement
Gridlock Scraper ingests technical, environmental, and infrastructure data across diverse Texas government sources:
1. **TDLR TABS**: Legacy ASP.NET WebForms requiring stateful session maintenance, `__VIEWSTATE`, and postback events.
2. **TCEQ & Municipal Portals**: Intermittent client-side JavaScript rendering, CAPTCHA hurdles, and cookie-dependent pagination.
3. **ERCOT Interconnection Queues & Municipal Agendas**: Direct XLSX, CSV, and PDF asset downloads.

We needed to decide whether to maintain a bifurcated engine (raw HTTP `fetch` for static files + Playwright for dynamic portals), adopt an external framework (Crawlee), or standardize entirely on headless Playwright.

## Decision
Adopt **Browser-Only Playwright** as the sole ingestion runtime across all connectors.
- All requests run within Playwright browser contexts (`chromium`).
- Direct file downloads (ERCOT XLSX/CSV, municipal PDFs) are captured via Playwright's download lifecycle handlers.
- Concurrency and resource bounds are enforced via an internal browser context pool and explicit concurrency gates (`p-limit`).

## Consequences
- **Positive**:
  - Unified operational surface: single execution model, uniform cookie and header handling, zero protocol bifurcation.
  - Native handling of ASP.NET `__VIEWSTATE` postbacks and interactive JS SPAs without reverse-engineering hidden form fields.
  - Full DOM inspection, screenshot capture on failure, and trace debugging available across all source families.
- **Negative / Trade-offs**:
  - Higher memory and CPU footprint compared to lightweight HTTP clients.
  - Requires strict browser context lifecycle discipline (page reuse, explicit teardown) to avoid memory leaks and orphan browser processes.
  - Headless browser startup latency must be managed via persistent warm contexts.
