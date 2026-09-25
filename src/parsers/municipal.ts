import * as cheerio from "cheerio";
import type { ObservationCandidate } from "../schemas/common.js";
import { validateMunicipalInvariants } from "../schemas/municipal.js";

/**
 * Pure parser for municipal agenda packets and development action HTML/text.
 * Zero browser or database dependencies.
 */
interface RawMunicipalCandidate {
  actionIdentifier: string;
  jurisdiction: string;
  rawActionType?: string;
  title: string;
  status?: string;
  contextText: string;
}

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

function extractFromAgendaItemContainers($: cheerio.CheerioAPI): RawMunicipalCandidate[] {
  return $(".agenda-item")
    .map((_, el) => {
      const container = $(el);
      return {
        actionIdentifier:
          container.find(".action-identifier").text().trim() ||
          container.find("td:contains('Case #:')").next("td").text().trim() ||
          container.text().match(/C\d{2}-\d{4}-\d{4}/)?.[0] ||
          "",
        jurisdiction:
          container.find(".jurisdiction").text().trim() ||
          container.find("td:contains('Jurisdiction:')").next("td").text().trim() ||
          "",
        title:
          container.find(".action-title").text().trim() ||
          container.find("td:contains('Item Title:')").next("td").text().trim() ||
          "",
        status: extractStatus(container),
        rawActionType: container.find(".action-type").text().trim(),
        contextText: container.text(),
      };
    })
    .get();
}

function extractFromIdentifierRows($: cheerio.CheerioAPI): RawMunicipalCandidate[] {
  return $(".action-identifier")
    .map((_, el) => {
      const idEl = $(el);
      const parent = idEl.closest("tr, li, div");
      return {
        actionIdentifier: idEl.text().trim(),
        jurisdiction: parent.find(".jurisdiction").text().trim() || "",
        title: parent.find(".action-title").text().trim() || "",
        status: extractStatus(parent),
        rawActionType: parent.find(".action-type").text().trim(),
        contextText: parent.text(),
      };
    })
    .get();
}

function extractFromDocumentFallback(
  $: cheerio.CheerioAPI,
  html: string
): RawMunicipalCandidate[] {
  const statusEl = $(".action-status");
  const status =
    statusEl.length > 0 && statusEl.text().trim()
      ? statusEl.text().trim().toLowerCase()
      : undefined;

  return [
    {
      actionIdentifier:
        $("td:contains('Case #:')").next("td").text().trim() ||
        html.match(/C\d{2}-\d{4}-\d{4}/)?.[0] ||
        "",
      jurisdiction: $(".jurisdiction").text().trim() || "",
      title:
        $(".action-title").text().trim() ||
        $("td:contains('Item Title:')").next("td").text().trim() ||
        "",
      status,
      rawActionType: $(".action-type").text().trim(),
      contextText: $("body").text(),
    },
  ];
}

function mapCandidateToObservation(
  candidate: RawMunicipalCandidate
): ObservationCandidate {
  const actionType = classifyActionType(
    candidate.rawActionType ?? "",
    candidate.title,
    candidate.contextText
  );

  const validated = validateMunicipalInvariants({
    actionIdentifier: candidate.actionIdentifier,
    jurisdiction: candidate.jurisdiction,
    actionType,
    title: candidate.title,
    status: candidate.status,
  });

  return {
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
  };
}

/**
 * Pure parser for municipal agenda packets and development action HTML/text.
 * Implements strategy pipeline to decouple format detection from domain invariant mapping.
 */
export function parseMunicipalAgenda(html: string): ObservationCandidate[] {
  const $ = cheerio.load(html);

  const strategies = [
    () => extractFromAgendaItemContainers($),
    () => extractFromIdentifierRows($),
    () => extractFromDocumentFallback($, html),
  ];

  for (const strategy of strategies) {
    const rawCandidates = strategy().filter((c) => c.actionIdentifier.length > 0);
    if (rawCandidates.length > 0) {
      return rawCandidates.map(mapCandidateToObservation);
    }
  }

  throw new Error("Municipal agenda payload contains zero valid action items.");
}
