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
