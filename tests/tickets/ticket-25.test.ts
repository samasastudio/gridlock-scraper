import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCandidatePatch } from "../../src/repair/replay.js";
import { createDatabase, ScraperRepository } from "../../src/storage/db.js";

test("Ticket 25 - Criteria 1 & 2: Updates connector_configs.manifest atomically with proposed patch upon 100% replay pass", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants, last_status)
    VALUES ('tdlr_v1', 'tdlr_tabs', '{"version": 1, "selector": ".old-selector"}', '{}', 'anomaly')
  `).run();

  const proposedPatch = {
    version: 2,
    selector: "#ctl00_ContentPlaceHolder1_lblProjectNumber",
    strategy: "semantic_table_lookup",
  };

  const fixtureContent = `<html><body><span id="ctl00_ContentPlaceHolder1_lblProjectNumber">TABS2024888</span></body></html>`;

  const result = await evaluateCandidatePatch(
    "tdlr_v1",
    proposedPatch,
    () => [
      {
        subjectType: "project",
        subjectId: "TABS2024888",
        property: "name",
        valueJson: { name: "Repaired Project" },
      },
    ],
    [
      {
        id: "fix-1",
        content: fixtureContent,
        expectedMinCount: 1,
        expectedSubjectIds: ["TABS2024888"],
      },
    ],
    db
  );

  assert.equal(result.allPassed, true);

  // Check database persistence in connector_configs.manifest
  const config = await repo.getConnectorConfig("tdlr_v1");
  assert.equal(config?.lastStatus, "ok");

  const manifest = typeof config?.manifest === "string" ? JSON.parse(config.manifest) : config?.manifest;
  assert.equal(
    manifest?.selector,
    "#ctl00_ContentPlaceHolder1_lblProjectNumber",
    "connector_configs.manifest must be updated with the proposed patch description upon promotion"
  );
  assert.equal(manifest?.version, 2);
});

test("Ticket 25 - Criteria 3: Subsequent scraper executions load updated selectors from connector_configs.manifest", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ArtifactStore } = await import("../../src/storage/artifact-store.js");

  const tempDir = mkdtempSync(join(tmpdir(), "gridlock-ticket25-"));
  const store = new ArtifactStore(tempDir);
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await repo.ensureConnectorConfigs([
    {
      id: "tdlr_v1",
      sourceFamily: "tdlr_tabs",
      manifest: {
        version: 2,
        selector: "#ctl00_ContentPlaceHolder1_lblProjectNumber",
      },
      lastStatus: "ok",
    },
  ]);

  let passedManifest: any = null;

  const { runScraperPipeline } = await import("../../src/jobs/runner.js");
  const result = await runScraperPipeline({
    connectorId: "tdlr_v1",
    sourceFamily: "tdlr_tabs",
    extractor: async () => ({
      sourceFamily: "tdlr_tabs" as const,
      sourceUrl: "https://example.com/tabs",
      contentType: "text/html",
      byteSize: 100,
      content: `<html><body><span id="ctl00_ContentPlaceHolder1_lblProjectNumber">TABS2024999</span><span id="ctl00_ContentPlaceHolder1_lblProjectName">Test</span><span id="ctl00_ContentPlaceHolder1_lblEstimatedCost">$100,000</span><span id="ctl00_ContentPlaceHolder1_lblCity">Austin</span><span id="ctl00_ContentPlaceHolder1_lblCounty">Travis</span></body></html>`,
      connectorVersion: "1.0.0",
    }),
    parser: (content, manifest) => {
      passedManifest = manifest;
      return [
        {
          subjectType: "project",
          subjectId: "TABS2024999",
          property: "status",
          valueJson: { status: "active" },
          confidence: 1.0,
          resolutionMethod: "deterministic",
        },
      ];
    },
    artifactStore: store,
    db,
  });

  assert.equal(result.observationsCount, 1);
  assert.ok(passedManifest, "Subsequent pipeline execution must pass manifest to parser");
  assert.equal(
    passedManifest.selector,
    "#ctl00_ContentPlaceHolder1_lblProjectNumber"
  );
  assert.equal(passedManifest.version, 2);

  rmSync(tempDir, { recursive: true, force: true });
});

