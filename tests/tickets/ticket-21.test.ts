import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Ticket 21 - Criteria 1: Pre-run pulls gridlock.db and manifest from R2 or initializes fresh schema", async () => {
  const syncModule = await import("../../scripts/sync-state.js").catch(() => null);
  assert.ok(syncModule, "scripts/sync-state.ts must be implemented and export hydration functions");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gridlock-sync-test-"));
  const dbPath = path.join(tmpDir, "gridlock.db");

  // Mock R2 client returning empty bucket
  const mockEmptyR2Client = {
    getObject: async () => null,
    putObject: async () => ({}),
  };

  const result = await syncModule.hydrateStateFromR2({
    r2Client: mockEmptyR2Client,
    targetDbPath: dbPath,
  });

  assert.equal(result.hydratedFromRemote, false, "Empty remote bucket must trigger fresh initialization fallback");
  assert.ok(fs.existsSync(dbPath), "Local database must be initialized upon fallback");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Ticket 21 - Criteria 2: Post-run pushes mutated DB atomically (.tmp key then swap)", async () => {
  const syncModule = await import("../../scripts/sync-state.js").catch(() => null);
  assert.ok(syncModule, "scripts/sync-state.ts must be implemented");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gridlock-push-test-"));
  const dbPath = path.join(tmpDir, "gridlock.db");
  fs.writeFileSync(dbPath, "SQLITE_HEADER_DUMMY_DATA");

  const uploadedKeys: string[] = [];
  const mockR2Client = {
    putObject: async (params: { Key: string; Body: any }) => {
      uploadedKeys.push(params.Key);
      return {};
    },
    copyObject: async (params: { CopySource: string; Key: string }) => {
      uploadedKeys.push(`COPY:${params.CopySource}->${params.Key}`);
      return {};
    },
    deleteObject: async () => ({}),
  };

  await syncModule.publishStateToR2({
    r2Client: mockR2Client,
    localDbPath: dbPath,
    artifactsDir: tmpDir,
  });

  assert.ok(
    uploadedKeys.some((k) => k.includes(".tmp")),
    "Database upload must stage to .tmp key before final swap"
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Ticket 21 - Criteria 3 & 4: Syncs payload blobs to R2 with SHA-256 checksum verification", async () => {
  const syncModule = await import("../../scripts/sync-state.js").catch(() => null);
  assert.ok(syncModule, "scripts/sync-state.ts must be implemented");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gridlock-blobs-"));
  const payloadContent = "<html>sample tdlr filing</html>";
  const hash = createHash("sha256").update(payloadContent).digest("hex");
  const blobDir = path.join(tmpDir, "tdlr_tabs");
  fs.mkdirSync(blobDir, { recursive: true });
  fs.writeFileSync(path.join(blobDir, `${hash}.html`), payloadContent);

  const syncedBlobs: Array<{ key: string; sha256: string }> = [];
  const mockR2Client = {
    putObject: async (params: { Key: string; Body: any; Metadata?: Record<string, string> }) => {
      syncedBlobs.push({
        key: params.Key,
        sha256: params.Metadata?.["sha256-hash"] ?? "",
      });
      return {};
    },
  };

  await syncModule.syncArtifactBlobsToR2({
    r2Client: mockR2Client,
    artifactsDir: tmpDir,
  });

  const syncedItem = syncedBlobs.find((b) => b.key.includes(hash));
  assert.ok(syncedItem, "Raw artifact blob must be uploaded to R2");
  assert.equal(syncedItem.sha256, hash, "Uploaded artifact must include verified SHA-256 metadata");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
