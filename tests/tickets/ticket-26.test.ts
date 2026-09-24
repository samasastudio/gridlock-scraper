import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCandidatePatch, type ReplayFixture } from "../../src/repair/replay.js";
import { createDatabase } from "../../src/storage/db.js";

test("Ticket 26 - Criteria 1 & 2: ReplayFixture rejects fixture evaluation without semantic oracles", async () => {
  const db = createDatabase(":memory:");

  // A fixture with no oracle (no expectedMinCount, no expectedSubjectIds, no expectedAssertion)
  const emptyOracleFixture: any = {
    id: "empty-oracle",
    content: "<html><body><div>Content</div></body></html>",
  };

  await assert.rejects(
    async () => {
      await evaluateCandidatePatch(
        "test_connector",
        {},
        () => [{ subjectType: "project", subjectId: "P1", property: "x", valueJson: {} }],
        [emptyOracleFixture],
        db
      );
    },
    /oracle|assertion|expectedMinCount/i,
    "Replay harness must throw error if fixture does not specify at least one semantic oracle"
  );
});
