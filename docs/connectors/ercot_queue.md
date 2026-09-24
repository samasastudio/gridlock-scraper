# Connector Specification: ERCOT Interconnection Queue (`ercot_queue`)

Electric Reliability Council of Texas (ERCOT) Generation Interconnection Status (GIS) spreadsheets and Large Flexible Load (LFL) queues. Primary source for proposed generation, standalone battery storage (BESS), and transmission interconnection requests.

---

## 1. Upstream Protocol & Characteristics
- **Platform**: ERCOT Grid Information portal.
- **Payload Format**: Monthly published Microsoft Excel (`.xlsx`) or CSV files.
- **Target URL Pattern**: `https://www.ercot.com/gridinfo/generation`
- **Frequency**: Monthly / Bi-weekly poll.

---

## 2. Extraction Pipeline (`src/extractors/ercot.ts`)
- Navigates via Playwright context with `acceptDownloads: true`.
- Intercepts dynamic file download events or page tables.
- Captures raw XLSX/CSV file buffer.

---

## 3. Invariants & Zod Contracts (`src/schemas/ercot.ts`)
- `inrNumber`: Non-empty interconnection request string (e.g. `24INR0412`).
- `projectName`: Non-empty string.
- `capacityMw`: Strictly positive float (`> 0`).
- `county`: Valid non-empty Texas county.
- `fuelType`: Recognizable fuel category (`SOL`, `WND`, `BAT`, `GAS`, `LOAD`).

---

## 4. Pure Parsing (`src/parsers/ercot.ts`)
- Maps tabular columns:
  - Interconnection Request Number (`INR`)
  - Project Name / Developer
  - Fuel Type & Technology
  - MW Capacity (Summer / Winter ratings)
  - County & Transmission Service Provider (TSP)
- Emits atomic observations:
  - `subject: facility (id: inrNumber)` -> `property: "power_capacity_mw"`
  - `subject: facility (id: inrNumber)` -> `property: "fuel_type"`
  - `subject: location (id: county)` -> `property: "county"`
