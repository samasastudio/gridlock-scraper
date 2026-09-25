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

function getExtensionForContentType(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("csv")) return "csv";
  if (ct.includes("json")) return "json";
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("xml")) return "xml";
  return "html";
}

/**
 * Core pipeline runner implementing the Content-Hash Early-Exit and Invariant Gates (ADR-0003, ADR-0004).
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
    await quarantineExtractionFailure({
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
  const existingArtifact = await repo.findSourceArtifactByHash(sha256Hash);
  if (existingArtifact) {
    if (existingArtifact.connectorVersion === "quarantine") {
      // Gate quarantine payload release on verified out-of-band promotion (ADR-0004, Ticket 24)
      const hasPromotion = await repo.hasPromotedRepairAudit(options.connectorId, existingArtifact);
      if (!hasPromotion) {
        return {
          connectorId: options.connectorId,
          sourceFamily: options.sourceFamily,
          earlyExit: true,
          sha256Hash,
          observationsCount: 0,
          sourceArtifactId: existingArtifact.id,
          anomaly: true,
        };
      }

      // Known previously quarantined payload. Attempt re-processing with current parser (ADR-0004)
      try {
        const candidates = options.parser(contentStr);
        const observations = candidates.map((cand) => ({
          subjectType: cand.subjectType,
          subjectId: cand.subjectId,
          property: cand.property,
          valueJson: cand.valueJson,
          effectiveAt: cand.effectiveAt ?? null,
          sourceArtifactId: existingArtifact.id,
          connectorVersion: rawResult.connectorVersion,
          confidence: cand.confidence ?? 1.0,
          resolutionMethod: cand.resolutionMethod ?? "deterministic",
        }));

        await repo.commitReprocessedQuarantine({
          artifactId: existingArtifact.id,
          connectorVersion: rawResult.connectorVersion,
          observations,
          connectorId: options.connectorId,
        });

        return {
          connectorId: options.connectorId,
          sourceFamily: options.sourceFamily,
          earlyExit: false,
          sha256Hash,
          observationsCount: observations.length,
          sourceArtifactId: existingArtifact.id,
        };
      } catch {
        // Still failing validation with current parser; remain in quarantine
        return {
          connectorId: options.connectorId,
          sourceFamily: options.sourceFamily,
          earlyExit: true,
          sha256Hash,
          observationsCount: 0,
          sourceArtifactId: existingArtifact.id,
          anomaly: true,
        };
      }
    }

    await repo.updateConnectorStatus(options.connectorId, "ok");
    return {
      connectorId: options.connectorId,
      sourceFamily: options.sourceFamily,
      earlyExit: true,
      sha256Hash,
      observationsCount: 0,
      sourceArtifactId: existingArtifact.id,
    };
  }

  // 2. Pure Parser & Invariant Validation (ADR-0002, Step 4)
  // Validate pure invariants before database writes to prevent corrupted partial artifacts.
  let candidates: ObservationCandidate[];
  try {
    candidates = options.parser(contentStr);
  } catch (err: any) {
    const { artifactId } = await quarantineExtractionFailure({
      connectorId: options.connectorId,
      sourceFamily: options.sourceFamily,
      sourceUrl: rawResult.sourceUrl,
      rawPayload: rawResult.content,
      failureReason: `Parser invariant failure: ${err.message}`,
      artifactStore: store,
      db: options.db,
      contentType: rawResult.contentType,
      extension: getExtensionForContentType(rawResult.contentType),
    });
    return {
      connectorId: options.connectorId,
      sourceFamily: options.sourceFamily,
      earlyExit: false,
      sha256Hash,
      observationsCount: 0,
      sourceArtifactId: artifactId,
      anomaly: true,
    };
  }

  // 3 & 4. Persist raw artifact and observations atomically inside a transaction
  const extension = getExtensionForContentType(rawResult.contentType);
  const stored = store.store(options.sourceFamily, rawResult.content, extension);

  const { artifactId: sourceArtifactId, observationsCount } =
    await repo.commitNewArtifactWithObservations({
      artifact: {
        sha256Hash,
        sourceFamily: options.sourceFamily,
        sourceUrl: rawResult.sourceUrl,
        contentType: rawResult.contentType,
        byteSize: stored.byteSize,
        storagePath: stored.storagePath,
        connectorVersion: rawResult.connectorVersion,
      },
      observations: (sourceArtifactId) =>
        candidates.map((cand) => ({
          subjectType: cand.subjectType,
          subjectId: cand.subjectId,
          property: cand.property,
          valueJson: cand.valueJson,
          effectiveAt: cand.effectiveAt ?? null,
          sourceArtifactId,
          connectorVersion: rawResult.connectorVersion,
          confidence: cand.confidence ?? 1.0,
          resolutionMethod: cand.resolutionMethod ?? "deterministic",
        })),
      connectorId: options.connectorId,
    });

  return {
    connectorId: options.connectorId,
    sourceFamily: options.sourceFamily,
    earlyExit: false,
    sha256Hash,
    observationsCount,
    sourceArtifactId,
  };
}
