import { z } from "zod";

export const TceqPermitSchema = z.object({
  permitNumber: z.string().min(1, "Permit number cannot be empty"),
  actionType: z.enum([
    "air_standard_permit",
    "water_authorization",
    "stormwater",
    "waste",
  ]),
  projectName: z.string().min(1, "Project name cannot be empty"),
  applicantName: z.string().min(1, "Applicant name cannot be empty"),
  county: z.string().min(1, "County cannot be empty"),
  status: z.string().min(1, "Status cannot be empty"),
  effectiveDate: z.string().optional(),
  expirationDate: z.string().optional(),
  emissionsSummary: z.record(z.unknown()).optional(),
  waterUsageSummary: z.record(z.unknown()).optional(),
});

export type TceqPermit = z.infer<typeof TceqPermitSchema>;

export function validateTceqInvariants(permit: unknown): TceqPermit {
  return TceqPermitSchema.parse(permit);
}
