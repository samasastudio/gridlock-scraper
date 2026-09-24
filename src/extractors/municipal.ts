import { chromium } from "playwright";
import type { ExtractorOptions, RawExtractionResult } from "./types.js";

const DEFAULT_MUNICIPAL_URL =
  "https://www.austintexas.gov/department/city-council/council-meetings";
const CONNECTOR_VERSION = "1.0.0";

/**
 * Headless Playwright extractor for Texas municipal agendas and planning commission dockets.
 */
export async function extractMunicipalAgendas(
  options: ExtractorOptions = {}
): Promise<RawExtractionResult> {
  const targetUrl = options.url ?? DEFAULT_MUNICIPAL_URL;
  const browser = options.browser ?? (await chromium.launch({ headless: true }));
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs ?? 30000,
    });

    const content = await page.content();
    const byteSize = Buffer.byteLength(content, "utf8");

    return {
      sourceFamily: "municipal_agenda",
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
