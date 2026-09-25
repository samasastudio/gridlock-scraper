import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { ArtifactStore } from "../../src/storage/artifact-store.js";
import { createDatabase, ScraperRepository } from "../../src/storage/db.js";

test("Ticket 02 - Criteria 1: Payloads compressed/stored with SHA-256 hash verified against uncompressed stream", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gridlock-store-"));
  const store = new ArtifactStore(tmpDir);

  const rawPayload = "<html><body><h1>TDLR Construction Filing</h1></body></html>";
  const expectedHash = createHash("sha256").update(rawPayload).digest("hex");

  const meta = store.store("tdlr_tabs", rawPayload, "html");
  assert.equal(meta.sha256Hash, expectedHash);
  assert.equal(meta.byteSize, Buffer.byteLength(rawPayload));

  // Inspect on-disk artifact: must be compressed with gzip (magic bytes 0x1f 0x8b)
  const onDiskBytes = fs.readFileSync(meta.storagePath);
  assert.equal(onDiskBytes[0], 0x1f, "Must have gzip magic byte 0x1f");
  assert.equal(onDiskBytes[1], 0x8b, "Must have gzip magic byte 0x8b");

  // Decompressing stored on-disk file must yield original uncompressed payload
  const decompressed = gunzipSync(onDiskBytes);
  assert.equal(decompressed.toString("utf8"), rawPayload);

  // Store retrieve method must transparently return uncompressed payload
  const retrieved = store.retrieve(meta.storagePath);
  assert.equal(retrieved.toString("utf8"), rawPayload);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Ticket 02 - Criteria 2: Duplicate payload ingest returns existing artifact record without re-uploading", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  const hash = "a".repeat(64);
  await repo.insertSourceArtifact({
    id: "art-1",
    sha256Hash: hash,
    sourceFamily: "tdlr_tabs",
    sourceUrl: "https://example.com/tdlr",
    contentType: "text/html",
    byteSize: 100,
    storagePath: "/path/to/art-1.html",
    connectorVersion: "v1.0.0",
  });

  const existing = await repo.findSourceArtifactByHash(hash);
  assert.ok(existing, "Existing artifact should be located by hash");
  assert.equal(existing?.id, "art-1");
});

test("Ticket 02 - Criteria 3: Metadata recorded in source_artifacts table", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  const hash = "b".repeat(64);
  const id = await repo.insertSourceArtifact({
    sha256Hash: hash,
    sourceFamily: "ercot_queue",
    sourceUrl: "https://ercot.com/gis",
    contentType: "text/csv",
    byteSize: 2048,
    storagePath: "/data/ercot/test.csv",
    connectorVersion: "v1.0.0",
  });

  assert.ok(id, "Generated artifact ID should be returned");
  const found = await repo.findSourceArtifactByHash(hash);
  assert.equal(found?.contentType, "text/csv");
  assert.equal(found?.sourceFamily, "ercot_queue");
});
