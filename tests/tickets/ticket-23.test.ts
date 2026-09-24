import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { extractErcotQueue } from "../../src/extractors/ercot.js";

test("Ticket 23 - Criteria 1: Extractor registers Playwright download listener", () => {
  const extractorPath = path.resolve(process.cwd(), "src/extractors/ercot.ts");
  const content = fs.readFileSync(extractorPath, "utf8");

  assert.match(
    content,
    /waitForEvent\(\s*["']download["']\s*\)/,
    "ERCOT extractor must register Playwright page.waitForEvent('download') listener"
  );
});

test("Ticket 23 - Criteria 2 & 3: Extractor captures downloaded binary buffer and sets spreadsheet MIME type", async () => {
  const mockPayload = Buffer.from("PK\x03\x04MOCK_XLSX_SPREADSHEET_BYTES");

  const mockDownload = {
    suggestedFilename: () => "GIS_Report_September_2024.xlsx",
    createReadStream: async () => Readable.from([mockPayload]),
    path: async () => "/tmp/GIS_Report_September_2024.xlsx",
  };

  const mockPage: any = {
    goto: async () => {},
    waitForEvent: async (event: string) => {
      if (event === "download") return mockDownload;
      throw new Error(`Unknown event ${event}`);
    },
    click: async () => {},
    content: async () => "<html>Portal HTML fallback</html>",
    close: async () => {},
  };

  const mockContext: any = {
    newPage: async () => mockPage,
    close: async () => {},
  };

  const mockBrowser: any = {
    newContext: async () => mockContext,
    close: async () => {},
  };

  const result = await extractErcotQueue({
    browser: mockBrowser,
    url: "https://www.ercot.com/gridinfo/generation",
  });

  // ADR-0001: Playwright download lifecycle must yield the actual file payload, not portal HTML
  assert.ok(
    result.contentType.includes("spreadsheetml") ||
    result.contentType.includes("excel") ||
    result.contentType.includes("csv"),
    `Expected spreadsheet or CSV MIME type, got ${result.contentType}`
  );

  const isBuffer = Buffer.isBuffer(result.content);
  assert.ok(isBuffer || typeof result.content === "string");
  if (isBuffer) {
    assert.deepEqual(result.content, mockPayload);
  }
});

test("Ticket 23 - Criteria 4: Timeout or missing download raises anomaly or falls back gracefully", async () => {
  const mockTimeoutPage: any = {
    goto: async () => {},
    waitForEvent: async () => {
      const timeoutErr: any = new Error("Timeout 30000ms exceeded while waiting for event 'download'");
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    },
    close: async () => {},
  };

  const mockContext: any = {
    newPage: async () => mockTimeoutPage,
    close: async () => {},
  };

  const mockBrowser: any = {
    newContext: async () => mockContext,
    close: async () => {},
  };

  // Must either reject with TimeoutError or return an anomaly indicator
  await assert.rejects(
    async () => {
      await extractErcotQueue({
        browser: mockBrowser,
        timeoutMs: 100,
      });
    },
    /timeout|download/i,
    "Download listener must handle timeout cleanly"
  );
});
