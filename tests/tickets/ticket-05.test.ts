import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseErcotCsv } from "../../src/parsers/ercot.js";
import { parseTceqHtml } from "../../src/parsers/tceq.js";

const ERCOT_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/ercot/queue-sample.csv"
);

const TCEQ_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/tceq/permit-sample.html"
);

test("Ticket 05 - Criteria 1: Ingests CSV ERCOT queue data into structured load records (MW, county)", () => {
  const csv = fs.readFileSync(ERCOT_FIXTURE_PATH, "utf8");
  const observations = parseErcotCsv(csv);

  assert.ok(observations.length >= 3, "Must produce multiple observations for queue item");

  const mwObs = observations.find((o) => o.property === "power_capacity_mw");
  assert.ok(mwObs, "Must extract power_capacity_mw observation");
  assert.equal((mwObs?.valueJson as any).mw, 400);

  const locObs = observations.find((o) => o.subjectType === "location");
  assert.ok(locObs, "Must extract location observation");
  assert.equal((locObs?.valueJson as any).county, "Travis");
});

test("Ticket 05 - Criteria 2: Extracts TCEQ air quality permits for industrial/backup generation", () => {
  const html = fs.readFileSync(TCEQ_FIXTURE_PATH, "utf8");
  const observations = parseTceqHtml(html);

  assert.ok(observations.length >= 2, "Must produce environmental observations");

  const permitObs = observations.find((o) => o.property === "environmental_permit");
  assert.ok(permitObs, "Must extract environmental_permit property");
  assert.equal((permitObs?.valueJson as any).permitNumber, "TCEQ-189421");
  assert.equal((permitObs?.valueJson as any).actionType, "air_standard_permit");

  const orgObs = observations.find((o) => o.subjectType === "organization");
  assert.ok(orgObs, "Must extract applicant organization observation");
  assert.equal((orgObs?.valueJson as any).name, "Texas Compute Holdings LLC");
});

test("Ticket 05 - Criteria 3: Flags projects matching large load or data center queue thresholds", () => {
  const csv = fs.readFileSync(ERCOT_FIXTURE_PATH, "utf8");
  const observations = parseErcotCsv(csv);

  // Row 3 in fixture is 800 MW Taylor Hyperscale Substation
  const hyperscaleObs = observations.filter(
    (o) => o.property === "power_capacity_mw" && (o.valueJson as any).mw >= 100
  );

  assert.ok(hyperscaleObs.length >= 2, "Must identify multiple facilities meeting large load threshold (>= 100 MW)");
});
