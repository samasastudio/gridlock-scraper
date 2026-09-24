import type { DatabaseSync } from "node:sqlite";
import type { RawExtractionResult } from "../extractors/types.js";
import { quarantineExtractionFailure } from "../repair/quarantine.js";
import type { ObservationCandidate, SourceFamily } from "../schemas/common.js";
import { ArtifactStore } from "../storage/artifact-store.js";
import { ScraperRepository } from "../storage/db.js";

export interface PipelineRunOptions {
  connectorId: string;
  sourceFamily: SourceFamily;
  extractor: () => Promise<RawExtractionResult>;
  parser: (raw: string) => ObservationCandidate[];
  artifactStore?: ArtifactStore;
  db: DatabaseSync;
}

export interface PipelineRunResult {
  connectorId: string;
  sourceFamily: SourceFamily;
  earlyExit: boolean;
  sha256Hash: string;
  observationsCount: number;
  sourceArtifactId?: string;
  anomaly?: boolean;
}

/**
 * Core pipeline runner implementing the Content-Hash Early-Exit and Invariant Gates (ADR-0003).
 */
export async function runScraperPipeline(
  options: PipelineRunOptions
): Promise<PipelineRunResult> {
  const store = options.artifactStore ?? new ArtifactStore();
  const repo = new ScraperRepository(options.db);

  let rawResult: RawExtractionResult;
  try {
    rawResult = await options.extractor();
  } catch (err: any) {
    quarantineExtractionFailure({
      connectorId: options.connectorId,
      sourceFamily: options.sourceFamily,
      sourceUrl: "unknown",
      rawPayload: "",
      failureReason: `Extraction failure: ${err.message}`,
      artifactStore: store,
      db: options.db,
    });
    return {
      connectorId: options.connectorId,
      sourceFamily: options.sourceFamily,
      earlyExit: false,
      sha256Hash: "",
      observationsCount: 0,
      anomaly: true,
    };
  }

  const contentStr = Buffer.isBuffer(rawResult.content)
    ? rawResult.content.toString("utf8")
    : rawResult.content;

  const sha256Hash = store.computeHash(rawResult.content);

  // 1. Content-Hash Early-Exit Check (ADR-0003)
  const existingArtifact = repo.findSourceArtifactByHash(sha256Hash);
  if (existingArtifact) {
    repo.updateConnectorStatus(options.connectorId, "ok");
    return {
      connectorId: options.connectorId,
      sourceFamily: options.sourceFamily,
      earlyExit: true,
      sha256Hash,
      observationsCount: 0,
      sourceArtifactId: existingArtifact.id,
    };
  }

  // 2. Persist new raw artifact
  const stored = store.store(options.sourceFamily, rawResult.content, "html");
  const sourceArtifactId = repo.insertSourceArtifact({
    sha256Hash,
    sourceFamily: options.sourceFamily,
    sourceUrl: rawResult.sourceUrl,
    contentType: rawResult.contentType,
    byteSize: stored.byteSize,
    storagePath: stored.storagePath,
    connectorVersion: rawResult.connectorVersion,
  });

  // 3. Pure Parser & Invariant Validation
  let candidates: ObservationCandidate[];
  try {
    candidates = options.parser(contentStr);
  } catch (err: any) {
    quarantineExtractionFailure({
      connectorId: options.connectorId,
      sourceFamily: options.sourceFamily,
      sourceUrl: rawResult.sourceUrl,
      rawPayload: rawResult.content,
      failureReason: `Parser invariant failure: ${err.message}`,
      artifactStore: store,
      db: options.db,
    });
    return {
      connectorId: options.connectorId,
      sourceFamily: options.sourceFamily,
      earlyExit: false,
      sha256Hash,
      observationsCount: 0,
      sourceArtifactId,
      anomaly: true,
    };
  }

  // 4. Transform into atomic observations linked to source artifact
  const observations = candidates.map((cand) => ({
    subjectType: cand.subjectType,
    subjectId: cand.subjectId,
    property: cand.property,
    valueJson: cand.valueJson,
    effectiveAt: cand.effectiveAt ?? null,
    sourceArtifactId,
    connectorVersion: rawResult.connectorVersion,
    confidence: cand.confidence ?? 1.0,
    resolutionMethod: cand.resolutionMethod ?? "deterministic",
  }));

  repo.insertObservations(observations);
  repo.updateConnectorStatus(options.connectorId, "ok");

  return {
    connectorId: options.connectorId,
    sourceFamily: options.sourceFamily,
    earlyExit: false,
    sha256Hash,
    observationsCount: observations.length,
    sourceArtifactId,
  };
}
