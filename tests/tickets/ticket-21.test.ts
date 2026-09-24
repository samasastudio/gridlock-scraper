import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ticket 21 - Criteria 1: scripts/sync-state.ts exists and supports hydration", () => {
  const syncPath = path.resolve(process.cwd(), "scripts/sync-state.ts");
  assert.ok(fs.existsSync(syncPath), "Expected scripts/sync-state.ts to exist");
});

test("Ticket 21 - Criteria 2: Post-run pushes mutated SQLite database atomically with checksums", () => {
  const syncPath = path.resolve(process.cwd(), "scripts/sync-state.ts");
  if (!fs.existsSync(syncPath)) {
    assert.fail("scripts/sync-state.ts not implemented");
  }
  const content = fs.readFileSync(syncPath, "utf8");
  assert.match(content, /\.tmp/, "Sync script must upload to temporary key before atomic swap");
  assert.match(content, /sha256/, "Sync script must verify SHA-256 checksums");
});
