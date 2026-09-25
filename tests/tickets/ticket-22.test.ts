import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ticket 22 - Criteria 1 & 2: GitHub Actions ingest workflow triggers on schedule and sequences sync hooks", () => {
  const workflowPath = path.resolve(process.cwd(), ".github/workflows/ingest.yml");
  assert.ok(fs.existsSync(workflowPath), "Expected .github/workflows/ingest.yml to exist");

  const content = fs.readFileSync(workflowPath, "utf8");
  assert.match(content, /schedule:\s*-\s*cron:\s*['"]0 \*\/(4|6) \* \* \*['"]/, "Workflow must define scheduled cron trigger");
  assert.match(content, /workflow_dispatch/, "Workflow must support manual workflow_dispatch");
  assert.match(content, /sync-state.*hydrate|pre-sync/i, "Workflow must run pre-sync state hydration");
  assert.match(content, /cli.*--source/i, "Workflow must execute CLI ingestion sweep");
  assert.match(content, /sync-state.*publish|post-sync/i, "Workflow must run post-sync state publish");
});

test("Ticket 22 - Criteria 3: Binds mandatory repository secrets", () => {
  const workflowPath = path.resolve(process.cwd(), ".github/workflows/ingest.yml");
  if (!fs.existsSync(workflowPath)) {
    assert.fail(".github/workflows/ingest.yml does not exist");
  }
  const content = fs.readFileSync(workflowPath, "utf8");
  assert.match(content, /CLOUDFLARE_R2/i, "Workflow must bind CLOUDFLARE_R2 secrets");
  assert.match(content, /GEMINI_API_KEY/i, "Workflow must bind GEMINI_API_KEY secret");
  assert.match(content, /ALERT_WEBHOOK_URL/i, "Workflow must bind ALERT_WEBHOOK_URL secret");
});

test("Ticket 22 - Criteria 4: Dispatches webhook alert payload on anomaly quarantine (exit code 2)", async () => {
  const notifyModule = await import("../../scripts/notify-anomaly.js").catch(() => null);
  assert.ok(notifyModule, "scripts/notify-anomaly.ts must be implemented and export sendAnomalyAlert");

  // Spin up ephemeral loopback HTTP server to verify webhook receipt
  let receivedPayload: any = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      receivedPayload = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const webhookUrl = `http://127.0.0.1:${address.port}/webhook`;

  try {
    await notifyModule.sendAnomalyAlert({
      connectorId: "ercot_queue_v1",
      failureReason: "Volume drop > 30% or schema invariant breach",
      artifactId: "art-test-1234",
      webhookUrl,
    });

    assert.ok(receivedPayload, "Webhook server must receive alert payload");
    assert.equal(receivedPayload.connectorId, "ercot_queue_v1");
    assert.match(receivedPayload.failureReason, /invariant breach|Volume drop/);
  } finally {
    server.close();
  }
});
