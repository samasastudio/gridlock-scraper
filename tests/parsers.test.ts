import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { parseAustinPermitsJson } from "../src/parsers/austin.js";
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

test("Municipal pure parser throws validation error when any agenda item in multi-item payload lacks identifier", () => {
  const mixedAgendaHtml = `
    <div class="agenda-item">
      <div class="action-identifier">C14-2024-0099</div>
      <div class="jurisdiction">Austin</div>
      <div class="action-title">Valid Rezoning Case</div>
      <div class="action-type">zoning</div>
      <div class="action-status">approved</div>
    </div>
    <div class="agenda-item">
      <div class="jurisdiction">Austin</div>
      <div class="action-title">Malformed Rezoning Case</div>
      <div class="action-type">zoning</div>
      <div class="action-status">approved</div>
    </div>
  `;
  assert.throws(
    () => {
      parseMunicipalAgenda(mixedAgendaHtml);
    },
    /actionIdentifier/i,
    "Malformed item in multi-item payload must throw schema error rather than being silently filtered"
  );
});

test("ERCOT parser extracts facilities directly from XLSX spreadsheet buffer", () => {
  function createSimpleZip(files: Record<string, string>): Buffer {
    const localHeaders: Buffer[] = [];
    const cdHeaders: Buffer[] = [];
    let offset = 0;

    for (const [name, content] of Object.entries(files)) {
      const nameBuf = Buffer.from(name, "utf8");
      const contentBuf = Buffer.from(content, "utf8");
      const deflated = deflateRawSync(contentBuf);

      const lh = Buffer.alloc(30 + nameBuf.length);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(0, 6);
      lh.writeUInt16LE(8, 8);
      lh.writeUInt16LE(0, 10);
      lh.writeUInt16LE(0, 12);
      lh.writeUInt32LE(0, 14);
      lh.writeUInt32LE(deflated.length, 18);
      lh.writeUInt32LE(contentBuf.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(0, 28);
      nameBuf.copy(lh, 30);

      const localEntry = Buffer.concat([lh, deflated]);
      localHeaders.push(localEntry);

      const cd = Buffer.alloc(46 + nameBuf.length);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0, 8);
      cd.writeUInt16LE(8, 10);
      cd.writeUInt16LE(0, 12);
      cd.writeUInt16LE(0, 14);
      cd.writeUInt32LE(0, 16);
      cd.writeUInt32LE(deflated.length, 20);
      cd.writeUInt32LE(contentBuf.length, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt16LE(0, 30);
      cd.writeUInt16LE(0, 32);
      cd.writeUInt16LE(0, 34);
      cd.writeUInt16LE(0, 36);
      cd.writeUInt32LE(0, 38);
      cd.writeUInt32LE(offset, 42);
      nameBuf.copy(cd, 46);

      cdHeaders.push(cd);
      offset += localEntry.length;
    }

    const allLocal = Buffer.concat(localHeaders);
    const allCd = Buffer.concat(cdHeaders);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Object.keys(files).length, 8);
    eocd.writeUInt16LE(Object.keys(files).length, 10);
    eocd.writeUInt32LE(allCd.length, 12);
    eocd.writeUInt32LE(allLocal.length, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([allLocal, allCd, eocd]);
  }

  const sstXml = `<sst count="8" uniqueCount="8">
    <si><t>INR</t></si>
    <si><t>Project Name</t></si>
    <si><t>Fuel</t></si>
    <si><t>MW</t></si>
    <si><t>County</t></si>
    <si><t>24INR0412</t></si>
    <si><t>Lone Star Energy Storage 1</t></si>
    <si><t>BAT</t></si>
    <si><t>Travis</t></si>
  </sst>`;

  const sheetXml = `<sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="s"><v>2</v></c>
      <c r="D1" t="s"><v>3</v></c>
      <c r="E1" t="s"><v>4</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>5</v></c>
      <c r="B2" t="s"><v>6</v></c>
      <c r="C2" t="s"><v>7</v></c>
      <c r="D2"><v>400.0</v></c>
      <c r="E2" t="s"><v>8</v></c>
    </row>
  </sheetData>`;

  const xlsxBuffer = createSimpleZip({
    "xl/sharedStrings.xml": sstXml,
    "xl/worksheets/sheet1.xml": sheetXml,
  });

  const observations = parseErcotCsv(xlsxBuffer);
  assert.ok(observations.length >= 3);

  const mwObs = observations.find((o) => o.property === "power_capacity_mw");
  assert.ok(mwObs);
  assert.equal((mwObs.valueJson as any).mw, 400);

  const locObs = observations.find((o) => o.subjectType === "location");
  assert.ok(locObs);
  assert.equal((locObs.valueJson as any).county, "Travis");
});

test("Austin pure parser returns empty observations on empty array and rejects invalid records", () => {
  const emptyObs = parseAustinPermitsJson("[]");
  assert.equal(emptyObs.length, 0, "Austin parser should return empty observations array on empty dataset");

  assert.throws(
    () => {
      parseAustinPermitsJson(JSON.stringify([{ invalid_field: "no_data" }]));
    },
    /Required|validation/i,
    "Austin parser must reject payloads that fail invariant validation"
  );
});

test("TDLR pure parser utilizes dynamic selectors from manifest when provided", () => {
  const html = `<html><body><span class="custom-proj-id">TABS99991234</span><span class="custom-proj-name">Repaired Facility</span><span id="ctl00_ContentPlaceHolder1_lblEstimatedCost">$500,000</span><span id="ctl00_ContentPlaceHolder1_lblCity">Austin</span><span id="ctl00_ContentPlaceHolder1_lblCounty">Travis</span></body></html>`;

  // Without manifest, default selector does not match the custom class
  assert.throws(() => {
    parseTdlrHtml(html);
  });

  // With manifest providing the patched selector
  const observations = parseTdlrHtml(html, {
    selector: ".custom-proj-id",
    projectNameSelector: ".custom-proj-name",
  });

  assert.ok(observations.length >= 2);
  const projObs = observations.find((o) => o.subjectId === "TABS99991234");
  assert.ok(projObs);
});

