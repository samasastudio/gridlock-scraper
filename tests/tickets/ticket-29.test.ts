import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { quarantineExtractionFailure } from "../../src/repair/quarantine.js";
import { ArtifactStore } from "../../src/storage/artifact-store.js";
import { createDatabase, ScraperRepository } from "../../src/storage/db.js";

test("Ticket 29 - Criteria 1 & 2: Preserves actual contentType and extension during quarantine instead of hardcoded text/html", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gridlock-quarantine-"));
  const store = new ArtifactStore(tmpDir);
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('ercot_v1', 'ercot_queue', '{}', '{}')
  `).run();

  const csvPayload = "INR,Project Name\nINVALID_ROW_WITHOUT_MW";

  const { artifactId } = await quarantineExtractionFailure({
    connectorId: "ercot_v1",
    sourceFamily: "ercot_queue",
    sourceUrl: "https://ercot.com/gis/queue.csv",
    rawPayload: csvPayload,
    failureReason: "Missing required columns",
    artifactStore: store,
    db,
    // When Ticket 29 is implemented, contentType and extension will be accepted and respected
    ...({ contentType: "text/csv", extension: "csv" } as any),
  });

  const artifact = await repo.findSourceArtifactByHash(store.computeHash(csvPayload));
  assert.equal(
    artifact?.contentType,
    "text/csv",
    "Quarantine record must store original contentType 'text/csv' rather than hardcoding 'text/html'"
  );
  assert.ok(
    artifact?.storagePath.endsWith(".csv"),
    `Quarantine storage path must end with .csv, got ${artifact?.storagePath}`
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Ticket 29 - Criteria 3: Derives .xlsx and .xls extensions for spreadsheet MIME types during quarantine (Invariant 26)", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gridlock-quarantine-spreadsheets-"));
  const store = new ArtifactStore(tmpDir);
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  await repo.ensureConnectorConfigs([
    { id: "ercot_xlsx", sourceFamily: "ercot_queue" },
    { id: "ercot_xls", sourceFamily: "ercot_queue" },
  ]);

  const fakeZipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

  // Test 1: OpenXML spreadsheetml MIME
  await quarantineExtractionFailure({
    connectorId: "ercot_xlsx",
    sourceFamily: "ercot_queue",
    sourceUrl: "https://ercot.com/gis/queue.xlsx",
    rawPayload: fakeZipBytes,
    failureReason: "Spreadsheet schema breach",
    artifactStore: store,
    db,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const xlsxArtifact = await repo.findSourceArtifactByHash(store.computeHash(fakeZipBytes));
  assert.equal(
    xlsxArtifact?.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.ok(
    xlsxArtifact?.storagePath.endsWith(".xlsx"),
    `Expected OpenXML payload storagePath to end with .xlsx, got: ${xlsxArtifact?.storagePath}`
  );

  // Test 2: Legacy Excel ms-excel MIME
  const fakeXlsBytes = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await quarantineExtractionFailure({
    connectorId: "ercot_xls",
    sourceFamily: "ercot_queue",
    sourceUrl: "https://ercot.com/gis/queue.xls",
    rawPayload: fakeXlsBytes,
    failureReason: "Legacy excel schema breach",
    artifactStore: store,
    db,
    contentType: "application/vnd.ms-excel",
  });

  const xlsArtifact = await repo.findSourceArtifactByHash(store.computeHash(fakeXlsBytes));
  assert.equal(xlsArtifact?.contentType, "application/vnd.ms-excel");
  assert.ok(
    xlsArtifact?.storagePath.endsWith(".xls"),
    `Expected legacy Excel payload storagePath to end with .xls, got: ${xlsArtifact?.storagePath}`
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
