import * as cheerio from "cheerio";
import type { ObservationCandidate } from "../schemas/common.js";
import { validateTdlrInvariants } from "../schemas/tdlr.js";

/**
 * Pure parser for TDLR TABS HTML detail pages.
 * Zero browser or database dependencies.
 */
export function parseTdlrHtml(html: string): ObservationCandidate[] {
  const $ = cheerio.load(html);

  // Extract from typical ASP.NET WebForms table / label ids or semantic table cells
  const projectNumber =
    $("#ctl00_ContentPlaceHolder1_lblProjectNumber").text().trim() ||
    $("td:contains('Project Number:')").next("td").text().trim() ||
    html.match(/TABS\d{8,12}/)?.[0] ||
    "";

  const projectName =
    $("#ctl00_ContentPlaceHolder1_lblProjectName").text().trim() ||
    $("td:contains('Project Name:')").next("td").text().trim() ||
    "";

  const costRaw =
    $("#ctl00_ContentPlaceHolder1_lblEstimatedCost").text().trim() ||
    $("td:contains('Estimated Cost:')").next("td").text().trim();
  const costClean = costRaw ? costRaw.replace(/[^0-9.]/g, "") : "";
  const estimatedCostUsd =
    costClean.length > 0 ? parseFloat(costClean) : (undefined as any);

  const sqftRaw =
    $("#ctl00_ContentPlaceHolder1_lblSquareFootage").text().trim() ||
    $("td:contains('Square Footage:')").next("td").text().trim();
  const sqftClean = sqftRaw ? sqftRaw.replace(/[^0-9.]/g, "") : "";
  const squareFootage =
    sqftClean.length > 0 ? parseFloat(sqftClean) : undefined;

  const address =
    $("#ctl00_ContentPlaceHolder1_lblAddress").text().trim() ||
    $("td:contains('Address:')").next("td").text().trim() ||
    undefined;

  const city =
    $("#ctl00_ContentPlaceHolder1_lblCity").text().trim() ||
    $("td:contains('City:')").next("td").text().trim() ||
    "";

  const county =
    $("#ctl00_ContentPlaceHolder1_lblCounty").text().trim() ||
    $("td:contains('County:')").next("td").text().trim() ||
    "";

  const owner =
    $("#ctl00_ContentPlaceHolder1_lblOwner").text().trim() ||
    $("#ctl00_ContentPlaceHolder1_lblOwnerName").text().trim() ||
    $("td:contains('Owner:')").next("td").text().trim() ||
    $("td:contains('Owner Name:')").next("td").text().trim() ||
    undefined;

  const designFirm =
    $("#ctl00_ContentPlaceHolder1_lblDesignFirm").text().trim() ||
    $("#ctl00_ContentPlaceHolder1_lblArchitect").text().trim() ||
    $("td:contains('Design Firm:')").next("td").text().trim() ||
    $("td:contains('Architect:')").next("td").text().trim() ||
    undefined;

  const rawProject = {
    projectNumber,
    projectName,
    projectType: "commercial",
    estimatedCostUsd,
    squareFootage,
    address,
    city,
    county,
    state: "TX",
    owner,
    designFirm,
  };

  // Enforce Zod invariants
  const validated = validateTdlrInvariants(rawProject);

  const observations: ObservationCandidate[] = [
    {
      subjectType: "project",
      subjectId: validated.projectNumber,
      property: "estimated_cost",
      valueJson: { usd: validated.estimatedCostUsd },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
    {
      subjectType: "project",
      subjectId: validated.projectNumber,
      property: "name",
      valueJson: { name: validated.projectName },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
    {
      subjectType: "location",
      subjectId: `${validated.city}_${validated.county}`.toLowerCase().replace(/\s+/g, "_"),
      property: "address_details",
      valueJson: {
        address: validated.address,
        city: validated.city,
        county: validated.county,
        state: "TX",
      },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
  ];

  if (validated.squareFootage !== undefined) {
    observations.push({
      subjectType: "project",
      subjectId: validated.projectNumber,
      property: "square_footage",
      valueJson: { sqft: validated.squareFootage },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    });
  }

  if (validated.owner) {
    observations.push({
      subjectType: "project",
      subjectId: validated.projectNumber,
      property: "owner",
      valueJson: { owner: validated.owner },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    });
  }

  if (validated.designFirm) {
    observations.push({
      subjectType: "project",
      subjectId: validated.projectNumber,
      property: "architect",
      valueJson: { architect: validated.designFirm },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    });
  }

  return observations;
}
