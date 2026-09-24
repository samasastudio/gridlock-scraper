# Connector Specification: TCEQ Environmental Authorizations (`tceq`)

Texas Commission on Environmental Quality (TCEQ) Central Registry and Commissioners' Integrated Database (CID). Tracks air standard permits for backup diesel generators, stormwater pollution prevention plans, and industrial water authorizations.

---

## 1. Upstream Protocol & Characteristics
- **Platform**: TCEQ Central Registry / Air Permitting portal.
- **Payload Format**: HTML query tables, docket listings, PDF authorizations.
- **Target URL Pattern**: `https://www.tceq.texas.gov/permitting/air`
- **Frequency**: Weekly poll.

---

## 2. Extraction Pipeline (`src/extractors/tceq.ts`)
- Navigates via Playwright, sets session cookies, queries permit numbers or applicant names.
- Captures raw authorization HTML / PDF payloads.

---

## 3. Invariants & Zod Contracts (`src/schemas/tceq.ts`)
- `permitNumber`: Non-empty authorization identifier (e.g. `TCEQ-189421`).
- `actionType`: `air_standard_permit` | `water_authorization` | `stormwater` | `waste`.
- `applicantName`: Non-empty legal entity name.
- `county`: Non-empty Texas county.

---

## 4. Pure Parsing (`src/parsers/tceq.ts`)
- Extracts applicant entity, permit number, effective dates, and facility name.
- Emits atomic observations:
  - `subject: project (id: permitNumber)` -> `property: "environmental_permit"`
  - `subject: organization (id: applicantName)` -> `property: "legal_name"`
