import * as cheerio from "cheerio";
import type { ObservationCandidate } from "../schemas/common.js";
import { validateTceqInvariants } from "../schemas/tceq.js";

/**
 * Pure parser for TCEQ environmental authorization records.
 * Zero browser or database dependencies.
 */
export function parseTceqHtml(html: string): ObservationCandidate[] {
  const $ = cheerio.load(html);

  const permitNumber =
    $("#permitNumber").text().trim() ||
    $("td:contains('Permit Number:')").next("td").text().trim() ||
    html.match(/TCEQ-\d{5,9}/)?.[0] ||
    "";

  const applicantName =
    $("#applicantName").text().trim() ||
    $("td:contains('Applicant:')").next("td").text().trim() ||
    "";

  const projectName =
    $("#projectName").text().trim() ||
    $("td:contains('Project:')").next("td").text().trim() ||
    "";

  const county =
    $("#county").text().trim() ||
    $("td:contains('County:')").next("td").text().trim() ||
    "";

  const validated = validateTceqInvariants({
    permitNumber,
    actionType: "air_standard_permit",
    projectName,
    applicantName,
    county,
    status: "issued",
  });

  return [
    {
      subjectType: "project",
      subjectId: validated.permitNumber,
      property: "environmental_permit",
      valueJson: {
        permitNumber: validated.permitNumber,
        actionType: validated.actionType,
        status: validated.status,
      },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
    {
      subjectType: "organization",
      subjectId: validated.applicantName.toLowerCase().replace(/\s+/g, "_"),
      property: "legal_name",
      valueJson: { name: validated.applicantName },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
  ];
}
