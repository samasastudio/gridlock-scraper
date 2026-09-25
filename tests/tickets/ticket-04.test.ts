import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/austin/permits-sample.json"
);

test("Ticket 04 - Criteria 1: Parser extracts permit number, status, valuation, applicant, and GIS parcel ID", async () => {
  const jsonContent = fs.readFileSync(FIXTURE_PATH, "utf8");

  // Dynamically import the pure parser from expected path
  const austinModule = await import("../../src/parsers/austin.js").catch(() => null);
  assert.ok(austinModule, "Module src/parsers/austin.ts must be implemented and export parseAustinPermitsJson");

  const observations = austinModule.parseAustinPermitsJson(jsonContent);
  assert.ok(observations.length >= 4, "Must extract multiple observations per permit");

  const permitObs = observations.find((o: any) => o.subjectId === "2024-118921-BP" && o.property === "permit_status");
  assert.ok(permitObs, "Must extract permit status observation");
  assert.equal(permitObs.valueJson.status, "Active");

  const valuationObs = observations.find((o: any) => o.subjectId === "2024-118921-BP" && o.property === "valuation");
  assert.ok(valuationObs, "Must extract valuation observation");
  assert.equal(valuationObs.valueJson.usd, 85000000);

  const parcelObs = observations.find((o: any) => o.subjectId === "2024-118921-BP" && o.property === "gis_parcel_id");
  assert.ok(parcelObs, "Must extract GIS parcel ID observation");
  assert.equal(parcelObs.valueJson.parcelId, "0219080312");

  const applicantObs = observations.find((o: any) => o.property === "applicant_name");
  assert.ok(applicantObs, "Must extract applicant observation");
  assert.equal(applicantObs.valueJson.name, "Lone Star Data Infrastructure LLC");
});

test("Ticket 04 - Criteria 2: Zod schema enforces non-empty permit number and positive valuation", async () => {
  const schemaModule = await import("../../src/schemas/austin.js").catch(() => null);
  assert.ok(schemaModule, "Module src/schemas/austin.ts must export AustinPermitSchema and validateAustinPermitInvariants");

  assert.throws(
    () => {
      schemaModule.validateAustinPermitInvariants({
        permitNumber: "",
        status: "Active",
        valuationUsd: 1000,
        applicantName: "Test Corp",
      });
    },
    /permitNumber/i,
    "Schema must reject empty permit numbers"
  );
});

test("Ticket 04 - Criteria 3: Socrata query builder constructs incremental date bounds and handles 429 backoff", async () => {
  const connectorModule = await import("../../src/connectors/austin-permits.js").catch(() => null);
  assert.ok(connectorModule, "Module src/connectors/austin-permits.ts must be implemented");

  const queryUrl = connectorModule.buildSocrataUrl({
    startDate: "2024-08-01",
    endDate: "2024-08-31",
  });

  assert.match(queryUrl, /applied_date\s*>=/i, "Query must contain lower date bound");
  assert.match(queryUrl, /applied_date\s*<=/i, "Query must contain upper date bound");

  // Verify rate limiter / retry handler with simulated 429
  let attempts = 0;
  const simulatedFetchWith429 = async () => {
    attempts++;
    if (attempts < 3) {
      const err: any = new Error("Rate limit exceeded");
      err.status = 429;
      throw err;
    }
    return { status: 200, json: async () => [] };
  };

  const result = await connectorModule.fetchWithBackoff(simulatedFetchWith429, { maxRetries: 3, baseDelayMs: 10 });
  assert.equal(result.status, 200);
  assert.equal(attempts, 3, "Fetch must retry upon encountering HTTP 429");
});
