import assert from "node:assert/strict";
import test from "node:test";

test("Ticket 07 - Criteria 1: POST /api/ingest/trigger dispatches asynchronous connector runs", async () => {
  const serverModule = await import("../../src/server.js").catch(() => null);
  assert.ok(serverModule, "src/server.ts must be implemented and export createServer or startServer");

  const app = await serverModule.createServer();
  const address = await app.listen(0);
  const port = address.port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ingest/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceFamily: "tdlr_tabs" }),
    });

    assert.ok(res.status === 200 || res.status === 202, `Expected status 200 or 202, got ${res.status}`);
    const data = await res.json() as any;
    assert.ok(data.runId || data.status, "Response must include runId or status");
  } finally {
    await app.close();
  }
});

test("Ticket 07 - Criteria 2: GET /api/ingest/status returns run metrics and invariant state", async () => {
  const serverModule = await import("../../src/server.js").catch(() => null);
  assert.ok(serverModule, "src/server.ts must be implemented");

  const app = await serverModule.createServer();
  const address = await app.listen(0);
  const port = address.port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ingest/status`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.ok("metrics" in data || "connectors" in data, "Status response must include metrics or connectors");
  } finally {
    await app.close();
  }
});

test("Ticket 07 - Criteria 3: GET /api/source-health/telemetry reports connector uptime and repair audits", async () => {
  const serverModule = await import("../../src/server.js").catch(() => null);
  assert.ok(serverModule, "src/server.ts must be implemented");

  const app = await serverModule.createServer();
  const address = await app.listen(0);
  const port = address.port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/source-health/telemetry`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.ok("uptimeSeconds" in data || "telemetry" in data || "audits" in data);
  } finally {
    await app.close();
  }
});
