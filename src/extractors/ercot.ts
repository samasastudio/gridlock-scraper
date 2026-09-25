import fs from "node:fs";
import { Readable } from "node:stream";
import { chromium } from "playwright";
import type { ExtractorOptions, RawExtractionResult } from "./types.js";

const DEFAULT_ERCOT_URL =
  "https://www.ercot.com/gridinfo/generation";
const CONNECTOR_VERSION = "1.0.0";

/**
 * Headless Playwright extractor for ERCOT Generation Interconnection Queue.
 * Intercepts public queue listings and downloads the actual spreadsheet/CSV payload (ADR-0001).
 */
export async function extractErcotQueue(
  options: ExtractorOptions = {}
): Promise<RawExtractionResult> {
  const targetUrl = options.url ?? DEFAULT_ERCOT_URL;
  const browser = options.browser ?? (await chromium.launch({ headless: true }));
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    const timeoutMs = options.timeoutMs ?? 30000;

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    if (typeof page.setDefaultTimeout === "function") {
      page.setDefaultTimeout(timeoutMs);
    }

    // Register download event listener on page
    const downloadPromise = page.waitForEvent("download");

    // Attempt to click download trigger if locator exists
    if (typeof page.locator === "function") {
      const link = page.locator("a[href*='.xlsx'], a[href*='.csv'], a:has-text('GIS'), a:has-text('Queue')").first();
      const count = await link.count().catch(() => 0);
      if (count > 0) {
        await link.click().catch(() => {});
      } else if (typeof page.click === "function") {
        await page.click("a").catch(() => {});
      }
    } else if (typeof page.click === "function") {
      await page.click("a").catch(() => {});
    }

    const download = await downloadPromise;
    const filename = typeof download.suggestedFilename === "function"
      ? download.suggestedFilename()
      : "ercot_queue.xlsx";

    let buffer: Buffer;
    if (typeof download.createReadStream === "function") {
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
    } else if (typeof download.path === "function") {
      const filePath = await download.path();
      buffer = fs.readFileSync(filePath);
    } else {
      buffer = Buffer.from("");
    }

    let contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (filename.endsWith(".csv")) {
      contentType = "text/csv";
    } else if (filename.endsWith(".xls")) {
      contentType = "application/vnd.ms-excel";
    }

    return {
      sourceFamily: "ercot_queue",
      sourceUrl: targetUrl,
      contentType,
      byteSize: buffer.length,
      content: buffer,
      connectorVersion: CONNECTOR_VERSION,
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    if (!options.browser) {
      await browser.close().catch(() => {});
    }
  }
}
