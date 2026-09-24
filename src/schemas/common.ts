import { z } from "zod";

export const SourceFamilySchema = z.enum([
  "tdlr_tabs",
  "ercot_queue",
  "tceq",
  "municipal_agenda",
  "austin_permits",
]);

export type SourceFamily = z.infer<typeof SourceFamilySchema>;

export const SubjectTypeSchema = z.enum([
  "project",
  "facility",
  "organization",
  "location",
]);

export type SubjectType = z.infer<typeof SubjectTypeSchema>;

export interface ObservationCandidate {
  subjectType: SubjectType;
  subjectId: string;
  property: string;
  valueJson: unknown;
  effectiveAt?: string | null;
  confidence?: number;
  resolutionMethod?: "deterministic" | "agent_adjudicated" | "manual";
}

/**
 * Key Texas counties relevant to ERCOT large-load infrastructure and hyperscale data center clusters.
 */
export const TEXAS_COUNTIES = [
  "Bexar",
  "Brazoria",
  "Collin",
  "Dallas",
  "Denton",
  "Ellis",
  "Fort Bend",
  "Harris",
  "Hays",
  "Kaufman",
  "Milam",
  "Navarro",
  "Nueces",
  "Potter",
  "Tarrant",
  "Taylor",
  "Travis",
  "Wharton",
  "Williamson",
] as const;
