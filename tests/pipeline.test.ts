import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { runScraperPipeline } from "../src/jobs/runner.js";
import { parseTdlrHtml } from "../src/parsers/tdlr.js";
import { evaluateCandidatePatch } from "../src/repair/replay.js";
import { ArtifactStore } from "../src/storage/artifact-store.js";
import { createDatabase } from "../src/storage/db.js";

const SAMPLE_TDLR_HTML = `
<html><body>
  <span id="ctl00_ContentPlaceHolder1_lblProjectNumber">TABS2024111222</span>
  <span id="ctl00_ContentPlaceHolder1_lblProjectName">Austin Substation Expansion</span>
  <span id="ctl00_ContentPlaceHolder1_lblEstimatedCost">$75,000,000</span>
  <span id="ctl00_ContentPlaceHolder1_lblCity">Austin</span>
  <span id="ctl00_ContentPlaceHolder1_lblCounty">Travis</span>
</body></html>
`;

test("Pipeline execution: initial run stores artifact and observations", async () => {
  const tempDir = mkdtempSync(`${tmpdir()}/gridlock-test-`);
  const store = new ArtifactStore(tempDir);
  const db = createDatabase(":memory:");

  // Seed connector config
  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('tdlr_v1', 'tdlr_tabs', '{}', '{}')
  `).run();

  const mockExtractor = async () => ({
    sourceFamily: "tdlr_tabs" as const,
    sourceUrl: "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2024111222",
    contentType: "text/html",
    byteSize: Buffer.byteLength(SAMPLE_TDLR_HTML),
    content: SAMPLE_TDLR_HTML,
    connectorVersion: "1.0.0",
  });

  const res1 = await runScraperPipeline({
    connectorId: "tdlr_v1",
    sourceFamily: "tdlr_tabs",
    extractor: mockExtractor,
    parser: parseTdlrHtml,
    artifactStore: store,
    db,
  });

  assert.equal(res1.earlyExit, false);
  assert.ok(res1.observationsCount > 0);
  assert.ok(res1.sourceArtifactId);

  // ADR-0003: Content-Hash Gated Early-Exit on identical payload
  const res2 = await runScraperPipeline({
    connectorId: "tdlr_v1",
    sourceFamily: "tdlr_tabs",
    extractor: mockExtractor,
    parser: parseTdlrHtml,
    artifactStore: store,
    db,
  });

  assert.equal(res2.earlyExit, true);
  assert.equal(res2.observationsCount, 0);
  assert.equal(res2.sha256Hash, res1.sha256Hash);

  rmSync(tempDir, { recursive: true, force: true });
});

test("Pipeline handles invariant failure by quarantining and marking anomaly", async () => {
  const tempDir = mkdtempSync(`${tmpdir()}/gridlock-test-anomaly-`);
  const store = new ArtifactStore(tempDir);
  const db = createDatabase(":memory:");

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('tdlr_broken', 'tdlr_tabs', '{}', '{}')
  `).run();

  const brokenHtml = "<html><body><div>Site under maintenance. No project data.</div></body></html>";

  const res = await runScraperPipeline({
    connectorId: "tdlr_broken",
    sourceFamily: "tdlr_tabs",
    extractor: async () => ({
      sourceFamily: "tdlr_tabs" as const,
      sourceUrl: "https://www.tdlr.texas.gov/broken",
      contentType: "text/html",
      byteSize: Buffer.byteLength(brokenHtml),
      content: brokenHtml,
      connectorVersion: "1.0.0",
    }),
    parser: parseTdlrHtml, // Will fail invariant because projectNumber is empty
    artifactStore: store,
    db,
  });

  assert.equal(res.anomaly, true);

  const statusRow = db
    .prepare("SELECT last_status FROM connector_configs WHERE id = 'tdlr_broken'")
    .get() as any;
  assert.equal(statusRow.last_status, "anomaly");

  const auditRow = db
    .prepare("SELECT * FROM repair_audits WHERE connector_id = 'tdlr_broken'")
    .get() as any;
  assert.ok(auditRow);
  assert.equal(auditRow.status, "pending_review");

  rmSync(tempDir, { recursive: true, force: true });
});

test("Self-healing replay harness verifies candidate patch against fixtures", async () => {
  const db = createDatabase(":memory:");

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('test_repair', 'tdlr_tabs', '{}', '{}')
  `).run();

  const fixtures = [
    { id: "fix-1", content: SAMPLE_TDLR_HTML },
  ];

  const evalResult = await evaluateCandidatePatch(
    "test_repair",
    { selector: "#ctl00_ContentPlaceHolder1_lblProjectNumber" },
    parseTdlrHtml,
    fixtures,
    db
  );

  assert.equal(evalResult.passed, 1);
  assert.equal(evalResult.total, 1);
  assert.equal(evalResult.allPassed, true);

  const configRow = db
    .prepare("SELECT last_status FROM connector_configs WHERE id = 'test_repair'")
    .get() as any;
  assert.equal(configRow.last_status, "ok");
});

test("Database initialization creates all canonical tables without omission", () => {
  const db = createDatabase(":memory:");
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const tableNames = tables.map((t) => t.name);

  assert.ok(tableNames.includes("development_actions"));
  assert.ok(tableNames.includes("environmental_actions"));
  assert.ok(tableNames.includes("infrastructure_relationships"));
  assert.ok(tableNames.includes("source_artifacts"));
  assert.ok(tableNames.includes("observations"));
  assert.ok(tableNames.includes("organizations"));
  assert.ok(tableNames.includes("locations"));
  assert.ok(tableNames.includes("projects"));
  assert.ok(tableNames.includes("facilities"));
  assert.ok(tableNames.includes("connector_configs"));
  assert.ok(tableNames.includes("repair_audits"));
  assert.equal(tableNames.length, 11);
});
