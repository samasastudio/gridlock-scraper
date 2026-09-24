import type { DatabaseSync } from "node:sqlite";
import type { ObservationCandidate } from "../schemas/common.js";
import { ScraperRepository } from "../storage/db.js";

export interface ReplayFixture {
  id: string;
  content: string | Buffer;
  expectedMinCount?: number;
  expectedSubjectIds?: string[];
  expectedAssertion?: (observations: ObservationCandidate[]) => boolean;
}

export interface ReplayEvaluationResult {
  passed: number;
  total: number;
  allPassed: boolean;
  auditId: string;
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
  db: DatabaseSync
): Promise<ReplayEvaluationResult> {
  let passed = 0;

  for (const fixture of fixtures) {
    try {
      const contentStr = Buffer.isBuffer(fixture.content)
        ? fixture.content.toString("utf8")
        : fixture.content;
      const obs = candidateParser(contentStr);
      if (!obs || obs.length === 0) {
        continue;
      }
      if (fixture.expectedMinCount !== undefined && obs.length < fixture.expectedMinCount) {
        continue;
      }
      if (fixture.expectedSubjectIds && fixture.expectedSubjectIds.length > 0) {
        const extractedIds = new Set(obs.map((o) => o.subjectId));
        const allPresent = fixture.expectedSubjectIds.every((id) => extractedIds.has(id));
        if (!allPresent) {
          continue;
        }
      }
      if (fixture.expectedAssertion && !fixture.expectedAssertion(obs)) {
        continue;
      }
      passed++;
    } catch {
      // Invariant assertion failure or syntax breakdown on fixture
    }
  }

  const allPassed = fixtures.length > 0 && passed === fixtures.length;
  const repo = new ScraperRepository(db);

  const auditId = await repo.insertRepairAudit({
    connectorId,
    failureReason: "Self-healing candidate verification replay",
    proposedPatch: proposedPatchDescription,
    replayResults: { passed, total: fixtures.length, allPassed },
    status: allPassed ? "promoted" : "rejected",
  });

  if (allPassed) {
    await repo.updateConnectorStatus(connectorId, "ok");
  }

  return {
    passed,
    total: fixtures.length,
    allPassed,
    auditId,
  };
}
