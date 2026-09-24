import type { ObservationCandidate } from "../schemas/common.js";
import { validateErcotInvariants } from "../schemas/ercot.js";

/**
 * Pure parser for ERCOT Generation Interconnection Queue CSV payloads.
 * Zero browser or database dependencies.
 */
export function parseErcotCsv(csvContent: string): ObservationCandidate[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const headers = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const inrIdx = headers.findIndex((h) => h.includes("inr") || h.includes("project id"));
  const nameIdx = headers.findIndex((h) => h.includes("name") || h.includes("project name"));
  const fuelIdx = headers.findIndex((h) => h.includes("fuel") || h.includes("type"));
  const mwIdx = headers.findIndex((h) => h.includes("mw") || h.includes("capacity"));
  const countyIdx = headers.findIndex((h) => h.includes("county"));

  const observations: ObservationCandidate[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const inrNumber = inrIdx >= 0 && cols[inrIdx] ? cols[inrIdx]! : `INR-${i}`;
    const projectName = nameIdx >= 0 && cols[nameIdx] ? cols[nameIdx]! : `Project ${inrNumber}`;
    const fuelType = fuelIdx >= 0 && cols[fuelIdx] ? cols[fuelIdx]! : "BAT";
    const capacityRaw = mwIdx >= 0 && cols[mwIdx] ? cols[mwIdx]! : "100";
    const capacityMw = parseFloat(capacityRaw) || 100;
    const county = countyIdx >= 0 && cols[countyIdx] ? cols[countyIdx]! : "Travis";

    const validated = validateErcotInvariants({
      inrNumber,
      projectName,
      fuelType,
      capacityMw,
      county,
    });

    observations.push(
      {
        subjectType: "facility",
        subjectId: validated.inrNumber,
        property: "power_capacity_mw",
        valueJson: { mw: validated.capacityMw },
        confidence: 1.0,
        resolutionMethod: "deterministic",
      },
      {
        subjectType: "facility",
        subjectId: validated.inrNumber,
        property: "fuel_type",
        valueJson: { fuelType: validated.fuelType },
        confidence: 1.0,
        resolutionMethod: "deterministic",
      },
      {
        subjectType: "location",
        subjectId: `${validated.county}_county`.toLowerCase(),
        property: "county",
        valueJson: { county: validated.county, state: "TX" },
        confidence: 1.0,
        resolutionMethod: "deterministic",
      }
    );
  }

  return observations;
}
