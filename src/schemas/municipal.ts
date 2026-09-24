import { z } from "zod";

export const MunicipalActionSchema = z.object({
  actionIdentifier: z.string().min(1, "Action identifier cannot be empty"),
  jurisdiction: z.string().min(1, "Jurisdiction cannot be empty"),
  actionType: z.enum([
    "zoning",
    "annexation",
    "site_plan",
    "building_permit",
    "hearing",
  ]),
  title: z.string().min(1, "Title cannot be empty"),
  status: z.enum(["filed", "under_review", "approved", "denied", "withdrawn"]),
  applicant: z.string().optional(),
  filedDate: z.string().optional(),
  decisionDate: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export type MunicipalAction = z.infer<typeof MunicipalActionSchema>;

export function validateMunicipalInvariants(action: unknown): MunicipalAction {
  return MunicipalActionSchema.parse(action);
}
