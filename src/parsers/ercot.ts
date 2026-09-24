import type { ObservationCandidate } from "../schemas/common.js";
import { validateErcotInvariants } from "../schemas/ercot.js";

/**
 * Parses a single CSV line according to RFC 4180 rules, handling quotes and escaped quotes.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Pure parser for ERCOT Generation Interconnection Queue CSV payloads.
 * Zero browser or database dependencies.
 */
export function parseErcotCsv(csvContent: string): ObservationCandidate[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("ERCOT CSV is empty or missing data rows.");
  }

  const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const inrIdx = headers.findIndex((h) => h.includes("inr") || h.includes("project id"));
  const nameIdx = headers.findIndex((h) => h.includes("name") || h.includes("project name"));
  const fuelIdx = headers.findIndex((h) => h.includes("fuel") || h.includes("type"));
  const mwIdx = headers.findIndex((h) => h.includes("mw") || h.includes("capacity"));
  const countyIdx = headers.findIndex((h) => h.includes("county"));

  if (inrIdx === -1 || nameIdx === -1 || fuelIdx === -1 || mwIdx === -1 || countyIdx === -1) {
    throw new Error(
      `ERCOT CSV header missing required columns. Required: INR, Name, Fuel, MW, County. Found: ${headers.join(", ")}`
    );
  }

  const observations: ObservationCandidate[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const inrNumber = inrIdx >= 0 && cols[inrIdx] ? cols[inrIdx]! : "";
    const projectName = nameIdx >= 0 && cols[nameIdx] ? cols[nameIdx]! : "";
    const fuelType = fuelIdx >= 0 && cols[fuelIdx] ? cols[fuelIdx]! : "";
    const capacityRaw = mwIdx >= 0 && cols[mwIdx] ? cols[mwIdx]! : "";
    const capacityMw = parseFloat(capacityRaw);
    const county = countyIdx >= 0 && cols[countyIdx] ? cols[countyIdx]! : "";

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

  if (observations.length === 0) {
    throw new Error("ERCOT CSV contains zero valid data rows (empty queue payload).");
  }

  return observations;
}
