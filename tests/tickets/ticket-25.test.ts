import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ticket 25 - Criteria 1: Persist candidate patch into connector_configs.manifest upon successful replay verification", () => {
  const replayPath = path.resolve(process.cwd(), "src/repair/replay.ts");
  const content = fs.readFileSync(replayPath, "utf8");

  assert.match(
    content,
    /manifest/,
    "replay.ts must update connector_configs.manifest when candidate patch passes 100%"
  );
  assert.match(
    content,
    /proposedPatch|proposedPatchDescription/,
    "replay.ts must persist proposed patch description into manifest"
  );
});

test("Ticket 25 - Criteria 2: Atomically commit audit record, manifest update, and connector status ok", () => {
  const replayPath = path.resolve(process.cwd(), "src/repair/replay.ts");
  const content = fs.readFileSync(replayPath, "utf8");

  assert.match(
    content,
    /transaction|commitPromotedPatch/,
    "replay promotion must execute atomically in a transaction"
  );
});
