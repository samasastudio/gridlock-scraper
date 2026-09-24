import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseErcotCsv } from "../src/parsers/ercot.js";
import { parseMunicipalAgenda } from "../src/parsers/municipal.js";
import { parseTceqHtml } from "../src/parsers/tceq.js";
import { parseTdlrHtml } from "../src/parsers/tdlr.js";
import { validateTdlrInvariants } from "../src/schemas/tdlr.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

test("TDLR pure parser extracts project and location observations from fixture", () => {
  const html = readFileSync(
    join(FIXTURES_DIR, "tdlr", "tabs-sample.html"),
    "utf8"
  );
  const observations = parseTdlrHtml(html);

  assert.ok(observations.length >= 3);

  const costObs = observations.find((o) => o.property === "estimated_cost");
  assert.ok(costObs);
  assert.deepEqual(costObs.valueJson, { usd: 450000000 });
  assert.equal(costObs.subjectId, "TABS2024098765");

  const sqftObs = observations.find((o) => o.property === "square_footage");
  assert.ok(sqftObs);
  assert.deepEqual(sqftObs.valueJson, { sqft: 385000 });

  const locObs = observations.find((o) => o.property === "address_details");
  assert.ok(locObs);
  assert.equal((locObs.valueJson as any).county, "Travis");
});

test("TDLR invariant validation rejects invalid project number format", () => {
  assert.throws(() => {
    validateTdlrInvariants({
      projectNumber: "INVALID123", // Must begin with TABS
      projectName: "Bad Project",
      estimatedCostUsd: 1000,
      city: "Austin",
      county: "Travis",
    });
  });
});

test("ERCOT pure parser extracts facilities from CSV fixture", () => {
  const csv = readFileSync(
    join(FIXTURES_DIR, "ercot", "queue-sample.csv"),
    "utf8"
  );
  const observations = parseErcotCsv(csv);

  assert.equal(observations.length, 9); // 3 rows * 3 observations per row

  const batFacility = observations.find(
    (o) => o.subjectId === "24INR0412" && o.property === "power_capacity_mw"
  );
  assert.ok(batFacility);
  assert.deepEqual(batFacility.valueJson, { mw: 400 });

  const loadFacility = observations.find(
    (o) => o.subjectId === "24INR0414" && o.property === "power_capacity_mw"
  );
  assert.ok(loadFacility);
  assert.deepEqual(loadFacility.valueJson, { mw: 800 });
});

test("TCEQ pure parser extracts environmental permit from fixture", () => {
  const html = readFileSync(
    join(FIXTURES_DIR, "tceq", "permit-sample.html"),
    "utf8"
  );
  const observations = parseTceqHtml(html);

  assert.equal(observations.length, 2);
  const permitObs = observations.find((o) => o.property === "environmental_permit");
  assert.ok(permitObs);
  assert.equal(permitObs.subjectId, "TCEQ-189421");
  assert.equal((permitObs.valueJson as any).status, "issued");
});

test("Municipal pure parser extracts zoning action from fixture", () => {
  const html = readFileSync(
    join(FIXTURES_DIR, "municipal", "agenda-sample.html"),
    "utf8"
  );
  const observations = parseMunicipalAgenda(html);

  assert.equal(observations.length, 1);
  const actionObs = observations[0]!;
  assert.equal(actionObs.subjectId, "C14-2024-0099");
  assert.equal((actionObs.valueJson as any).status, "approved");
});
