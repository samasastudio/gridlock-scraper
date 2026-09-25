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
