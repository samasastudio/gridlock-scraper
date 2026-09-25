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
