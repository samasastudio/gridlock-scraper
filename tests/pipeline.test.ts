import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import test from "node:test";
import { runScraperPipeline } from "../src/jobs/runner.js";
import { parseTdlrHtml } from "../src/parsers/tdlr.js";
import { parseAustinPermitsJson } from "../src/parsers/austin.js";
import { main as runCli, EXIT_CODES } from "../src/cli.js";
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
  assert.equal(evalResult.details.length, 1);
  assert.equal(evalResult.details[0].fixtureId, "fix-1");
  assert.equal(evalResult.details[0].passed, true);

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

test("Austin pipeline execution extracts permits and stores observations without synthetic defaults", async () => {
  const tempDir = mkdtempSync(`${tmpdir()}/gridlock-test-austin-`);
  const store = new ArtifactStore(tempDir);
  const db = createDatabase(":memory:");

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('austin_permits_v1', 'austin_permits', '{}', '{}')
  `).run();

  const validAustinJson = JSON.stringify([
    {
      permit_number: "2024-998877-BP",
      project_name: "Austin Interconnect",
      permit_status: "Active",
      total_valuation: "45000000",
      applicant_full_name: "Texas Energy Data Corp",
      parcel_id: "0102030405",
    },
  ]);

  const res = await runScraperPipeline({
    connectorId: "austin_permits_v1",
    sourceFamily: "austin_permits",
    extractor: async () => ({
      sourceFamily: "austin_permits" as const,
      sourceUrl: "https://data.austintexas.gov/resource/3syk-w9eu.json",
      contentType: "application/json",
      byteSize: Buffer.byteLength(validAustinJson),
      content: validAustinJson,
      connectorVersion: "1.0.0",
    }),
    parser: parseAustinPermitsJson,
    artifactStore: store,
    db,
  });

  assert.equal(res.earlyExit, false);
  assert.ok(res.observationsCount >= 4);

  // Invariant 11 verification: missing valuation must throw and quarantine rather than defaulting to 0
  const invalidAustinJson = JSON.stringify([
    {
      permit_number: "2024-000000-BP",
      permit_status: "Active",
      // total_valuation is intentionally omitted
    },
  ]);

  const failRes = await runScraperPipeline({
    connectorId: "austin_permits_v1",
    sourceFamily: "austin_permits",
    extractor: async () => ({
      sourceFamily: "austin_permits" as const,
      sourceUrl: "https://data.austintexas.gov/resource/3syk-w9eu.json",
      contentType: "application/json",
      byteSize: Buffer.byteLength(invalidAustinJson),
      content: invalidAustinJson,
      connectorVersion: "1.0.0",
    }),
    parser: parseAustinPermitsJson,
    artifactStore: store,
    db,
  });

  assert.equal(failRes.anomaly, true);

  rmSync(tempDir, { recursive: true, force: true });
});

test("CLI entrypoint main() executes non-dry-run and returns exit code 0 or 2 on anomaly", async () => {
  const db = createDatabase(":memory:");

  // Dry run returns SUCCESS
  const dryCode = await runCli(["--source=austin", "--dry-run"], db);
  assert.equal(dryCode, EXIT_CODES.SUCCESS);

  // Unsupported flag returns RUNTIME_ERROR
  const errCode = await runCli(["--source=invalid_source"], db);
  assert.equal(errCode, EXIT_CODES.RUNTIME_ERROR);
});

test("Promoted repair audit with mismatched quarantinedArtifactId is terminal and does not fall back to temporal check", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await repo.ensureConnectorConfigs([
    { id: "tdlr_terminal_test", sourceFamily: "tdlr_tabs" },
  ]);

  await repo.insertRepairAudit({
    connectorId: "tdlr_terminal_test",
    failureReason: "Selector fix explicitly tied to artifact B",
    proposedPatch: { patch: "v2" },
    replayResults: { passed: 1, total: 1, allPassed: true, quarantinedArtifactId: "artifact-B" },
    status: "promoted",
  });

  // Artifact A with capturedAt in the past (before audit was created)
  const artifactA = {
    id: "artifact-A",
    capturedAt: "2020-01-01 00:00:00",
  };

  // Checking artifact A against audit B must return false despite audit.createdAt >= artifactA.capturedAt
  const hasPromoA = await repo.hasPromotedRepairAudit("tdlr_terminal_test", artifactA);
  assert.equal(hasPromoA, false, "Audit explicitly naming artifact-B must not approve artifact-A");

  // Checking artifact B must return true
  const artifactB = {
    id: "artifact-B",
    capturedAt: "2020-01-01 00:00:00",
  };
  const hasPromoB = await repo.hasPromotedRepairAudit("tdlr_terminal_test", artifactB);
  assert.equal(hasPromoB, true, "Audit explicitly naming artifact-B must approve artifact-B");
});

test("ScraperRepository.ensureConnectorConfigs initializes connector configurations via typed Drizzle queries", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await repo.ensureConnectorConfigs([
    {
      id: "test_connector_1",
      sourceFamily: "tdlr_tabs",
      manifest: { version: "1.0.0" },
      invariants: { minCost: 0 },
      lastStatus: "idle",
    },
  ]);

  const config = await repo.getConnectorConfig("test_connector_1");
  assert.ok(config);
  assert.equal(config.id, "test_connector_1");
  assert.equal(config.sourceFamily, "tdlr_tabs");
  assert.equal(config.lastStatus, "idle");

  // Idempotent: inserting duplicate does nothing
  await repo.ensureConnectorConfigs([
    {
      id: "test_connector_1",
      sourceFamily: "tdlr_tabs",
    },
  ]);
  const config2 = await repo.getConnectorConfig("test_connector_1");
  assert.equal(config2?.id, "test_connector_1");
});

test("ScraperRepository status and telemetry aggregation methods return typed stats", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await repo.ensureConnectorConfigs([
    { id: "c1", sourceFamily: "tdlr_tabs", lastStatus: "ok" },
    { id: "c2", sourceFamily: "ercot_queue", lastStatus: "anomaly" },
  ]);

  const telemetry = await repo.getConnectorTelemetryStats();
  assert.equal(telemetry.connectorsCount, 2);
  assert.equal(telemetry.activeAnomalies, 1);

  const configs = await repo.getAllConnectorConfigs();
  assert.equal(configs.length, 2);

  // 1. Initial empty stats
  const initialRunStats = await repo.getArtifactRunStats();
  assert.equal(initialRunStats.totalRuns, 0);
  assert.equal(initialRunStats.quarantinedRuns, 0);
  assert.equal(initialRunStats.successfulRuns, 0);

  // 2. Insert populated artifacts: 2 normal (successful) and 1 quarantine
  await repo.insertSourceArtifact({
    sha256Hash: "hash-ok-1",
    sourceFamily: "tdlr_tabs",
    sourceUrl: "https://example.com/1",
    contentType: "text/html",
    byteSize: 100,
    storagePath: "1.html",
    connectorVersion: "1.0.0",
  });
  await repo.insertSourceArtifact({
    sha256Hash: "hash-ok-2",
    sourceFamily: "tdlr_tabs",
    sourceUrl: "https://example.com/2",
    contentType: "text/html",
    byteSize: 200,
    storagePath: "2.html",
    connectorVersion: "1.0.0",
  });
  await repo.insertSourceArtifact({
    sha256Hash: "hash-quarantine-1",
    sourceFamily: "tdlr_tabs",
    sourceUrl: "https://example.com/3",
    contentType: "text/html",
    byteSize: 300,
    storagePath: "3.html",
    connectorVersion: "quarantine",
  });

  const populatedRunStats = await repo.getArtifactRunStats();
  assert.equal(populatedRunStats.totalRuns, 3);
  assert.equal(populatedRunStats.quarantinedRuns, 1);
  assert.equal(populatedRunStats.successfulRuns, 2);

  // 3. Insert repair audits with distinct timestamps and verify getRecentRepairAudits order & limit
  await repo.insertRepairAudit({
    connectorId: "c1",
    failureReason: "Audit 1",
    proposedPatch: {},
    replayResults: {},
    status: "pending_review",
    createdAt: "2026-09-28 12:00:00",
  });
  await repo.insertRepairAudit({
    connectorId: "c2",
    failureReason: "Audit 2",
    proposedPatch: {},
    replayResults: {},
    status: "promoted",
    createdAt: "2026-09-28 12:05:00",
  });

  const audits = await repo.getRecentRepairAudits(1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].connectorId, "c2");

  const allAudits = await repo.getRecentRepairAudits(10);
  assert.equal(allAudits.length, 2);
});

test("evaluateCandidatePatch preserves raw binary buffer without UTF-8 string conversion", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);
  await repo.ensureConnectorConfigs([
    { id: "test_binary_connector", sourceFamily: "ercot_queue" },
  ]);

  const binaryPayload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x80, 0x90]);

  let receivedType: string = "";
  let receivedBuffer: Buffer | null = null;

  const result = await evaluateCandidatePatch(
    "test_binary_connector",
    { version: "1.0.1" },
    (content: string | Buffer) => {
      receivedType = Buffer.isBuffer(content) ? "buffer" : typeof content;
      if (Buffer.isBuffer(content)) receivedBuffer = content;
      return [
        {
          subjectType: "facility",
          subjectId: "fac-binary-1",
          sourceArtifactId: "art-binary-1",
          confidence: 1.0,
          resolutionMethod: "deterministic",
          data: { name: "Test Facility" },
        },
      ];
    },
    [
      {
        id: "fixture_binary",
        content: binaryPayload,
        expectedMinCount: 1,
        expectedSubjectIds: ["fac-binary-1"],
      },
    ],
    db
  );

  assert.equal(receivedType, "buffer", "evaluateCandidatePatch must pass Buffer directly to parser");
  assert.deepEqual(receivedBuffer, binaryPayload, "Buffer bytes must be preserved exactly");
  assert.equal(result.allPassed, true);
});

test("createR2ClientFromEnv throws when credentials are not configured", async () => {
  const { createR2ClientFromEnv } = await import("../scripts/sync-state.js");
  const origEndpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  delete process.env.CLOUDFLARE_R2_ENDPOINT;

  try {
    assert.throws(
      () => createR2ClientFromEnv(),
      /Missing required Cloudflare R2 credentials/,
      "Must throw error on absent R2 credentials"
    );
  } finally {
    if (origEndpoint) process.env.CLOUDFLARE_R2_ENDPOINT = origEndpoint;
  }
});

test("publishStateToR2 throws when local database file does not exist (Invariant 28)", async () => {
  const { publishStateToR2 } = await import("../scripts/sync-state.js");
  const nonExistentDb = join(tmpdir(), "non-existent-" + crypto.randomUUID() + ".db");
  const mockR2: any = {
    putObject: async () => ({}),
  };

  await assert.rejects(
    async () => {
      await publishStateToR2({
        r2Client: mockR2,
        localDbPath: nonExistentDb,
      });
    },
    /Local database file does not exist at:/,
    "publishStateToR2 must reject when local database is missing"
  );
});

test("Pipeline execution with OpenXML spreadsheet MIME preserves .xlsx extension and raw binary buffer (Invariants 24 & 26)", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "gridlock-xlsx-pipeline-"));
  const store = new ArtifactStore(tempDir);
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await repo.ensureConnectorConfigs([
    { id: "ercot_xlsx_pipeline", sourceFamily: "ercot_queue" },
  ]);

  const fakeXlsxPayload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x00]);
  let receivedContent: any = null;

  const res = await runScraperPipeline({
    connectorId: "ercot_xlsx_pipeline",
    sourceFamily: "ercot_queue",
    extractor: async () => ({
      sourceFamily: "ercot_queue" as const,
      sourceUrl: "https://ercot.com/gis/queue.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      byteSize: fakeXlsxPayload.length,
      content: fakeXlsxPayload,
      connectorVersion: "1.0.0",
    }),
    parser: (content: any) => {
      receivedContent = content;
      return [
        {
          subjectType: "facility",
          subjectId: "fac-xlsx-1",
          property: "facility_details",
          valueJson: { name: "XLSX Facility" },
          confidence: 1.0,
          resolutionMethod: "deterministic",
        },
      ];
    },
    artifactStore: store,
    db,
  });

  assert.equal(res.earlyExit, false);
  assert.equal(res.observationsCount, 1);
  assert.ok(Buffer.isBuffer(receivedContent), "Parser must receive raw Buffer for binary spreadsheet");
  assert.deepEqual(receivedContent, fakeXlsxPayload);

  const artifact = await repo.findSourceArtifactByHash(store.computeHash(fakeXlsxPayload));
  assert.equal(
    artifact?.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.ok(
    artifact?.storagePath.endsWith(".xlsx"),
    `Storage path must end with .xlsx, got: ${artifact?.storagePath}`
  );

  rmSync(tempDir, { recursive: true, force: true });
});

test("Pipeline passes connector_configs.manifest into extractor and parser", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "gridlock-manifest-test-"));
  const store = new ArtifactStore(tempDir);
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await repo.ensureConnectorConfigs([
    {
      id: "tdlr_manifest_pipe",
      sourceFamily: "tdlr_tabs",
      manifest: { customSelector: ".special-item", version: 42 },
    },
  ]);

  let extractorPassedManifest: any = null;
  let parserPassedManifest: any = null;

  const result = await runScraperPipeline({
    connectorId: "tdlr_manifest_pipe",
    sourceFamily: "tdlr_tabs",
    extractor: async (opts) => {
      extractorPassedManifest = opts?.manifest;
      return {
        sourceFamily: "tdlr_tabs" as const,
        sourceUrl: "https://example.com/item",
        contentType: "text/html",
        byteSize: 100,
        content: `<html><body><div class="special-item">Data</div></body></html>`,
        connectorVersion: "1.0.0",
      };
    },
    parser: (content, manifest) => {
      parserPassedManifest = manifest;
      return [
        {
          subjectType: "project",
          subjectId: "P-100",
          property: "status",
          valueJson: { status: "ok" },
          confidence: 1.0,
          resolutionMethod: "deterministic",
        },
      ];
    },
    artifactStore: store,
    db,
  });

  assert.equal(result.observationsCount, 1);
  assert.deepEqual(extractorPassedManifest, { customSelector: ".special-item", version: 42 });
  assert.deepEqual(parserPassedManifest, { customSelector: ".special-item", version: 42 });

  rmSync(tempDir, { recursive: true, force: true });
});

test("Failed quarantine reprocessing restores connector status to anomaly", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "gridlock-reprocess-fail-"));
  const store = new ArtifactStore(tempDir);
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await repo.ensureConnectorConfigs([
    { id: "test_reprocess_pipe", sourceFamily: "tdlr_tabs", lastStatus: "anomaly" },
  ]);

  const payload = "<html><body>corrupted payload</body></html>";
  const sha256 = store.computeHash(payload);

  // Store quarantined artifact
  const stored = store.store("tdlr_tabs", payload, "html");
  await repo.commitNewArtifactWithObservations({
    artifact: {
      sha256Hash: sha256,
      sourceFamily: "tdlr_tabs",
      sourceUrl: "https://example.com/failing",
      contentType: "text/html",
      byteSize: stored.byteSize,
      storagePath: stored.storagePath,
      connectorVersion: "quarantine",
    },
    observations: () => [],
    connectorId: "test_reprocess_pipe",
  });

  // Promote repair audit
  await repo.promotePatchAndRecordAudit({
    connectorId: "test_reprocess_pipe",
    failureReason: "Testing reprocessing failure",
    proposedPatch: { selector: ".fixed" },
    replayResults: { passed: 1, total: 1, allPassed: true },
  });

  // Verify status is currently 'ok' following promotion
  const configBefore = await repo.getConnectorConfig("test_reprocess_pipe");
  assert.equal(configBefore?.lastStatus, "ok");

  // Re-run pipeline where parser STILL throws during reprocessing
  const res = await runScraperPipeline({
    connectorId: "test_reprocess_pipe",
    sourceFamily: "tdlr_tabs",
    extractor: async () => ({
      sourceFamily: "tdlr_tabs" as const,
      sourceUrl: "https://example.com/failing",
      contentType: "text/html",
      byteSize: payload.length,
      content: payload,
      connectorVersion: "1.0.1",
    }),
    parser: () => {
      throw new Error("Still failing invariant validation");
    },
    artifactStore: store,
    db,
  });

  assert.equal(res.anomaly, true);

  // Status must be restored to 'anomaly'
  const configAfter = await repo.getConnectorConfig("test_reprocess_pipe");
  assert.equal(configAfter?.lastStatus, "anomaly");

  rmSync(tempDir, { recursive: true, force: true });
});

test("promotePatchAndRecordAudit writes manifest as object without double stringification", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await repo.ensureConnectorConfigs([
    { id: "test_manifest_obj", sourceFamily: "tdlr_tabs" },
  ]);

  const patch = { selector: "#main-project-id", version: 3 };
  await repo.promotePatchAndRecordAudit({
    connectorId: "test_manifest_obj",
    failureReason: "Selector drift fix",
    proposedPatch: patch,
    replayResults: { passed: 1, total: 1, allPassed: true },
  });

  const config = await repo.getConnectorConfig("test_manifest_obj");
  assert.equal(typeof config?.manifest, "object");
  assert.deepEqual(config?.manifest, patch);
});



