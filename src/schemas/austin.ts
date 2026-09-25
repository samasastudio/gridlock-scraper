import { z } from "zod";

export const AustinPermitSchema = z.object({
  permitNumber: z.string().min(1, "permitNumber cannot be empty"),
  status: z.string().min(1, "status cannot be empty"),
  valuationUsd: z.number().positive("valuationUsd must be positive"),
  applicantName: z.string().optional(),
  parcelId: z.string().optional(),
  projectName: z.string().optional(),
  appliedDate: z.string().optional(),
  issueDate: z.string().optional(),
  workClass: z.string().optional(),
  permitTypeDesc: z.string().optional(),
});

export type AustinPermit = z.infer<typeof AustinPermitSchema>;

export function validateAustinPermitInvariants(data: unknown): AustinPermit {
  return AustinPermitSchema.parse(data);
}
