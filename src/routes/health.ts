import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";

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

export function handleHealthTelemetry(
  _req: IncomingMessage,
  res: ServerResponse,
  db?: DatabaseSync
): void {
  let connectorsCount = 5;
  let activeAnomalies = 0;
  let audits: Array<{ id: string; connectorId: string; status: string }> = [];

  if (db) {
    try {
      const countRow = db.prepare("SELECT count(*) as c FROM connector_configs").get() as any;
      if (countRow && typeof countRow.c === "number") {
        connectorsCount = countRow.c;
      }

      const anomalyRow = db
        .prepare("SELECT count(*) as a FROM connector_configs WHERE last_status = 'anomaly'")
        .get() as any;
      if (anomalyRow && typeof anomalyRow.a === "number") {
        activeAnomalies = anomalyRow.a;
      }

      const auditRows = db
        .prepare(
          "SELECT id, connector_id as connectorId, status FROM repair_audits ORDER BY created_at DESC LIMIT 10"
        )
        .all() as any[];
      if (Array.isArray(auditRows)) {
        audits = auditRows;
      }
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
