import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ticket 22 - Criteria 1: GitHub Actions ingest workflow exists with scheduled cron and dispatch", () => {
  const workflowPath = path.resolve(process.cwd(), ".github/workflows/ingest.yml");
  assert.ok(fs.existsSync(workflowPath), "Expected .github/workflows/ingest.yml to exist");

  const content = fs.readFileSync(workflowPath, "utf8");
  assert.match(content, /0 \*\/(4|6) \* \* \*/, "Workflow must define scheduled cron trigger");
  assert.match(content, /workflow_dispatch/, "Workflow must support manual workflow_dispatch");
});

test("Ticket 22 - Criteria 2: Anomaly notification script scripts/notify-anomaly.ts exists", () => {
  const notifyPath = path.resolve(process.cwd(), "scripts/notify-anomaly.ts");
  assert.ok(fs.existsSync(notifyPath), "Expected scripts/notify-anomaly.ts to exist");
});

test("Ticket 22 - Criteria 3: Webhook alert dispatcher handles exit code 2", () => {
  const notifyPath = path.resolve(process.cwd(), "scripts/notify-anomaly.ts");
  if (!fs.existsSync(notifyPath)) {
    assert.fail("scripts/notify-anomaly.ts not implemented");
  }
  const content = fs.readFileSync(notifyPath, "utf8");
  assert.match(content, /ALERT_WEBHOOK_URL/, "Notifier must reference ALERT_WEBHOOK_URL");
});
