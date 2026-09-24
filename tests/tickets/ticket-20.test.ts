import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ticket 20 - Criteria 1 & 5: CLI parses arguments (--source, --dry-run, --force)", async () => {
  const cliPath = path.resolve(process.cwd(), "src/cli.ts");
  assert.ok(fs.existsSync(cliPath), "src/cli.ts entrypoint file must exist");

  const cliModule = await import("../../src/cli.js").catch(() => null);
  assert.ok(cliModule, "src/cli.ts must be exportable or executable");

  if (cliModule && typeof cliModule.parseArgs === "function") {
    const parsed = cliModule.parseArgs(["--source=tdlr", "--dry-run", "--force"]);
    assert.equal(parsed.source, "tdlr");
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.force, true);
  }
});

test("Ticket 20 - Criteria 2: CLI exits with code 0 on dry-run or clean completion", () => {
  const result = spawnSync("npx", ["tsx", "src/cli.ts", "--source=all", "--dry-run"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: true,
  });

  assert.equal(result.status, 0, `Expected CLI exit code 0 on clean dry-run, got ${result.status}. Output: ${result.stderr}`);
});

test("Ticket 20 - Criteria 3: CLI exits with code 1 on unknown flag or fatal syntax error", () => {
  const result = spawnSync("npx", ["tsx", "src/cli.ts", "--source=unsupported_unknown_portal"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: true,
  });

  assert.equal(result.status, 1, `Expected CLI exit code 1 on unsupported source, got ${result.status}`);
});

test("Ticket 20 - Criteria 4: CLI exits with code 2 on anomaly quarantine", async () => {
  const cliModule = await import("../../src/cli.js").catch(() => null);
  assert.ok(cliModule, "src/cli.ts must export exitCode constants or handlers");
  assert.equal(cliModule.EXIT_CODES?.ANOMALY_QUARANTINE, 2, "Anomaly quarantine must map to process exit code 2");
});
