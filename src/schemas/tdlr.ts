import { z } from "zod";

export const TdlrProjectSchema = z.object({
  projectNumber: z.string().regex(/^TABS\d+$/, "Project number must start with TABS followed by digits"),
  projectName: z.string().min(1, "Project name cannot be empty"),
  projectType: z.string().default("commercial"),
  estimatedCostUsd: z.number().nonnegative("Estimated cost must be non-negative"),
  squareFootage: z.number().nonnegative().optional(),
  address: z.string().optional(),
  city: z.string().min(1, "City cannot be empty"),
  county: z.string().min(1, "County cannot be empty"),
  state: z.string().default("TX"),
  zipCode: z.string().optional(),
  scopeOfWork: z.string().optional(),
  designFirm: z.string().optional(),
  owner: z.string().optional(),
  startDate: z.string().optional(),
  completionDate: z.string().optional(),
});

export type TdlrProject = z.infer<typeof TdlrProjectSchema>;

/**
 * Domain Invariant Validator for TDLR TABS extraction.
 */
export function validateTdlrInvariants(project: unknown): TdlrProject {
  return TdlrProjectSchema.parse(project);
}
