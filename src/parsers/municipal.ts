import * as cheerio from "cheerio";
import type { ObservationCandidate } from "../schemas/common.js";
import { validateMunicipalInvariants } from "../schemas/municipal.js";

/**
 * Pure parser for municipal agenda packets and development action HTML/text.
 * Zero browser or database dependencies.
 */
export function parseMunicipalAgenda(html: string): ObservationCandidate[] {
  const $ = cheerio.load(html);

  const actionIdentifier =
    $(".action-identifier").first().text().trim() ||
    $("td:contains('Case #:')").next("td").text().trim() ||
    html.match(/C\d{2}-\d{4}-\d{4}/)?.[0] ||
    "";

  const jurisdiction =
    $(".jurisdiction").first().text().trim() ||
    "";

  const title =
    $(".action-title").first().text().trim() ||
    $("td:contains('Item Title:')").next("td").text().trim() ||
    "";

  const statusRaw =
    $(".action-status").first().text().trim().toLowerCase() ||
    "under_review";
  const status = ["approved", "denied", "withdrawn", "filed"].includes(statusRaw)
    ? (statusRaw as any)
    : "under_review";

  const validated = validateMunicipalInvariants({
    actionIdentifier,
    jurisdiction,
    actionType: "zoning",
    title,
    status,
  });

  return [
    {
      subjectType: "project",
      subjectId: validated.actionIdentifier,
      property: "municipal_zoning_action",
      valueJson: {
        actionIdentifier: validated.actionIdentifier,
        jurisdiction: validated.jurisdiction,
        actionType: validated.actionType,
        status: validated.status,
        title: validated.title,
      },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
  ];
}
