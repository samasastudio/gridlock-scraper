import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCandidatePatch, type ReplayFixture } from "../../src/repair/replay.js";
import { createDatabase } from "../../src/storage/db.js";

test("Ticket 26 - Criteria 1 & 2: ReplayFixture rejects fixture evaluation without semantic oracles", async () => {
  const db = createDatabase(":memory:");

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('tdlr_v1', 'tdlr_tabs', '{}', '{}')
  `).run();

  // A fixture with no oracle (no expectedMinCount, no expectedSubjectIds, no expectedAssertion)
  const emptyOracleFixture: any = {
    id: "empty-oracle",
    content: "<html><body><div>Content</div></body></html>",
  };

  await assert.rejects(
    async () => {
      await evaluateCandidatePatch(
        "tdlr_v1",
        { patch: "test" },
        () => [{ subjectType: "project", subjectId: "P1", property: "x", valueJson: {} }],
        [emptyOracleFixture],
        db
      );
    },
    /semantic oracle|oracle|expectedMinCount/i,
    "Replay harness must throw error if fixture does not specify at least one semantic oracle"
  );
});

test("Ticket 26 - Criteria 3: ReplayFixture accepts fixture with valid semantic oracle", async () => {
  const db = createDatabase(":memory:");

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('tdlr_v1', 'tdlr_tabs', '{}', '{}')
  `).run();

  const validOracleFixture: ReplayFixture = {
    id: "valid-oracle",
    content: "<html><body><div>Content</div></body></html>",
    expectedMinCount: 1,
  };

  const result = await evaluateCandidatePatch(
    "tdlr_v1",
    { patch: "valid" },
    () => [{ subjectType: "project", subjectId: "P1", property: "x", valueJson: {} }],
    [validOracleFixture],
    db
  );

  assert.equal(result.allPassed, true);
  assert.equal(result.passed, 1);
});
