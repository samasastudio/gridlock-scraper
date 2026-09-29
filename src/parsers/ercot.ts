import type { ObservationCandidate } from "../schemas/common.js";
import { validateErcotInvariants } from "../schemas/ercot.js";
import { convertXlsxToCsv, isOlePayload, isZipPayload } from "./xlsx.js";

/**
 * Parses a single CSV line according to RFC 4180 rules, handling quotes and escaped quotes.
 * NOTE (Architecture Rationale): A stateful character loop is intentionally used here
 * instead of regular expressions to guarantee O(N) single-pass tokenization and prevent
 * exponential backtracking vulnerabilities on arbitrary external CSV payloads.
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

interface ErcotColumnIndices {
  inrIdx: number;
  nameIdx: number;
  fuelIdx: number;
  mwIdx: number;
  countyIdx: number;
}

/**
 * Maps a single CSV row to domain observation candidates.
 * Pure transformation isolating invariant checks and field extraction for unit debugging.
 */
function mapCsvLineToObservations(
  line: string,
  indices: ErcotColumnIndices
): ObservationCandidate[] {
  const cols = parseCsvLine(line);
  const inrNumber = indices.inrIdx >= 0 && cols[indices.inrIdx] ? cols[indices.inrIdx]! : "";
  const projectName = indices.nameIdx >= 0 && cols[indices.nameIdx] ? cols[indices.nameIdx]! : "";
  const fuelType = indices.fuelIdx >= 0 && cols[indices.fuelIdx] ? cols[indices.fuelIdx]! : "";
  const capacityRaw = indices.mwIdx >= 0 && cols[indices.mwIdx] ? cols[indices.mwIdx]! : "";
  const capacityMw = parseFloat(capacityRaw);
  const county = indices.countyIdx >= 0 && cols[indices.countyIdx] ? cols[indices.countyIdx]! : "";

  const validated = validateErcotInvariants({
    inrNumber,
    projectName,
    fuelType,
    capacityMw,
    county,
  });

  return [
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
    },
  ];
}

/**
 * Pure parser for ERCOT Generation Interconnection Queue spreadsheet (.xlsx) payloads.
 */
export function parseErcotSpreadsheet(payload: Buffer | string): ObservationCandidate[] {
  if (isOlePayload(payload)) {
    throw new Error(
      "Binary OLE (.xls) format is not supported. Provide an OpenXML (.xlsx) bitstream."
    );
  }
  const csvContent = convertXlsxToCsv(payload);
  return parseErcotCsv(csvContent);
}

/**
 * Pure parser for ERCOT Generation Interconnection Queue CSV or XLSX payloads.
 * Zero browser or database dependencies.
 */
export function parseErcotCsv(input: string | Buffer): ObservationCandidate[] {
  if (isZipPayload(input)) {
    return parseErcotSpreadsheet(input);
  }

  if (isOlePayload(input)) {
    throw new Error(
      "Binary OLE (.xls) format is not supported for UTF-8 CSV parsing. Provide an OpenXML (.xlsx) or RFC 4180 CSV bitstream."
    );
  }

  const csvContent = Buffer.isBuffer(input) ? input.toString("utf8") : input;

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

  const indices: ErcotColumnIndices = { inrIdx, nameIdx, fuelIdx, mwIdx, countyIdx };
  const observations = lines.slice(1).flatMap((line) => mapCsvLineToObservations(line, indices));

  if (observations.length === 0) {
    throw new Error("ERCOT CSV contains zero valid data rows (empty queue payload).");
  }

  return observations;
}
