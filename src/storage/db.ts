import { DatabaseSync } from "node:sqlite";
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

export class ScraperRepository {
  constructor(private readonly db: DatabaseSync) {}

  public findSourceArtifactByHash(sha256Hash: string): SourceArtifact | null {
    const stmt = this.db.prepare(
      "SELECT * FROM source_artifacts WHERE sha256_hash = ?"
    );
    const row = stmt.get(sha256Hash) as any;
    if (!row) return null;
    return {
      id: row.id,
      sha256Hash: row.sha256_hash,
      sourceFamily: row.source_family,
      sourceUrl: row.source_url,
      contentType: row.content_type,
      byteSize: Number(row.byte_size),
      storagePath: row.storage_path,
      connectorVersion: row.connector_version,
      capturedAt: row.captured_at,
    };
  }

  public insertSourceArtifact(artifact: NewSourceArtifact): string {
    const existing = this.findSourceArtifactByHash(artifact.sha256Hash);
    if (existing) return existing.id;

    const id = artifact.id ?? crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO source_artifacts (
        id, sha256_hash, source_family, source_url, content_type, byte_size, storage_path, connector_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      artifact.sha256Hash,
      artifact.sourceFamily,
      artifact.sourceUrl,
      artifact.contentType,
      artifact.byteSize,
      artifact.storagePath,
      artifact.connectorVersion
    );
    return id;
  }

  public insertObservations(observations: NewObservation[]): void {
    if (observations.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT INTO observations (
        id, subject_type, subject_id, property, value_json, effective_at, source_artifact_id, connector_version, confidence, resolution_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const obs of observations) {
      const id = obs.id ?? crypto.randomUUID();
      stmt.run(
        id,
        obs.subjectType,
        obs.subjectId,
        obs.property,
        typeof obs.valueJson === "string"
          ? obs.valueJson
          : JSON.stringify(obs.valueJson),
        obs.effectiveAt ?? null,
        obs.sourceArtifactId,
        obs.connectorVersion,
        obs.confidence ?? 1.0,
        obs.resolutionMethod ?? "deterministic"
      );
    }
  }

  public getConnectorConfig(id: string): ConnectorConfig | null {
    const stmt = this.db.prepare("SELECT * FROM connector_configs WHERE id = ?");
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      sourceFamily: row.source_family,
      enabled: Boolean(row.enabled),
      manifest: JSON.parse(row.manifest),
      invariants: JSON.parse(row.invariants),
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      updatedAt: row.updated_at,
    };
  }

  public updateConnectorStatus(
    id: string,
    status: "ok" | "anomaly" | "repairing" | "error"
  ): void {
    const stmt = this.db.prepare(`
      UPDATE connector_configs
      SET last_status = ?, last_run_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(status, id);
  }

  public insertRepairAudit(audit: NewRepairAudit): string {
    const id = audit.id ?? crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO repair_audits (
        id, connector_id, failure_reason, proposed_patch, replay_results, status
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      audit.connectorId,
      audit.failureReason,
      typeof audit.proposedPatch === "string"
        ? audit.proposedPatch
        : JSON.stringify(audit.proposedPatch),
      typeof audit.replayResults === "string"
        ? audit.replayResults
        : JSON.stringify(audit.replayResults),
      audit.status
    );
    return id;
  }
}
