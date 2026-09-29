import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { ScraperRepository } from "../storage/db.js";

export interface TelemetryReport {
  uptimeSeconds: number;
  status: "healthy" | "degraded" | "unhealthy";
  telemetry: {
    connectorsCount: number;
    activeAnomalies: number;
  };
  audits: Array<{
    id: string;
    connectorId: string;
    status: string;
  }>;
}

export async function handleHealthTelemetry(
  _req: IncomingMessage,
  res: ServerResponse,
  dbOrRepo?: DatabaseSync | ScraperRepository
): Promise<void> {
  let connectorsCount = 5;
  let activeAnomalies = 0;
  let audits: Array<{ id: string; connectorId: string; status: string }> = [];

  if (dbOrRepo) {
    try {
      const repo =
        dbOrRepo instanceof ScraperRepository ? dbOrRepo : new ScraperRepository(dbOrRepo);
      const stats = await repo.getConnectorTelemetryStats();
      connectorsCount = stats.connectorsCount;
      activeAnomalies = stats.activeAnomalies;
      audits = await repo.getRecentRepairAudits(10);
    } catch {
      // Graceful fallback if tables are not yet queried
    }
  }

  const telemetryData: TelemetryReport = {
    uptimeSeconds: Math.floor(process.uptime()),
    status: activeAnomalies > 0 ? "degraded" : "healthy",
    telemetry: {
      connectorsCount,
      activeAnomalies,
    },
    audits,
  };

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(telemetryData));
}
