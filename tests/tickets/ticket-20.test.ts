import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ticket 20 - Criteria 1: CLI entrypoint src/cli.ts exists", () => {
  const cliPath = path.resolve(process.cwd(), "src/cli.ts");
  assert.ok(fs.existsSync(cliPath), "Expected src/cli.ts entrypoint to exist");
});

test("Ticket 20 - Criteria 2: CLI parses source filtering, dry-run, and force flags", () => {
  const cliPath = path.resolve(process.cwd(), "src/cli.ts");
  if (!fs.existsSync(cliPath)) {
    assert.fail("src/cli.ts not implemented");
  }
  const content = fs.readFileSync(cliPath, "utf8");
  assert.match(content, /--source/, "CLI must support --source argument");
  assert.match(content, /--dry-run/, "CLI must support --dry-run argument");
  assert.match(content, /--force/, "CLI must support --force argument");
});

test("Ticket 20 - Criteria 3: Exit code protocol (0=clean, 1=crash, 2=anomaly quarantined)", () => {
  const cliPath = path.resolve(process.cwd(), "src/cli.ts");
  if (!fs.existsSync(cliPath)) {
    assert.fail("src/cli.ts not implemented");
  }
  const content = fs.readFileSync(cliPath, "utf8");
  assert.match(content, /process\.exit\(0\)/, "CLI must exit with 0 on success");
  assert.match(content, /process\.exit\(1\)/, "CLI must exit with 1 on crash");
  assert.match(content, /process\.exit\(2\)/, "CLI must exit with 2 on anomaly quarantine");
});
