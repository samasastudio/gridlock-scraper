import type { DatabaseSync } from "node:sqlite";
import type { ObservationCandidate } from "../schemas/common.js";
import { ScraperRepository } from "../storage/db.js";

export type ReplayFixture = {
  id: string;
  content: string | Buffer;
  expectedMinCount?: number;
  expectedSubjectIds?: string[];
  expectedAssertion?: (observations: ObservationCandidate[]) => boolean;
} & (
  | { expectedMinCount: number }
  | { expectedSubjectIds: string[] }
  | { expectedAssertion: (observations: ObservationCandidate[]) => boolean }
);

export interface ReplayEvaluationResult {
  passed: number;
  total: number;
  allPassed: boolean;
  auditId: string;
}

export interface SingleFixtureEvaluation {
  fixtureId: string;
  passed: boolean;
  failureReason?: string;
}

function hasSemanticOracle(fixture: ReplayFixture): boolean {
  return (
    (typeof fixture.expectedMinCount === "number" && fixture.expectedMinCount >= 0) ||
    (Array.isArray(fixture.expectedSubjectIds) && fixture.expectedSubjectIds.length > 0) ||
    typeof fixture.expectedAssertion === "function"
  );
}

/**
 * Pure evaluation of a candidate parser against a single historical fixture.
 * Emits explicit diagnostic failure reasons for rapid root-cause isolation.
 */
function evaluateSingleFixture(
  fixture: ReplayFixture,
  candidateParser: (content: string) => ObservationCandidate[]
): SingleFixtureEvaluation {
  try {
    const contentStr = Buffer.isBuffer(fixture.content)
      ? fixture.content.toString("utf8")
      : fixture.content;
    const obs = candidateParser(contentStr);

    if (!obs || obs.length === 0) {
      return {
        fixtureId: fixture.id,
        passed: false,
        failureReason: "Empty observations produced",
      };
    }
    if (fixture.expectedMinCount !== undefined && obs.length < fixture.expectedMinCount) {
      return {
        fixtureId: fixture.id,
        passed: false,
        failureReason: `Observation count ${obs.length} < expected min ${fixture.expectedMinCount}`,
      };
    }
    if (fixture.expectedSubjectIds && fixture.expectedSubjectIds.length > 0) {
      const extractedIds = new Set(obs.map((o) => o.subjectId));
      const missing = fixture.expectedSubjectIds.filter((id) => !extractedIds.has(id));
      if (missing.length > 0) {
        return {
          fixtureId: fixture.id,
          passed: false,
          failureReason: `Missing required subject IDs: ${missing.join(", ")}`,
        };
      }
    }
    if (fixture.expectedAssertion && !fixture.expectedAssertion(obs)) {
      return {
        fixtureId: fixture.id,
        passed: false,
        failureReason: "Semantic expectedAssertion predicate returned false",
      };
    }
    return { fixtureId: fixture.id, passed: true };
  } catch (err: any) {
    return {
      fixtureId: fixture.id,
      passed: false,
      failureReason: `Parser threw error: ${err.message}`,
    };
  }
}

/**
 * Historical replay test harness verifying candidate selector patches
 * against frozen fixtures before promotion (ADR-0004).
 */
export async function evaluateCandidatePatch(
  connectorId: string,
  proposedPatchDescription: Record<string, unknown>,
  candidateParser: (content: string) => ObservationCandidate[],
  fixtures: ReplayFixture[],
  db: DatabaseSync,
  options?: { quarantinedArtifactId?: string }
): Promise<ReplayEvaluationResult> {
  const invalidFixture = fixtures.find((f) => !hasSemanticOracle(f));
  if (invalidFixture) {
    throw new Error(
      `ReplayFixture '${invalidFixture.id}' must provide at least one semantic oracle (expectedMinCount, expectedSubjectIds, or expectedAssertion).`
    );
  }

  const evaluations = fixtures.map((f) => evaluateSingleFixture(f, candidateParser));
  const passed = evaluations.filter((e) => e.passed).length;
  const allPassed = fixtures.length > 0 && passed === fixtures.length;
  const repo = new ScraperRepository(db);

  const replayResults: Record<string, unknown> = {
    passed,
    total: fixtures.length,
    allPassed,
    details: evaluations,
    ...(options?.quarantinedArtifactId ? { quarantinedArtifactId: options.quarantinedArtifactId } : {}),
  };

  let auditId: string;
  if (allPassed) {
    auditId = await repo.promotePatchAndRecordAudit({
      connectorId,
      failureReason: "Self-healing candidate verification replay",
      proposedPatch: proposedPatchDescription,
      replayResults,
    });
  } else {
    auditId = await repo.insertRepairAudit({
      connectorId,
      failureReason: "Self-healing candidate verification replay",
      proposedPatch: proposedPatchDescription,
      replayResults,
      status: "rejected",
    });
  }

  return {
    passed,
    total: fixtures.length,
    allPassed,
    auditId,
  };
}
