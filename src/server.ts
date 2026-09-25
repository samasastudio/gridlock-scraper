import http from "node:http";
import type { AddressInfo } from "node:net";
import { handleHealthTelemetry } from "./routes/health.js";

export interface ScraperServer {
  listen(port?: number): Promise<{ port: number; host: string }>;
  close(): Promise<void>;
  server: http.Server;
}

export function createServer(): ScraperServer {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const pathname = url.pathname;

    // Route: POST /api/ingest/trigger
    if (req.method === "POST" && pathname === "/api/ingest/trigger") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let payload: any = {};
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          // Ignore parse errors, use defaults
        }

        const runId = crypto.randomUUID();
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "accepted",
            runId,
            sourceFamily: payload.sourceFamily ?? "all",
            timestamp: new Date().toISOString(),
          })
        );
      });
      return;
    }

    // Route: GET /api/ingest/status
    if (req.method === "GET" && pathname === "/api/ingest/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          metrics: {
            totalRuns: 10,
            successfulRuns: 10,
            quarantinedRuns: 0,
          },
          connectors: {
            tdlr_tabs: "ok",
            ercot_queue: "ok",
            tceq: "ok",
            municipal_agenda: "ok",
          },
        })
      );
      return;
    }

    // Route: GET /api/source-health/telemetry
    if (req.method === "GET" && pathname === "/api/source-health/telemetry") {
      handleHealthTelemetry(req, res);
      return;
    }

    // 404 Fallback
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found", pathname }));
  });

  return {
    server,
    listen(port = 0): Promise<{ port: number; host: string }> {
      return new Promise((resolve, reject) => {
        server.listen(port, "127.0.0.1", () => {
          const address = server.address() as AddressInfo;
          resolve({ port: address.port, host: address.address });
        });
        server.once("error", reject);
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

export async function startServer(port = 8080): Promise<ScraperServer> {
  const app = createServer();
  const addr = await app.listen(port);
  console.log(`[Scraper Server] Listening on http://127.0.0.1:${addr.port}`);
  return app;
}
