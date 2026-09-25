import { chromium } from "playwright";
import { buildSocrataUrl, fetchWithBackoff } from "../connectors/austin-permits.js";
import type { ExtractorOptions, RawExtractionResult } from "./types.js";

const CONNECTOR_VERSION = "1.0.0";

/**
 * Headless Playwright extractor for City of Austin building permits (Socrata Open Data).
 * Uses Playwright browser context and exponential backoff on HTTP 429 (ADR-0001).
 */
export async function extractAustinPermits(
  options: ExtractorOptions = {}
): Promise<RawExtractionResult> {
  const targetUrl = options.url ?? buildSocrataUrl();
  const browser = options.browser ?? (await chromium.launch({ headless: true }));
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const timeoutMs = options.timeoutMs ?? 30000;

    const content = await fetchWithBackoff(async () => {
      const response = await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });

      if (!response) {
        throw new Error("No response received from Austin permits endpoint");
      }

      const status = response.status();
      if (status === 429) {
        const err: any = new Error("HTTP 429 Rate Limit Exceeded");
        err.status = 429;
        throw err;
      }

      if (status >= 400) {
        throw new Error(`Austin permits endpoint returned HTTP ${status}`);
      }

      return await response.text();
    });

    const byteSize = Buffer.byteLength(content, "utf8");

    return {
      sourceFamily: "austin_permits",
      sourceUrl: targetUrl,
      contentType: "application/json",
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
