import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { parseTdlrHtml } from "../../src/parsers/tdlr.js";
import { validateTdlrInvariants } from "../../src/schemas/tdlr.js";
import * as schema from "../../src/schema.js";
import { createDatabase, ScraperRepository } from "../../src/storage/db.js";

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/tdlr/tabs-sample.html"
);

test("Ticket 03 - Criteria 1: Extracts project number, estimated cost, square footage, address, county, owner, and architect", () => {
  const html = fs.readFileSync(FIXTURE_PATH, "utf8");
  const observations = parseTdlrHtml(html);

  assert.ok(observations.length >= 6, "Must produce multiple atomic observations including owner and architect");

  const costObs = observations.find((o) => o.property === "estimated_cost");
  assert.ok(costObs, "Must extract estimated_cost property");
  assert.equal(costObs?.subjectId, "TABS2024098765", "Must extract project number as subjectId");
  assert.equal((costObs?.valueJson as any).usd, 450000000);

  const nameObs = observations.find((o) => o.property === "name");
  assert.ok(nameObs, "Must extract name property");
  assert.equal((nameObs?.valueJson as any).name, "Project Red River Hyperscale Data Center Phase 1");

  const sqftObs = observations.find((o) => o.property === "square_footage");
  assert.ok(sqftObs, "Must extract square_footage property");
  assert.equal((sqftObs?.valueJson as any).sqft, 385000);

  const locObs = observations.find((o) => o.subjectType === "location");
  assert.ok(locObs, "Must extract location observation");
  assert.equal((locObs?.valueJson as any).address, "12000 Tech Ridge Blvd");
  assert.equal((locObs?.valueJson as any).county, "Travis");

  const ownerObs = observations.find((o) => o.property === "owner");
  assert.ok(ownerObs, "Must extract owner property");
  assert.equal((ownerObs?.valueJson as any).owner, "Red River Hyperscale LLC");

  const archObs = observations.find((o) => o.property === "architect");
  assert.ok(archObs, "Must extract architect property");
  assert.equal((archObs?.valueJson as any).architect, "Corgan Associates Inc");
});

test("Ticket 03 - Criteria 2: Validates extracted records against Zod TdlrProjectSchema", () => {
  assert.throws(
    () => {
      validateTdlrInvariants({
        projectNumber: "INVALID_123",
        projectName: "Test Project",
        estimatedCostUsd: 1000,
        city: "Austin",
        county: "Travis",
      });
    },
    /Project number must start with TABS/,
    "Schema must reject malformed TABS identifiers"
  );
});

test("Ticket 03 - Criteria 3: Emits atomic observations rows linked to captured source_artifact_id", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  // Seed connector config
  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('tdlr_tabs_v1', 'tdlr_tabs', '{}', '{}')
  `).run();

  const { artifactId, observationsCount } = await repo.commitNewArtifactWithObservations({
    artifact: {
      sha256Hash: "c".repeat(64),
      sourceFamily: "tdlr_tabs",
      sourceUrl: "https://www.tdlr.texas.gov/TABS",
      contentType: "text/html",
      byteSize: 1024,
      storagePath: "/path/to/tdlr.html",
      connectorVersion: "v1.0.0",
    },
    observations: (id) => [
      {
        subjectType: "project",
        subjectId: "TABS2024098765",
        property: "estimated_cost",
        valueJson: { usd: 450000000 },
        sourceArtifactId: id,
        connectorVersion: "v1.0.0",
        confidence: 1.0,
        resolutionMethod: "deterministic",
      },
    ],
    connectorId: "tdlr_tabs_v1",
  });

  assert.equal(observationsCount, 1);
  const rows = await repo.drizzle
    .select()
    .from(schema.observations)
    .where(eq(schema.observations.sourceArtifactId, artifactId))
    .all();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceArtifactId, artifactId);
  assert.equal(rows[0].subjectId, "TABS2024098765");
});
