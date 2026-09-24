import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runScraperPipeline } from "../../src/jobs/runner.js";
import { ArtifactStore } from "../../src/storage/artifact-store.js";
import { createDatabase, ScraperRepository } from "../../src/storage/db.js";

const TEST_PAYLOAD = `<html><body><span id="ctl00_ContentPlaceHolder1_lblProjectNumber">TABS2024999</span><span id="ctl00_ContentPlaceHolder1_lblProjectName">Austin Test</span><span id="ctl00_ContentPlaceHolder1_lblEstimatedCost">$10,000,000</span><span id="ctl00_ContentPlaceHolder1_lblCity">Austin</span><span id="ctl00_ContentPlaceHolder1_lblCounty">Travis</span></body></html>`;

test("Ticket 24 - Criteria 1 & 2: Quarantine payload is NOT reprocessed without a 'promoted' audit record", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gridlock-t24-"));
  const store = new ArtifactStore(tmpDir);
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants, last_status)
    VALUES ('tdlr_v1', 'tdlr_tabs', '{}', '{}', 'anomaly')
  `).run();

  const sha256Hash = store.computeHash(TEST_PAYLOAD);
  await repo.insertSourceArtifact({
    id: "art-quarantine-1",
    sha256Hash,
    sourceFamily: "tdlr_tabs",
    sourceUrl: "https://example.com/tdlr",
    contentType: "text/html",
    byteSize: Buffer.byteLength(TEST_PAYLOAD),
    storagePath: "/path/to/quarantine.html",
    connectorVersion: "quarantine", // Marked as quarantine
  });

  // Mock extractor returning the same payload
  const mockExtractor = async () => ({
    sourceFamily: "tdlr_tabs" as const,
    sourceUrl: "https://example.com/tdlr",
    contentType: "text/html",
    byteSize: Buffer.byteLength(TEST_PAYLOAD),
    content: TEST_PAYLOAD,
    connectorVersion: "1.0.0",
  });

  // Parser that could parse it, BUT NO repair_audits promotion exists!
  const mockParser = () => [
    {
      subjectType: "project",
      subjectId: "TABS2024999",
      property: "estimated_cost",
      valueJson: { usd: 10000000 },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
  ];

  const result = await runScraperPipeline({
    connectorId: "tdlr_v1",
    sourceFamily: "tdlr_tabs",
    extractor: mockExtractor,
    parser: mockParser,
    artifactStore: store,
    db,
  });

  // Invariant (Ticket 24): Without promoted repair audit proof, payload must remain quarantined!
  assert.equal(
    result.observationsCount,
    0,
    "Unreviewed parser run must NOT reprocess quarantined payload without promoted repair audit"
  );
  assert.equal(
    result.earlyExit,
    true,
    "Quarantine payload without promotion proof must trigger early exit"
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Ticket 24 - Criteria 3: Reprocessing succeeds when a verified 'promoted' audit record exists", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gridlock-t24-promoted-"));
  const store = new ArtifactStore(tmpDir);
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants, last_status)
    VALUES ('tdlr_v1', 'tdlr_tabs', '{}', '{}', 'anomaly')
  `).run();

  const sha256Hash = store.computeHash(TEST_PAYLOAD);
  await repo.insertSourceArtifact({
    id: "art-quarantine-2",
    sha256Hash,
    sourceFamily: "tdlr_tabs",
    sourceUrl: "https://example.com/tdlr",
    contentType: "text/html",
    byteSize: Buffer.byteLength(TEST_PAYLOAD),
    storagePath: "/path/to/quarantine2.html",
    connectorVersion: "quarantine",
  });

  // Insert verified promotion proof
  await repo.insertRepairAudit({
    connectorId: "tdlr_v1",
    failureReason: "Selector update verified by replay harness",
    proposedPatch: { fixed: true },
    replayResults: { passed: 5, total: 5, allPassed: true },
    status: "promoted",
  });

  const mockExtractor = async () => ({
    sourceFamily: "tdlr_tabs" as const,
    sourceUrl: "https://example.com/tdlr",
    contentType: "text/html",
    byteSize: Buffer.byteLength(TEST_PAYLOAD),
    content: TEST_PAYLOAD,
    connectorVersion: "1.0.1",
  });

  const mockParser = () => [
    {
      subjectType: "project",
      subjectId: "TABS2024999",
      property: "name",
      valueJson: { name: "Austin Test" },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
  ];

  const result = await runScraperPipeline({
    connectorId: "tdlr_v1",
    sourceFamily: "tdlr_tabs",
    extractor: mockExtractor,
    parser: mockParser,
    artifactStore: store,
    db,
  });

  assert.equal(result.earlyExit, false);
  assert.equal(result.observationsCount, 1, "Must reprocess quarantined payload when promotion proof exists");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
