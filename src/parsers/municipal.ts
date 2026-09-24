import * as cheerio from "cheerio";
import type { ObservationCandidate } from "../schemas/common.js";
import { validateMunicipalInvariants } from "../schemas/municipal.js";

/**
 * Pure parser for municipal agenda packets and development action HTML/text.
 * Zero browser or database dependencies.
 */
export function parseMunicipalAgenda(html: string): ObservationCandidate[] {
  const $ = cheerio.load(html);
  const observations: ObservationCandidate[] = [];

  const itemContainers = $(".agenda-item");

  if (itemContainers.length > 0) {
    itemContainers.each((_, el) => {
      const container = $(el);
      const actionIdentifier =
        container.find(".action-identifier").text().trim() ||
        container.find("td:contains('Case #:')").next("td").text().trim() ||
        container.text().match(/C\d{2}-\d{4}-\d{4}/)?.[0] ||
        "";

      const jurisdiction =
        container.find(".jurisdiction").text().trim() ||
        container.find("td:contains('Jurisdiction:')").next("td").text().trim() ||
        "";

      const title =
        container.find(".action-title").text().trim() ||
        container.find("td:contains('Item Title:')").next("td").text().trim() ||
        "";

      const statusRaw =
        container.find(".action-status").text().trim().toLowerCase() ||
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

      observations.push({
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
      });
    });
  } else {
    // Fallback: look for individual action-identifier elements or table rows
    const actionIdEls = $(".action-identifier");
    if (actionIdEls.length > 0) {
      actionIdEls.each((_, el) => {
        const idEl = $(el);
        const parent = idEl.closest("tr, li, div");
        const actionIdentifier = idEl.text().trim();
        const jurisdiction = parent.find(".jurisdiction").text().trim() || "";
        const title = parent.find(".action-title").text().trim() || "";
        const statusRaw =
          parent.find(".action-status").text().trim().toLowerCase() ||
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

        observations.push({
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
        });
      });
    } else {
      const actionIdentifier =
        $("td:contains('Case #:')").next("td").text().trim() ||
        html.match(/C\d{2}-\d{4}-\d{4}/)?.[0] ||
        "";
      const jurisdiction = $(".jurisdiction").text().trim() || "";
      const title =
        $(".action-title").text().trim() ||
        $("td:contains('Item Title:')").next("td").text().trim() ||
        "";
      const statusRaw =
        $(".action-status").text().trim().toLowerCase() || "under_review";
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

      observations.push({
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
      });
    }
  }

  if (observations.length === 0) {
    throw new Error("Municipal agenda payload contains zero valid action items.");
  }

  return observations;
}
