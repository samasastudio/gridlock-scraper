import type { ObservationCandidate } from "../schemas/common.js";
import { validateAustinPermitInvariants } from "../schemas/austin.js";

/**
 * Maps a single raw Austin permit record to domain observation candidates.
 * Pure function with zero mutable accumulators for isolated testing and debugging.
 */
function mapRecordToObservations(raw: any): ObservationCandidate[] {
  const permitNumber = raw.permit_number ?? raw.permitNumber;
  const status = raw.permit_status ?? raw.status;
  const rawValuation = raw.total_valuation ?? raw.valuation ?? raw.valuationUsd;
  const valuationUsd =
    rawValuation !== undefined && rawValuation !== null && rawValuation !== ""
      ? Number(rawValuation)
      : undefined;
  const applicantName = raw.applicant_full_name ?? raw.applicantName ?? raw.applicant;
  const parcelId = raw.parcel_id ?? raw.parcelId;
  const projectName = raw.project_name ?? raw.projectName;

  const validated = validateAustinPermitInvariants({
    permitNumber,
    status,
    valuationUsd,
    applicantName,
    parcelId,
    projectName,
    appliedDate: raw.applied_date,
    issueDate: raw.issue_date,
    workClass: raw.work_class,
    permitTypeDesc: raw.permit_type_desc,
  });

  const subjectId = validated.permitNumber;

  const items: ObservationCandidate[] = [
    {
      subjectType: "project",
      subjectId,
      property: "permit_status",
      valueJson: { status: validated.status },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
    {
      subjectType: "project",
      subjectId,
      property: "valuation",
      valueJson: { usd: validated.valuationUsd },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    },
  ];

  if (validated.parcelId) {
    items.push({
      subjectType: "project",
      subjectId,
      property: "gis_parcel_id",
      valueJson: { parcelId: validated.parcelId },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    });
  }

  if (validated.applicantName) {
    items.push({
      subjectType: "project",
      subjectId,
      property: "applicant_name",
      valueJson: { name: validated.applicantName },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    });
  }

  return items;
}

/**
 * Pure parser for Austin Open Data (Socrata) building permits JSON.
 * Zero browser or database dependencies.
 */
export function parseAustinPermitsJson(jsonContent: string): ObservationCandidate[] {
  let records: any[];
  try {
    records = JSON.parse(jsonContent);
  } catch (err: any) {
    throw new Error(`Failed to parse Austin permits JSON: ${err.message}`);
  }

  if (!Array.isArray(records)) {
    throw new Error("Austin permits JSON payload must be an array of records.");
  }

  return records.flatMap(mapRecordToObservations);
}
