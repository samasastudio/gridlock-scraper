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

  function classifyActionType(rawType: string, title: string, fullText: string): string | undefined {
    const trimmed = rawType.trim().toLowerCase();
    if (trimmed) {
      return trimmed;
    }
    const combined = `${title} ${fullText}`.toLowerCase();
    if (/annex/i.test(combined)) return "annexation";
    if (/site[ -]?plan/i.test(combined)) return "site_plan";
    if (/building[ -]?permit/i.test(combined)) return "building_permit";
    if (/variance/i.test(combined)) return "variance";
    if (/zoning|rezon/i.test(combined)) return "zoning";
    if (/public hearing|hearing/i.test(combined)) return "hearing";
    return undefined;
  }

  function extractStatus(container: cheerio.Cheerio<any>): string | undefined {
    const statusEl = container.find(".action-status");
    if (statusEl.length === 0) return undefined;
    const text = statusEl.text().trim();
    if (!text) return undefined;
    return text.toLowerCase();
  }

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

      const status = extractStatus(container);

      const rawActionType = container.find(".action-type").text().trim();
      const actionType = classifyActionType(rawActionType, title, container.text());

      const validated = validateMunicipalInvariants({
        actionIdentifier,
        jurisdiction,
        actionType,
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
        const status = extractStatus(parent);

        const rawActionType = parent.find(".action-type").text().trim();
        const actionType = classifyActionType(rawActionType, title, parent.text());

        const validated = validateMunicipalInvariants({
          actionIdentifier,
          jurisdiction,
          actionType,
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
      const statusEl = $(".action-status");
      const status = statusEl.length > 0 && statusEl.text().trim()
        ? statusEl.text().trim().toLowerCase()
        : undefined;

      const rawActionType = $(".action-type").text().trim();
      const actionType = classifyActionType(rawActionType, title, $("body").text());

      const validated = validateMunicipalInvariants({
        actionIdentifier,
        jurisdiction,
        actionType,
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
