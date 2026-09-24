import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ticket 24 - Criteria 1: Query repair_audits for connector status 'promoted' before quarantine re-ingestion", () => {
  const runnerPath = path.resolve(process.cwd(), "src/jobs/runner.ts");
  const content = fs.readFileSync(runnerPath, "utf8");

  assert.match(
    content,
    /repair_audits|repairAudits/,
    "Runner must query repair_audits to verify out-of-band promotion before quarantine release"
  );
  assert.match(
    content,
    /["']promoted["']/,
    "Runner must check for 'promoted' audit status before releasing quarantine payload"
  );
});

test("Ticket 24 - Criteria 2: Unreviewed parser runs leave failing payload in quarantine without false anomaly clearing", () => {
  const runnerPath = path.resolve(process.cwd(), "src/jobs/runner.ts");
  const content = fs.readFileSync(runnerPath, "utf8");

  // Invariant: cannot blindly attempt re-processing if no verified repair audit exists
  assert.doesNotMatch(
    content,
    /if\s*\(\s*existingArtifact\.connectorVersion\s*===\s*["']quarantine["']\s*\)\s*\{\s*try\s*\{\s*const\s+candidates\s*=\s*options\.parser/,
    "Quarantine reprocessing must be gated behind repair audit verification, not immediate re-parse"
  );
});
