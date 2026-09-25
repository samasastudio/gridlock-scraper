import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { runScraperPipeline } from "../src/jobs/runner.js";
import { parseTdlrHtml } from "../src/parsers/tdlr.js";
import { evaluateCandidatePatch } from "../src/repair/replay.js";
import { ArtifactStore } from "../src/storage/artifact-store.js";
import { createDatabase, ScraperRepository } from "../src/storage/db.js";

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
    { id: "fix-1", content: SAMPLE_TDLR_HTML, expectedMinCount: 1 },
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

test("Pipeline reprocesses quarantined artifact upon verified repair", async () => {
  const tempDir = mkdtempSync(`${tmpdir()}/gridlock-test-reprocess-`);
  const store = new ArtifactStore(tempDir);
  const db = createDatabase(":memory:");

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('tdlr_repairable', 'tdlr_tabs', '{}', '{}')
  `).run();

  const validHtml = SAMPLE_TDLR_HTML;

  // 1. Initial run with a broken parser that throws an invariant error
  const brokenParser = () => {
    throw new Error("Drifted selector failure");
  };

  const res1 = await runScraperPipeline({
    connectorId: "tdlr_repairable",
    sourceFamily: "tdlr_tabs",
    extractor: async () => ({
      sourceFamily: "tdlr_tabs" as const,
      sourceUrl: "https://www.tdlr.texas.gov/TABS/test",
      contentType: "text/html",
      byteSize: Buffer.byteLength(validHtml),
      content: validHtml,
      connectorVersion: "1.0.0",
    }),
    parser: brokenParser,
    artifactStore: store,
    db,
  });

  assert.equal(res1.anomaly, true);
  assert.equal(res1.observationsCount, 0);

  // Insert verified promotion proof (ADR-0004, Ticket 24)
  const repo = new ScraperRepository(db);
  await repo.insertRepairAudit({
    connectorId: "tdlr_repairable",
    failureReason: "Verified healthy parser patch",
    proposedPatch: { fixed: true },
    replayResults: { passed: 1, total: 1, allPassed: true },
    status: "promoted",
  });

  // 2. Second run on identical payload but with repaired healthy parser
  const res2 = await runScraperPipeline({
    connectorId: "tdlr_repairable",
    sourceFamily: "tdlr_tabs",
    extractor: async () => ({
      sourceFamily: "tdlr_tabs" as const,
      sourceUrl: "https://www.tdlr.texas.gov/TABS/test",
      contentType: "text/html",
      byteSize: Buffer.byteLength(validHtml),
      content: validHtml,
      connectorVersion: "1.0.1",
    }),
    parser: parseTdlrHtml, // Repaired parser
    artifactStore: store,
    db,
  });

  assert.equal(res2.earlyExit, false);
  assert.ok(res2.observationsCount > 0);
  assert.equal(res2.sourceArtifactId, res1.sourceArtifactId);

  // Verify status is now "ok" and version updated from quarantine
  const statusRow = db
    .prepare("SELECT last_status FROM connector_configs WHERE id = 'tdlr_repairable'")
    .get() as any;
  assert.equal(statusRow.last_status, "ok");

  const artifactRow = db
    .prepare("SELECT connector_version FROM source_artifacts WHERE id = ?")
    .get(res2.sourceArtifactId) as any;
  assert.equal(artifactRow.connector_version, "1.0.1");

  rmSync(tempDir, { recursive: true, force: true });
});

test("Atomic commit rolls back source_artifact if observation insert fails", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await assert.rejects(async () => {
    await repo.commitNewArtifactWithObservations({
      artifact: {
        sha256Hash: "atomic-test-hash",
        sourceFamily: "tdlr_tabs",
        sourceUrl: "https://test.example.com",
        contentType: "text/html",
        byteSize: 100,
        storagePath: "test-path",
        connectorVersion: "1.0.0",
      },
      observations: () => {
        throw new Error("Simulated downstream insertion explosion");
      },
    });
  });

  const artifact = await repo.findSourceArtifactByHash("atomic-test-hash");
  assert.equal(artifact, null, "Artifact must be rolled back on observation error");
});

test("Replay harness rejects candidate patches that regress observation counts or IDs", async () => {
  const db = createDatabase(":memory:");

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('test_eval_regress', 'tdlr_tabs', '{}', '{}')
  `).run();

  const fixtures = [
    {
      id: "fix-count",
      content: SAMPLE_TDLR_HTML,
      expectedMinCount: 10, // Expects 10, but parseTdlrHtml produces ~3
    },
  ];

  const evalResult = await evaluateCandidatePatch(
    "test_eval_regress",
    { selector: "broken" },
    parseTdlrHtml,
    fixtures,
    db
  );

  assert.equal(evalResult.allPassed, false);
  assert.equal(evalResult.passed, 0);

  const configRow = db
    .prepare("SELECT last_status FROM connector_configs WHERE id = 'test_eval_regress'")
    .get() as any;
  assert.equal(configRow.last_status, "idle"); // Not promoted to ok
});

