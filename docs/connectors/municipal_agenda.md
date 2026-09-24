# Connector Specification: Municipal Agendas (`municipal_agenda`)

City council and planning commission meeting packets across Texas jurisdictions (Austin, Taylor, San Marcos, Hutto, Pflugerville, Round Rock). Ingests zoning change requests, industrial park annexations, and utility capacity allocations.

---

## 1. Upstream Protocol & Characteristics
- **Platform**: Granicus, Legistar, and municipal document portals.
- **Payload Format**: HTML agenda lists and meeting packets.
- **Target URL Pattern**: `https://www.austintexas.gov/department/city-council/council-meetings` (and peer municipal URLs).
- **Frequency**: Bi-weekly following municipal meeting publication schedules.

---

## 2. Extraction Pipeline (`src/extractors/municipal.ts`)
- Navigates via Playwright, scrolls through agenda items, and extracts case metadata and attached PDFs.

---

## 3. Invariants & Zod Contracts (`src/schemas/municipal.ts`)
- `actionIdentifier`: Case number (e.g. `C14-2024-0042`).
- `jurisdiction`: Texas city / municipal corporation name.
- `actionType`: `zoning` | `annexation` | `site_plan` | `building_permit` | `hearing`.
- `status`: `filed` | `under_review` | `approved` | `denied` | `withdrawn`.

---

## 4. Pure Parsing (`src/parsers/municipal.ts`)
- Extracts case numbers, ordinance amendments, applicant firms, and voting status.
- Emits atomic observations:
  - `subject: project (id: actionIdentifier)` -> `property: "municipal_zoning_action"`
