export interface AnomalyAlertParams {
  connectorId: string;
  failureReason: string;
  artifactId: string;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Dispatches an alert payload to external monitoring (Slack/Discord/Webhook) when an anomaly is quarantined (exit code 2).
 */
export async function sendAnomalyAlert(params: AnomalyAlertParams): Promise<Response> {
  const webhookUrl = params.webhookUrl ?? process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("No webhook URL provided or configured in ALERT_WEBHOOK_URL environment variable.");
  }

  const payload = {
    connectorId: params.connectorId,
    failureReason: params.failureReason,
    artifactId: params.artifactId,
    timestamp: new Date().toISOString(),
    metadata: params.metadata ?? {},
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.warn(`[Alert] Webhook returned non-2xx status: ${response.status}`);
  }

  return response;
}

// Auto-execute when run directly from command line
const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (scriptPath.endsWith("notify-anomaly.ts") || scriptPath.endsWith("notify-anomaly.js")) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[notify-anomaly] ALERT_WEBHOOK_URL not configured. Skipping alert dispatch.");
    process.exit(0);
  }

  const { parseArgs } = await import("node:util");
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      connectorId: { type: "string" },
      reason: { type: "string" },
      artifactId: { type: "string" },
    },
    strict: false,
  });

  const connectorId =
    values.connectorId ?? process.env.CONNECTOR_ID ?? "ingestion_runner";
  const failureReason =
    values.reason ??
    process.env.FAILURE_REASON ??
    "Scheduled ingestion sweep encountered anomaly quarantine";
  const artifactId =
    values.artifactId ?? process.env.ARTIFACT_ID ?? "quarantine";

  sendAnomalyAlert({
    connectorId,
    failureReason,
    artifactId,
    webhookUrl,
  })
    .then(() => {
      console.log("[notify-anomaly] Webhook alert dispatched successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[notify-anomaly] Failed to dispatch webhook alert: ${err.message}`);
      process.exit(1);
    });
}
