import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseCsvLine, parseErcotCsv } from "../src/parsers/ercot.js";
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

  const ownerObs = observations.find((o) => o.property === "owner");
  assert.ok(ownerObs);
  assert.deepEqual(ownerObs.valueJson, { owner: "Red River Hyperscale LLC" });

  const archObs = observations.find((o) => o.property === "architect");
  assert.ok(archObs);
  assert.deepEqual(archObs.valueJson, { architect: "Corgan Associates Inc" });
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

test("TDLR pure parser rejects HTML missing city/county without falling back to Austin/Travis", () => {
  const htmlMissingCity = `
    <html><body>
      <span id="ctl00_ContentPlaceHolder1_lblProjectNumber">TABS2024999999</span>
      <span id="ctl00_ContentPlaceHolder1_lblProjectName">Dallas Substation</span>
      <span id="ctl00_ContentPlaceHolder1_lblEstimatedCost">$1,000,000</span>
    </body></html>
  `;
  assert.throws(() => {
    parseTdlrHtml(htmlMissingCity);
  });
});

test("TDLR pure parser rejects HTML missing or non-numeric estimated cost without zero fallback", () => {
  const htmlMissingCost = `
    <html><body>
      <span id="ctl00_ContentPlaceHolder1_lblProjectNumber">TABS2024999999</span>
      <span id="ctl00_ContentPlaceHolder1_lblProjectName">Dallas Substation</span>
      <span id="ctl00_ContentPlaceHolder1_lblCity">Dallas</span>
      <span id="ctl00_ContentPlaceHolder1_lblCounty">Dallas</span>
    </body></html>
  `;
  assert.throws(() => {
    parseTdlrHtml(htmlMissingCost);
  });

  const htmlNaCost = `
    <html><body>
      <span id="ctl00_ContentPlaceHolder1_lblProjectNumber">TABS2024999999</span>
      <span id="ctl00_ContentPlaceHolder1_lblProjectName">Dallas Substation</span>
      <span id="ctl00_ContentPlaceHolder1_lblEstimatedCost">N/A</span>
      <span id="ctl00_ContentPlaceHolder1_lblCity">Dallas</span>
      <span id="ctl00_ContentPlaceHolder1_lblCounty">Dallas</span>
    </body></html>
  `;
  assert.throws(() => {
    parseTdlrHtml(htmlNaCost);
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

test("ERCOT pure parser parses quoted CSV entries with commas correctly", () => {
  const csv = [
    "INR,Project Name,Fuel,MW,County",
    '24INR0500,"Austin Energy, Substation North",SOL,150.0,Travis',
    '24INR0501,"Milam Mega-Load, Phase 1",LOAD,1200.0,Milam',
  ].join("\n");

  const observations = parseErcotCsv(csv);
  assert.equal(observations.length, 6);

  const solarFacility = observations.find(
    (o) => o.subjectId === "24INR0500" && o.property === "power_capacity_mw"
  );
  assert.ok(solarFacility);
  assert.deepEqual(solarFacility.valueJson, { mw: 150 });

  const milamLocation = observations.find(
    (o) => o.subjectId === "milam_county" && o.property === "county"
  );
  assert.ok(milamLocation);
  assert.deepEqual(milamLocation.valueJson, { county: "Milam", state: "TX" });
});

test("ERCOT pure parser throws on missing required headers", () => {
  const badCsv = [
    "RandomHeader1,RandomHeader2",
    "val1,val2",
  ].join("\n");

  assert.throws(() => {
    parseErcotCsv(badCsv);
  });
});

test("ERCOT pure parser throws on empty or header-only CSV", () => {
  assert.throws(() => {
    parseErcotCsv("");
  });
  assert.throws(() => {
    parseErcotCsv("INR,Project Name,Fuel,MW,County\n");
  });
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

test("TCEQ pure parser rejects broken/error HTML without synthetic fallbacks", () => {
  const errorHtml = "<html><body><h1>502 Bad Gateway</h1><p>Server error</p></body></html>";
  assert.throws(() => {
    parseTceqHtml(errorHtml);
  });
});

test("Municipal pure parser extracts multiple zoning actions from fixture", () => {
  const html = readFileSync(
    join(FIXTURES_DIR, "municipal", "agenda-sample.html"),
    "utf8"
  );
  const observations = parseMunicipalAgenda(html);

  assert.equal(observations.length, 2);
  const obs1 = observations.find((o) => o.subjectId === "C14-2024-0099");
  assert.ok(obs1);
  assert.equal((obs1.valueJson as any).status, "approved");

  const obs2 = observations.find((o) => o.subjectId === "C14-2024-0100");
  assert.ok(obs2);
  assert.equal((obs2.valueJson as any).jurisdiction, "Taylor");
  assert.equal((obs2.valueJson as any).status, "under_review");
});

test("Municipal pure parser rejects HTML missing case identifier or jurisdiction", () => {
  const brokenAgendaHtml = `
    <div class="agenda-item">
      <div class="action-title">Only a title without identifier</div>
    </div>
  `;
  assert.throws(() => {
    parseMunicipalAgenda(brokenAgendaHtml);
  });
});
