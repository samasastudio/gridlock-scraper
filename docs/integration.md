# Downstream Integration Contract

Defines the interface and boundary contracts between `gridlock-scraper` and downstream consumers in the Compute Atlas ecosystem.

---

## 1. Ecosystem Separation of Concerns

Each system lives in an independent Git repository:
1. **`gridlock-scraper`**: Ingestion, raw archival, pure parsing, invariant enforcement, and atomic observation recording.
2. **`gridlock-graphical-atlas`**: Geospatial vector cartography, transmission lines, substation topologies, and GIS plate rendering.
3. **`gridlock-generative-console`**: Dynamic investigative workspace translating intent into strongly-typed UI layouts.
4. **`sam-johnson-portfolio`**: Frontend presentation gateway.

> [!IMPORTANT]
> Zero Cross-Repo Runtime Code Sharing: Downstream consumers must never import internal scraper source code (`src/*`). Integration is strictly data-driven via exported artifacts, materialized SQLite databases, or JSON snapshots.

---

## 2. Export Artifacts & Data Payloads

`gridlock-scraper` produces two primary downstream outputs:

### 1. Materialized SQLite Snapshot (`dist/gridlock.db`)
A self-contained SQLite file containing fully projected and resolved target entities:
- `projects`: Resolved hyperscale data centers, battery campuses, industrial parks.
- `facilities`: Substations, chiller plants, generator yards.
- `infrastructure_relationships`: High-voltage interconnects, transmission line feeds, utility service boundaries.
- `observations`: Complete audit log of raw agency observations with cryptographic provenance.

### 2. Normalized JSON Data Dumps (`dist/exports/*.json`)
- `projects.json`: Array of active Texas projects with coordinates, power ratings, and operator slugs.
- `queues.json`: ERCOT interconnection queue summary with status and MW capacity.
- `provenance.json`: Source artifact hashes and agency filing references.

---

## 3. Schema Versioning & Compatibility

- Target entity tables adhere to semantic versions defined in `src/schema.ts`.
- Breaking schema changes increment major versions and require an accompanying ADR.
- All timestamps follow ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ssZ`).
