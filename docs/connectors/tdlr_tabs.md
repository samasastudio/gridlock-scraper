# Connector Specification: TDLR TABS (`tdlr_tabs`)

Texas Department of Licensing and Regulation (TDLR) Architectural Barriers Online System (TABS). Tracks commercial and industrial building project registrations, estimated costs, square footage, and key milestones across Texas.

---

## 1. Upstream Protocol & Characteristics
- **Platform**: Legacy ASP.NET WebForms.
- **Session Mechanics**: Stateful sessions, requiring preservation of hidden form fields (`__VIEWSTATE`, `__EVENTVALIDATION`, `__VIEWSTATEGENERATOR`).
- **Target URL Pattern**: `https://www.tdlr.texas.gov/TABS/Search/Project/{projectNumber}`
- **Frequency**: Daily sweep of new filings.

---

## 2. Extraction Pipeline (`src/extractors/tdlr.ts`)
- Driven via headless Playwright (`chromium`).
- Submits query forms or navigates directly to project permalinks.
- Waits for `form#form1` stabilization (`networkidle` or `domcontentloaded`).
- Captures full HTML DOM string as raw payload.

---

## 3. Invariants & Zod Contracts (`src/schemas/tdlr.ts`)
- `projectNumber`: Must match `/^TABS\d+$/`.
- `projectName`: Non-empty string.
- `estimatedCostUsd`: Non-negative float.
- `city` / `county`: Non-empty string (default state `'TX'`).

---

## 4. Pure Parsing (`src/parsers/tdlr.ts`)
- Extract elements:
  - `#ctl00_ContentPlaceHolder1_lblProjectNumber`
  - `#ctl00_ContentPlaceHolder1_lblProjectName`
  - `#ctl00_ContentPlaceHolder1_lblEstimatedCost`
  - `#ctl00_ContentPlaceHolder1_lblSquareFootage`
  - `#ctl00_ContentPlaceHolder1_lblAddress`, `lblCity`, `lblCounty`
- Emits atomic observations:
  - `subject: project (id: projectNumber)` -> `property: "estimated_cost"`
  - `subject: project (id: projectNumber)` -> `property: "square_footage"`
  - `subject: location (id: city_county)` -> `property: "address_details"`
