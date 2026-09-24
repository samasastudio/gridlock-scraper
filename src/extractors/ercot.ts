import { chromium } from "playwright";
import type { ExtractorOptions, RawExtractionResult } from "./types.js";

const DEFAULT_ERCOT_URL =
  "https://www.ercot.com/gridinfo/generation";
const CONNECTOR_VERSION = "1.0.0";

/**
 * Headless Playwright extractor for ERCOT Generation Interconnection Queue.
 * Intercepts public queue listings and downloads.
 */
export async function extractErcotQueue(
  options: ExtractorOptions = {}
): Promise<RawExtractionResult> {
  const targetUrl = options.url ?? DEFAULT_ERCOT_URL;
  const browser = options.browser ?? (await chromium.launch({ headless: true }));
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs ?? 30000,
    });

    // Capture the rendered page or link tables
    const content = await page.content();
    const byteSize = Buffer.byteLength(content, "utf8");

    return {
      sourceFamily: "ercot_queue",
      sourceUrl: targetUrl,
      contentType: "text/html",
      byteSize,
      content,
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
