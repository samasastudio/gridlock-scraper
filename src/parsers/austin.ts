import type { ObservationCandidate } from "../schemas/common.js";
import { validateAustinPermitInvariants } from "../schemas/austin.js";

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

  const observations: ObservationCandidate[] = [];

  for (const raw of records) {
    const permitNumber = raw.permit_number ?? raw.permitNumber ?? "";
    const status = raw.permit_status ?? raw.status ?? "";
    const valuationUsd = Number(raw.total_valuation ?? raw.valuation ?? raw.valuationUsd ?? 0);
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

    // 1. Status observation
    observations.push({
      subjectType: "project",
      subjectId,
      property: "permit_status",
      valueJson: { status: validated.status },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    });

    // 2. Valuation observation
    observations.push({
      subjectType: "project",
      subjectId,
      property: "valuation",
      valueJson: { usd: validated.valuationUsd },
      confidence: 1.0,
      resolutionMethod: "deterministic",
    });

    // 3. GIS Parcel ID observation
    if (validated.parcelId) {
      observations.push({
        subjectType: "project",
        subjectId,
        property: "gis_parcel_id",
        valueJson: { parcelId: validated.parcelId },
        confidence: 1.0,
        resolutionMethod: "deterministic",
      });
    }

    // 4. Applicant observation
    if (validated.applicantName) {
      observations.push({
        subjectType: "project",
        subjectId,
        property: "applicant_name",
        valueJson: { name: validated.applicantName },
        confidence: 1.0,
        resolutionMethod: "deterministic",
      });
    }
  }

  return observations;
}
