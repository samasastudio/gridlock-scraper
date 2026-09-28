import http from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { CONNECTOR_JOBS, ensureConnectorConfigs, resolveJobsToRun } from "./cli.js";
import { runScraperPipeline } from "./jobs/runner.js";
import { handleHealthTelemetry } from "./routes/health.js";
import { ArtifactStore } from "./storage/artifact-store.js";
import { createDatabase, ScraperRepository } from "./storage/db.js";

export interface ScraperServer {
  listen(port?: number, host?: string): Promise<{ port: number; host: string }>;
  close(): Promise<void>;
  server: http.Server;
}

export interface CreateServerOptions {
  db?: DatabaseSync;
}

export function createServer(options: CreateServerOptions = {}): ScraperServer {
  const db =
    options.db ??
    createDatabase(process.env.GRIDLOCK_DB_PATH ?? path.resolve(process.cwd(), "gridlock.db"));
  const initPromise = ensureConnectorConfigs(db);
  const repo = new ScraperRepository(db);

  const store = new ArtifactStore(
    process.env.ARTIFACTS_DIR ?? path.resolve(process.cwd(), ".artifacts")
  );

  const activeRuns = new Map<
    string,
    {
      sourceFamily: string;
      status: "running" | "completed" | "failed";
      startedAt: string;
      completedAt?: string;
    }
  >();

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
        const sourceFamily = payload.sourceFamily ?? "all";

        activeRuns.set(runId, {
          sourceFamily,
          status: "running",
          startedAt: new Date().toISOString(),
        });

        // Asynchronously dispatch connector execution in background
        setImmediate(async () => {
          try {
            const sourceKey =
              sourceFamily === "tdlr_tabs"
                ? "tdlr"
                : sourceFamily === "ercot_queue"
                ? "ercot"
                : sourceFamily === "austin_permits"
                ? "austin"
                : sourceFamily === "municipal_agenda"
                ? "municipal"
                : sourceFamily === "tceq"
                ? "tceq"
                : "all";

            const jobs = resolveJobsToRun(sourceKey as any);
            // NOTE (Architecture Rationale): Sequential iteration is mandatory
            // to prevent concurrent transaction locks in SQLite and prevent triggering
            // rate-limiting across external Texas state agency portals.
            for (const job of jobs) {
              await runScraperPipeline({
                connectorId: job.connectorId,
                sourceFamily: job.sourceFamily,
                extractor: job.extractor,
                parser: job.parser,
                artifactStore: store,
                db,
              }).catch((err) => {
                console.error(`[Server Ingest Error] ${job.connectorId}:`, err);
              });
            }

            const record = activeRuns.get(runId);
            if (record) {
              record.status = "completed";
              record.completedAt = new Date().toISOString();
            }
          } catch {
            const record = activeRuns.get(runId);
            if (record) {
              record.status = "failed";
              record.completedAt = new Date().toISOString();
            }
          }
        });

        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "accepted",
            runId,
            sourceFamily,
            timestamp: new Date().toISOString(),
          })
        );
      });
      return;
    }

    // Route: GET /api/ingest/status
    if (req.method === "GET" && pathname === "/api/ingest/status") {
      let metrics = {
        totalRuns: 0,
        successfulRuns: 0,
        quarantinedRuns: 0,
      };
      const connectorsStatus: Record<string, string> = {
        tdlr_tabs: "ok",
        ercot_queue: "ok",
        tceq: "ok",
        municipal_agenda: "ok",
        austin_permits: "ok",
      };

      try {
        metrics = await repo.getArtifactRunStats();
        const configRows = await repo.getAllConnectorConfigs();

        if (Array.isArray(configRows)) {
          Object.assign(
            connectorsStatus,
            Object.fromEntries(
              configRows.map((row) => [
                row.sourceFamily ?? row.id,
                row.lastStatus === "idle" ? "ok" : row.lastStatus,
              ])
            )
          );
        }
      } catch {
        // Fallback to defaults
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          metrics,
          connectors: connectorsStatus,
        })
      );
      return;
    }

    // Route: GET /api/source-health/telemetry
    if (req.method === "GET" && pathname === "/api/source-health/telemetry") {
      await handleHealthTelemetry(req, res, repo);
      return;
    }

    // 404 Fallback
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found", pathname }));
  });

  return {
    server,
    listen(port = 0, host = "0.0.0.0"): Promise<{ port: number; host: string }> {
      return initPromise.then(
        () =>
          new Promise((resolve, reject) => {
            server.listen(port, host, () => {
              const address = server.address() as AddressInfo;
              resolve({ port: address.port, host: address.address });
            });
            server.once("error", reject);
          })
      );
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

export async function startServer(port = 8080, host = "0.0.0.0"): Promise<ScraperServer> {
  const app = createServer();
  const addr = await app.listen(port, host);
  console.log(`[Scraper Server] Listening on http://${addr.host}:${addr.port}`);
  return app;
}

// Auto-run if executed directly
const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (scriptPath.endsWith("server.ts") || scriptPath.endsWith("server.js")) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
  startServer(port).catch((err) => {
    console.error("[Scraper Server] Fatal startup error:", err);
    process.exit(1);
  });
}
