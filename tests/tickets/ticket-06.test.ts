import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseTdlrHtml } from "../../src/parsers/tdlr.js";
import { evaluateCandidatePatch } from "../../src/repair/replay.js";
import { createDatabase, ScraperRepository } from "../../src/storage/db.js";

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/tdlr/tabs-sample.html"
);

test("Ticket 06 - Criteria 1: Flags missing required fields or invariant violation as anomaly", () => {
  const malformedHtml = `<html><body><div>Missing all TABS fields</div></body></html>`;
  assert.throws(
    () => parseTdlrHtml(malformedHtml),
    (err: any) => err.name === "ZodError" || err.message.includes("Project number"),
    "Malformed HTML missing required fields must throw invariant error"
  );
});

test("Ticket 06 - Criteria 2 & 3: Replay sandbox evaluates candidate patch across historical fixtures", async () => {
  const db = createDatabase(":memory:");
  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES ('tdlr_v1', 'tdlr_tabs', '{}', '{}')
  `).run();

  const fixtureContent = fs.readFileSync(FIXTURE_PATH, "utf8");

  // Valid patch passes
  const validResult = await evaluateCandidatePatch(
    "tdlr_v1",
    { selector: "#ctl00_ContentPlaceHolder1_lblProjectNumber" },
    (content) => parseTdlrHtml(content),
    [
      {
        id: "fixture-1",
        content: fixtureContent,
        expectedMinCount: 1,
        expectedSubjectIds: ["TABS2024098765"],
      },
    ],
    db
  );

  assert.equal(validResult.allPassed, true);
  assert.equal(validResult.passed, 1);
  assert.equal(validResult.total, 1);

  // Broken patch fails
  const brokenResult = await evaluateCandidatePatch(
    "tdlr_v1",
    { selector: ".wrong-selector" },
    () => [], // Broken parser returns empty
    [
      {
        id: "fixture-1",
        content: fixtureContent,
        expectedMinCount: 1,
      },
    ],
    db
  );

  assert.equal(brokenResult.allPassed, false);
  assert.equal(brokenResult.passed, 0);
});

test("Ticket 06 - Criteria 4: Only promotes patch to connector status ok if replay pass rate is 100%", async () => {
  const db = createDatabase(":memory:");
  const repo = new ScraperRepository(db);

  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants, last_status)
    VALUES ('tdlr_v1', 'tdlr_tabs', '{}', '{}', 'anomaly')
  `).run();

  const fixtureContent = fs.readFileSync(FIXTURE_PATH, "utf8");

  // Replay failure does NOT promote status
  await evaluateCandidatePatch(
    "tdlr_v1",
    { note: "failing patch" },
    () => [],
    [{ id: "f1", content: fixtureContent, expectedMinCount: 1 }],
    db
  );

  const statusAfterFail = await repo.getConnectorConfig("tdlr_v1");
  assert.equal(statusAfterFail?.lastStatus, "anomaly");

  // 100% pass DOES promote status to 'ok'
  await evaluateCandidatePatch(
    "tdlr_v1",
    { note: "passing patch" },
    (c) => parseTdlrHtml(c),
    [{ id: "f1", content: fixtureContent, expectedMinCount: 1 }],
    db
  );

  const statusAfterPass = await repo.getConnectorConfig("tdlr_v1");
  assert.equal(statusAfterPass?.lastStatus, "ok");
});
