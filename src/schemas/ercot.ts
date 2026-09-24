import { z } from "zod";

export const ErcotQueueRowSchema = z.object({
  inrNumber: z.string().min(1, "INR number cannot be empty"),
  projectName: z.string().min(1, "Project name cannot be empty"),
  fuelType: z.string().min(1, "Fuel type cannot be empty"),
  capacityMw: z.number().positive("Capacity MW must be greater than zero"),
  county: z.string().min(1, "County cannot be empty"),
  transmissionServiceEntity: z.string().optional(), // Oncor, CenterPoint, LCRA, etc.
  pointOfInterconnection: z.string().optional(),
  projectedInServiceDate: z.string().optional(),
  status: z.string().default("active"),
});

export type ErcotQueueRow = z.infer<typeof ErcotQueueRowSchema>;

export function validateErcotInvariants(row: unknown): ErcotQueueRow {
  return ErcotQueueRowSchema.parse(row);
}