test("Quarantine reprocessing requires promotion proof tied to the specific quarantined event, ignoring obsolete historical audits", async () => {
  const tempDir = mkdtempSync(`${tmpdir()}/gridlock-test-bind-`);
  const store = new ArtifactStore(tempDir);
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('tdlr_multi_drift', 'tdlr_tabs', '{}', '{}')
  `).run();

  // 1. Insert an old promoted repair audit from an earlier drift event in the past
  await repo.insertRepairAudit({
    connectorId: "tdlr_multi_drift",
    failureReason: "Old selector drift fixed last month",
    proposedPatch: { version: 1 },
    replayResults: { passed: 1, total: 1, allPassed: true, quarantinedArtifactId: "art-old" },
    status: "promoted",
  });

  // Manually backdate the old audit's createdAt to ensure it strictly precedes the new quarantine
  db.prepare(`
    UPDATE repair_audits SET created_at = '2026-01-01 00:00:00' WHERE connector_id = 'tdlr_multi_drift'
  `).run();

  const newFailingHtml = `<html><body><span id="new_unknown_id">TABS2024999999</span></body></html>`;

  // 2. A new, unrelated payload is quarantined today
  const res1 = await runScraperPipeline({
    connectorId: "tdlr_multi_drift",
    sourceFamily: "tdlr_tabs",
    extractor: async () => ({
      sourceFamily: "tdlr_tabs" as const,
      sourceUrl: "https://www.tdlr.texas.gov/TABS/test",
      contentType: "text/html",
      byteSize: Buffer.byteLength(newFailingHtml),
      content: newFailingHtml,
      connectorVersion: "1.0.0",
    }),
    parser: () => {
      throw new Error("New selector drift failure");
    },
    artifactStore: store,
    db,
  });

  assert.equal(res1.anomaly, true);

  // 3. Parser is run again without a new promotion proof for this new quarantine.
  // Even though 'tdlr_multi_drift' has an old promoted audit from January, this new quarantine must NOT be reprocessed!
  const res2 = await runScraperPipeline({
    connectorId: "tdlr_multi_drift",
    sourceFamily: "tdlr_tabs",
    extractor: async () => ({
      sourceFamily: "tdlr_tabs" as const,
      sourceUrl: "https://www.tdlr.texas.gov/TABS/test",
      contentType: "text/html",
      byteSize: Buffer.byteLength(newFailingHtml),
      content: newFailingHtml,
      connectorVersion: "1.0.1",
    }),
    parser: () => [
      {
        subjectType: "project",
        subjectId: "TABS2024999999",
        property: "name",
        valueJson: { name: "Test" },
      },
    ],
    artifactStore: store,
    db,
  });

  assert.equal(
    res2.earlyExit,
    true,
    "Must early exit and remain in quarantine when only obsolete audits exist"
  );
  assert.equal(res2.observationsCount, 0);

  // 4. Now evaluate and promote a new patch explicitly tied to this new quarantined artifact
  await evaluateCandidatePatch(
    "tdlr_multi_drift",
    { selector: "#new_unknown_id" },
    () => [
      {
        subjectType: "project",
        subjectId: "TABS2024999999",
        property: "name",
        valueJson: { name: "Test" },
      },
    ],
    [{ id: "fix-new", content: newFailingHtml, expectedMinCount: 1 }],
    db,
    { quarantinedArtifactId: res1.sourceArtifactId }
  );

  // 5. Subsequent run now successfully reprocesses the quarantined artifact!
  const res3 = await runScraperPipeline({
    connectorId: "tdlr_multi_drift",
    sourceFamily: "tdlr_tabs",
    extractor: async () => ({
      sourceFamily: "tdlr_tabs" as const,
      sourceUrl: "https://www.tdlr.texas.gov/TABS/test",
      contentType: "text/html",
      byteSize: Buffer.byteLength(newFailingHtml),
      content: newFailingHtml,
      connectorVersion: "1.0.2",
    }),
    parser: () => [
      {
        subjectType: "project",
        subjectId: "TABS2024999999",
        property: "name",
        valueJson: { name: "Test" },
      },
    ],
    artifactStore: store,
    db,
  });

  assert.equal(res3.earlyExit, false);
  assert.equal(res3.observationsCount, 1);

  rmSync(tempDir, { recursive: true, force: true });
});

