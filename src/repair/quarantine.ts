import type { DatabaseSync } from "node:sqlite";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { ScraperRepository } from "../storage/db.js";

export interface QuarantineParams {
  connectorId: string;
  sourceFamily: string;
  sourceUrl: string;
  rawPayload: Buffer | string;
  failureReason: string;
  artifactStore: ArtifactStore;
  db: DatabaseSync;
}

/**
 * Quarantines an anomalous extraction failure, saves the raw artifact,
 * and sets the connector status to "anomaly" without corrupting production entities (ADR-0004).
 */
export async function quarantineExtractionFailure(params: QuarantineParams): Promise<{
  artifactId: string;
  auditId: string;
}> {
  const repo = new ScraperRepository(params.db);
  const stored = params.artifactStore.store(
    `quarantine/${params.sourceFamily}`,
    params.rawPayload,
    "html"
  );

  const artifactId = await repo.insertSourceArtifact({
    sha256Hash: stored.sha256Hash,
    sourceFamily: params.sourceFamily,
    sourceUrl: params.sourceUrl,
    contentType: "text/html",
    byteSize: stored.byteSize,
    storagePath: stored.storagePath,
    connectorVersion: "quarantine",
  });

  await repo.updateConnectorStatus(params.connectorId, "anomaly");

  const auditId = await repo.insertRepairAudit({
    connectorId: params.connectorId,
    failureReason: params.failureReason,
    proposedPatch: {},
    replayResults: { quarantinedArtifactId: artifactId },
    status: "pending_review",
  });

  return { artifactId, auditId };
}
