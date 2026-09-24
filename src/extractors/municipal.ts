import { chromium } from "playwright";
import type { ExtractorOptions, RawExtractionResult } from "./types.js";

/**
 * Texas municipal portal endpoints for city council and planning commission dockets.
 * Supports statewide infrastructure hubs (e.g. Austin, Taylor, Pflugerville, San Antonio, Dallas).
 */
export const TEXAS_MUNICIPAL_DOCKET_URLS = {
  austin: "https://www.austintexas.gov/department/city-council/council-meetings",
  taylor: "https://www.ci.taylor.tx.us/agendacenter",
  pflugerville: "https://pflugerville.legistar.com/Calendar.aspx",
  san_antonio: "https://www.sanantonio.gov/clerk/legislative/agendas",
  dallas: "https://dallascityhall.com/government/meetings/Pages/city-council-meetings.aspx",
} as const;

const DEFAULT_MUNICIPAL_URL = TEXAS_MUNICIPAL_DOCKET_URLS.austin;
const CONNECTOR_VERSION = "1.0.0";

/**
 * Headless Playwright extractor for Texas municipal agendas and planning commission dockets.
 * Never restricts scope to Austin municipal limits (ADR-0001, Anti-Pattern 5).
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
