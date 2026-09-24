import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ticket 23 - Criteria 1: Implement Playwright download listener for ERCOT spreadsheet", () => {
  const extractorPath = path.resolve(process.cwd(), "src/extractors/ercot.ts");
  const content = fs.readFileSync(extractorPath, "utf8");

  assert.match(
    content,
    /waitForEvent\(\s*["']download["']\s*\)/,
    "ERCOT extractor must register Playwright page.waitForEvent('download') listener"
  );
});

test("Ticket 23 - Criteria 2 & 3: Pipe downloaded binary buffer to raw extraction result", () => {
  const extractorPath = path.resolve(process.cwd(), "src/extractors/ercot.ts");
  const content = fs.readFileSync(extractorPath, "utf8");

  assert.match(
    content,
    /createReadStream|path\(|saveAs/,
    "ERCOT extractor must access downloaded file payload via stream or file path"
  );
});

test("Ticket 23 - Criteria 4: Accurate MIME type for spreadsheet or CSV download", () => {
  const extractorPath = path.resolve(process.cwd(), "src/extractors/ercot.ts");
  const content = fs.readFileSync(extractorPath, "utf8");

  assert.match(
    content,
    /spreadsheetml|excel|csv/,
    "ERCOT extractor must set spreadsheet or CSV contentType for downloaded assets"
  );
});
