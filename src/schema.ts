import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ============================================================================
// 1. Immutable Provenance & Artifacts
// ============================================================================

/**
 * Immutable Source Artifacts: cryptographic hash and capture metadata for
 * every fetched document, HTML page, PDF, or API payload.
 */
export const sourceArtifacts = sqliteTable("source_artifacts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sha256Hash: text("sha256_hash").notNull().unique(),
  sourceFamily: text("source_family").notNull(), // "tdlr_tabs", "austin_permits", "tceq", "municipal_agenda", "ercot_queue"
  sourceUrl: text("source_url").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  storagePath: text("storage_path").notNull(),
  connectorVersion: text("connector_version").notNull(),
  capturedAt: text("captured_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Atomic Observations: immutable append-only assertions about real-world entities.
 * Conflicting records from multiple agencies are preserved as competing observations.
 */
export const observations = sqliteTable("observations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  subjectType: text("subject_type").notNull(), // "project", "facility", "organization", "location"
  subjectId: text("subject_id").notNull(),
  property: text("property").notNull(), // "status", "estimated_cost", "square_footage", "operator", "power_mw"
  valueJson: text("value_json", { mode: "json" }).notNull(),
  observedAt: text("observed_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  effectiveAt: text("effective_at"),
  sourceArtifactId: text("source_artifact_id")
    .references(() => sourceArtifacts.id)
    .notNull(),
  connectorVersion: text("connector_version").notNull(),
  confidence: real("confidence").notNull().default(1.0),
  resolutionMethod: text("resolution_method")
    .notNull()
    .default("deterministic"), // "deterministic", "agent_adjudicated", "manual"
});

// ============================================================================
// 2. Canonical Target Entities (for Entity Resolution)
// ============================================================================

export const organizations = sqliteTable("organizations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  organizationType: text("organization_type").notNull(), // "hyperscaler", "developer", "operator", "utility", "agency"
  headquarters: text("headquarters"),
  website: text("website"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const locations = sqliteTable("locations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  address: text("address"),
  city: text("city").notNull(),
  county: text("county").notNull(),
  state: text("state").notNull().default("TX"),
  postalCode: text("postal_code"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  parcelId: text("parcel_id"),
  jurisdiction: text("jurisdiction"),
  watershed: text("watershed"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  operator: text("operator"),
  stage: text("stage").notNull().default("proposed"), // "proposed", "permitting", "approved", "construction", "operational", "withdrawn"
  acreage: real("acreage"),
  estimatedCostUsd: real("estimated_cost_usd"),
  powerDemandMw: real("power_demand_mw"),
  locationId: text("location_id").references(() => locations.id),
  organizationId: text("organization_id").references(() => organizations.id),
  description: text("description"),
  lastProjectedAt: text("last_projected_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const facilities = sqliteTable("facilities", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .references(() => projects.id)
    .notNull(),
  name: text("name").notNull(),
  facilityType: text("facility_type").notNull(), // "data_center", "substation", "chiller_plant", "fab"
  status: text("status").notNull(),
  grossSquareFeet: real("gross_square_feet"),
  powerCapacityMw: real("power_capacity_mw"),
  address: text("address"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const developmentActions = sqliteTable("development_actions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .references(() => projects.id)
    .notNull(),
  actionType: text("action_type").notNull(), // "zoning", "annexation", "site_plan", "building_permit", "hearing"
  actionIdentifier: text("action_identifier"),
  jurisdiction: text("jurisdiction").notNull(),
  status: text("status").notNull(), // "filed", "under_review", "approved", "denied", "withdrawn"
  filedDate: text("filed_date"),
  decisionDate: text("decision_date"),
  details: text("details", { mode: "json" }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const environmentalActions = sqliteTable("environmental_actions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .references(() => projects.id)
    .notNull(),
  agency: text("agency").notNull().default("TCEQ"),
  actionType: text("action_type").notNull(), // "air_standard_permit", "water_authorization", "stormwater", "waste"
  permitNumber: text("permit_number"),
  status: text("status").notNull(),
  effectiveDate: text("effective_date"),
  expirationDate: text("expiration_date"),
  emissionsSummary: text("emissions_summary", { mode: "json" }),
  waterUsageSummary: text("water_usage_summary", { mode: "json" }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const infrastructureRelationships = sqliteTable(
  "infrastructure_relationships",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sourceEntityId: text("source_entity_id").notNull(),
    sourceEntityType: text("source_entity_type").notNull(), // "project", "facility"
    targetEntityId: text("target_entity_id").notNull(),
    targetEntityType: text("target_entity_type").notNull(), // "substation", "transmission_line", "utility", "water_tie_in"
    relationshipType: text("relationship_type").notNull(), // "interconnect", "grid_feed", "water_service", "substation_feed"
    capacity: text("capacity"),
    status: text("status").notNull(),
    metadata: text("metadata", { mode: "json" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  }
);

// ============================================================================
// 3. Operational Telemetry & Self-Healing Repair
// ============================================================================

export const connectorConfigs = sqliteTable("connector_configs", {
  id: text("id").primaryKey(), // e.g. "tdlr_tabs_v1", "austin_permits_v1"
  sourceFamily: text("source_family").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  manifest: text("manifest", { mode: "json" }).notNull(),
  invariants: text("invariants", { mode: "json" }).notNull(),
  lastRunAt: text("last_run_at"),
  lastStatus: text("last_status").notNull().default("idle"), // "ok", "anomaly", "repairing", "error"
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const repairAudits = sqliteTable("repair_audits", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  connectorId: text("connector_id")
    .references(() => connectorConfigs.id)
    .notNull(),
  failureReason: text("failure_reason").notNull(),
  proposedPatch: text("proposed_patch", { mode: "json" }).notNull(),
  replayResults: text("replay_results", { mode: "json" }).notNull(),
  status: text("status").notNull(), // "promoted", "rejected", "pending_review"
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================================
// Type Inferences
// ============================================================================

export type SourceArtifact = typeof sourceArtifacts.$inferSelect;
export type NewSourceArtifact = typeof sourceArtifacts.$inferInsert;

export type Observation = typeof observations.$inferSelect;
export type NewObservation = typeof observations.$inferInsert;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Facility = typeof facilities.$inferSelect;
export type NewFacility = typeof facilities.$inferInsert;

export type DevelopmentAction = typeof developmentActions.$inferSelect;
export type NewDevelopmentAction = typeof developmentActions.$inferInsert;

export type EnvironmentalAction = typeof environmentalActions.$inferSelect;
export type NewEnvironmentalAction = typeof environmentalActions.$inferInsert;

export type InfrastructureRelationship =
  typeof infrastructureRelationships.$inferSelect;
export type NewInfrastructureRelationship =
  typeof infrastructureRelationships.$inferInsert;

export type ConnectorConfig = typeof connectorConfigs.$inferSelect;
export type NewConnectorConfig = typeof connectorConfigs.$inferInsert;

export type RepairAudit = typeof repairAudits.$inferSelect;
export type NewRepairAudit = typeof repairAudits.$inferInsert;
