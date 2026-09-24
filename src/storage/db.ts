import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "../schema.js";
import type {
  ConnectorConfig,
  NewObservation,
  NewRepairAudit,
  NewSourceArtifact,
  Observation,
  SourceArtifact,
} from "../schema.js";

export const DDL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS source_artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    sha256_hash TEXT NOT NULL UNIQUE,
    source_family TEXT NOT NULL,
    source_url TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    connector_version TEXT NOT NULL,
    captured_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    organization_type TEXT NOT NULL,
    headquarters TEXT,
    website TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY NOT NULL,
    address TEXT,
    city TEXT NOT NULL,
    county TEXT NOT NULL,
    state TEXT DEFAULT 'TX' NOT NULL,
    postal_code TEXT,
    latitude REAL,
    longitude REAL,
    parcel_id TEXT,
    jurisdiction TEXT,
    watershed TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    operator TEXT,
    stage TEXT DEFAULT 'proposed' NOT NULL,
    acreage REAL,
    estimated_cost_usd REAL,
    power_demand_mw REAL,
    location_id TEXT REFERENCES locations(id),
    organization_id TEXT REFERENCES organizations(id),
    description TEXT,
    last_projected_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS facilities (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    facility_type TEXT NOT NULL,
    status TEXT NOT NULL,
    gross_square_feet REAL,
    power_capacity_mw REAL,
    address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS development_actions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    action_type TEXT NOT NULL,
    action_identifier TEXT,
    jurisdiction TEXT NOT NULL,
    status TEXT NOT NULL,
    filed_date TEXT,
    decision_date TEXT,
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS environmental_actions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    agency TEXT DEFAULT 'TCEQ' NOT NULL,
    action_type TEXT NOT NULL,
    permit_number TEXT,
    status TEXT NOT NULL,
    effective_date TEXT,
    expiration_date TEXT,
    emissions_summary TEXT,
    water_usage_summary TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS infrastructure_relationships (
    id TEXT PRIMARY KEY NOT NULL,
    source_entity_id TEXT NOT NULL,
    source_entity_type TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    target_entity_type TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    capacity TEXT,
    status TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    property TEXT NOT NULL,
    value_json TEXT NOT NULL,
    observed_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    effective_at TEXT,
    source_artifact_id TEXT NOT NULL REFERENCES source_artifacts(id),
    connector_version TEXT NOT NULL,
    confidence REAL DEFAULT 1.0 NOT NULL,
    resolution_method TEXT DEFAULT 'deterministic' NOT NULL
  );

  CREATE TABLE IF NOT EXISTS connector_configs (
    id TEXT PRIMARY KEY NOT NULL,
    source_family TEXT NOT NULL,
    enabled INTEGER DEFAULT 1 NOT NULL,
    manifest TEXT NOT NULL,
    invariants TEXT NOT NULL,
    last_run_at TEXT,
    last_status TEXT DEFAULT 'idle' NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repair_audits (
    id TEXT PRIMARY KEY NOT NULL,
    connector_id TEXT NOT NULL REFERENCES connector_configs(id),
    failure_reason TEXT NOT NULL,
    proposed_patch TEXT NOT NULL,
    replay_results TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
`;

export function createDatabase(location: string = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(DDL_SCHEMA);
  return db;
}

export type ScraperDrizzleDatabase = SqliteRemoteDatabase<typeof schema>;

export function createDrizzleDatabase(
  rawDb: DatabaseSync = createDatabase()
): ScraperDrizzleDatabase {
  return drizzle(
    async (sqlQuery, params, method) => {
      const stmt = rawDb.prepare(sqlQuery);
      const normalizedParams = params.map((p) => {
        if (p === undefined || p === null) return null;
        if (typeof p === "boolean") return p ? 1 : 0;
        return p as any;
      });
      if (method === "all") {
        const rows = stmt.all(...(normalizedParams as any[]));
        return { rows: rows.map((r: any) => Object.values(r)) };
      } else if (method === "get") {
        const row = stmt.get(...(normalizedParams as any[]));
        return { rows: (row ? Object.values(row) : undefined) as any };
      } else {
        stmt.run(...(normalizedParams as any[]));
        return { rows: [] };
      }
    },
    { schema }
  );
}

export class ScraperRepository {
  public readonly rawDb?: DatabaseSync;
  public readonly drizzle: ScraperDrizzleDatabase;

  constructor(db: DatabaseSync | ScraperDrizzleDatabase) {
    if (db instanceof DatabaseSync) {
      this.rawDb = db;
      this.drizzle = createDrizzleDatabase(db);
    } else {
      this.drizzle = db;
    }
  }

  public async findSourceArtifactByHash(
    sha256Hash: string
  ): Promise<SourceArtifact | null> {
    const artifact = await this.drizzle
      .select()
      .from(schema.sourceArtifacts)
      .where(eq(schema.sourceArtifacts.sha256Hash, sha256Hash))
      .get();
    return artifact ?? null;
  }

  public async insertSourceArtifact(
    artifact: NewSourceArtifact
  ): Promise<string> {
    const existing = await this.findSourceArtifactByHash(artifact.sha256Hash);
    if (existing) return existing.id;

    const id = artifact.id ?? crypto.randomUUID();
    await this.drizzle.insert(schema.sourceArtifacts).values({
      ...artifact,
      id,
    });
    return id;
  }

  public async insertObservations(
    observations: NewObservation[]
  ): Promise<void> {
    if (observations.length === 0) return;
    const values = observations.map((obs) => ({
      ...obs,
      id: obs.id ?? crypto.randomUUID(),
      confidence: obs.confidence ?? 1.0,
      resolutionMethod: obs.resolutionMethod ?? "deterministic",
    }));
    await this.drizzle.insert(schema.observations).values(values);
  }

  public async commitNewArtifactWithObservations(params: {
    artifact: NewSourceArtifact;
    observations: (sourceArtifactId: string) => NewObservation[];
    connectorId?: string;
  }): Promise<{ artifactId: string; observationsCount: number }> {
    return await this.drizzle.transaction(async (tx) => {
      const artifactId = params.artifact.id ?? crypto.randomUUID();
      await tx.insert(schema.sourceArtifacts).values({
        ...params.artifact,
        id: artifactId,
      });

      const obsList = params.observations(artifactId);
      if (obsList.length > 0) {
        const values = obsList.map((obs) => ({
          ...obs,
          id: obs.id ?? crypto.randomUUID(),
          confidence: obs.confidence ?? 1.0,
          resolutionMethod: obs.resolutionMethod ?? "deterministic",
        }));
        await tx.insert(schema.observations).values(values);
      }

      if (params.connectorId) {
        await tx
          .update(schema.connectorConfigs)
          .set({
            lastStatus: "ok",
            lastRunAt: sql`CURRENT_TIMESTAMP`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.connectorConfigs.id, params.connectorId));
      }

      return { artifactId, observationsCount: obsList.length };
    });
  }

  public async commitReprocessedQuarantine(params: {
    artifactId: string;
    connectorVersion: string;
    observations: NewObservation[];
    connectorId: string;
  }): Promise<void> {
    await this.drizzle.transaction(async (tx) => {
      await tx
        .update(schema.sourceArtifacts)
        .set({
          connectorVersion: params.connectorVersion,
        })
        .where(eq(schema.sourceArtifacts.id, params.artifactId));

      if (params.observations.length > 0) {
        const values = params.observations.map((obs) => ({
          ...obs,
          id: obs.id ?? crypto.randomUUID(),
          confidence: obs.confidence ?? 1.0,
          resolutionMethod: obs.resolutionMethod ?? "deterministic",
        }));
        await tx.insert(schema.observations).values(values);
      }

      await tx
        .update(schema.connectorConfigs)
        .set({
          lastStatus: "ok",
          lastRunAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.connectorConfigs.id, params.connectorId));
    });
  }

  public async getConnectorConfig(id: string): Promise<ConnectorConfig | null> {
    const config = await this.drizzle
      .select()
      .from(schema.connectorConfigs)
      .where(eq(schema.connectorConfigs.id, id))
      .get();
    return config ?? null;
  }

  public async updateConnectorStatus(
    id: string,
    status: "ok" | "anomaly" | "repairing" | "error"
  ): Promise<void> {
    await this.drizzle
      .update(schema.connectorConfigs)
      .set({
        lastStatus: status,
        lastRunAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.connectorConfigs.id, id));
  }

  public async insertRepairAudit(audit: NewRepairAudit): Promise<string> {
    const id = audit.id ?? crypto.randomUUID();
    await this.drizzle.insert(schema.repairAudits).values({
      ...audit,
      id,
    });
    return id;
  }
}
