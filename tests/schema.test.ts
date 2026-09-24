import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as schema from "../src/schema.js";

test("SQLite initialization and schema verification for gridlock-scraper", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");

  // DDL definitions for SQLite
  db.exec(`
    CREATE TABLE source_artifacts (
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

    CREATE TABLE organizations (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      organization_type TEXT NOT NULL,
      headquarters TEXT,
      website TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE locations (
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

    CREATE TABLE projects (
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

    CREATE TABLE facilities (
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

    CREATE TABLE development_actions (
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

    CREATE TABLE environmental_actions (
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

    CREATE TABLE infrastructure_relationships (
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

    CREATE TABLE observations (
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

    CREATE TABLE connector_configs (
      id TEXT PRIMARY KEY NOT NULL,
      source_family TEXT NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      manifest TEXT NOT NULL,
      invariants TEXT NOT NULL,
      last_run_at TEXT,
      last_status TEXT DEFAULT 'idle' NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE repair_audits (
      id TEXT PRIMARY KEY NOT NULL,
      connector_id TEXT NOT NULL REFERENCES connector_configs(id),
      failure_reason TEXT NOT NULL,
      proposed_patch TEXT NOT NULL,
      replay_results TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((row: any) => row.name);

  assert.ok(tables.includes("source_artifacts"));
  assert.ok(tables.includes("observations"));
  assert.ok(tables.includes("connector_configs"));
  assert.ok(tables.includes("repair_audits"));
  assert.ok(tables.includes("projects"));
  assert.ok(tables.includes("facilities"));
  assert.ok(tables.includes("development_actions"));
  assert.ok(tables.includes("environmental_actions"));
  assert.ok(tables.includes("infrastructure_relationships"));

  // 1. Verify source artifact insertion
  const artifactId = "art-001";
  db.prepare(`
    INSERT INTO source_artifacts (id, sha256_hash, source_family, source_url, content_type, byte_size, storage_path, connector_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    artifactId,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "tdlr_tabs",
    "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2024001",
    "text/html",
    2048,
    "gs://compute-atlas-artifacts/tdlr_tabs/2026/art-001.html.gz",
    "1.0.0"
  );

  // 2. Verify observation insertion linking to source_artifact
  const obsId = "obs-001";
  db.prepare(`
    INSERT INTO observations (id, subject_type, subject_id, property, value_json, source_artifact_id, connector_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    obsId,
    "project",
    "proj-100",
    "estimated_cost",
    JSON.stringify({ usd: 500000000 }),
    artifactId,
    "1.0.0"
  );

  // 3. Verify foreign key enforcement on invalid source_artifact_id
  assert.throws(
    () => {
      db.prepare(`
        INSERT INTO observations (id, subject_type, subject_id, property, value_json, source_artifact_id, connector_version)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "obs-fail",
        "project",
        "proj-100",
        "status",
        JSON.stringify({ status: "active" }),
        "non-existent-artifact-id",
        "1.0.0"
      );
    },
    /FOREIGN KEY constraint failed/
  );

  // 4. Verify connector configs & repair audit relationship
  db.prepare(`
    INSERT INTO connector_configs (id, source_family, manifest, invariants)
    VALUES (?, ?, ?, ?)
  `).run(
    "tdlr_tabs_v1",
    "tdlr_tabs",
    JSON.stringify({ selector: ".project-details" }),
    JSON.stringify({ minRecords: 1 })
  );

  db.prepare(`
    INSERT INTO repair_audits (id, connector_id, failure_reason, proposed_patch, replay_results, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "repair-001",
    "tdlr_tabs_v1",
    "Selector .project-details returned null",
    JSON.stringify({ selector: "#project-summary" }),
    JSON.stringify({ passed: 5, total: 5 }),
    "promoted"
  );

  // 5. Verify foreign key rejection on repair audit
  assert.throws(
    () => {
      db.prepare(`
        INSERT INTO repair_audits (id, connector_id, failure_reason, proposed_patch, replay_results, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        "repair-fail",
        "non_existent_connector",
        "Failure",
        "{}",
        "{}",
        "rejected"
      );
    },
    /FOREIGN KEY constraint failed/
  );

  // 6. Verify Drizzle schema exports exist
  assert.ok(schema.sourceArtifacts);
  assert.ok(schema.observations);
  assert.ok(schema.connectorConfigs);
  assert.ok(schema.repairAudits);
  assert.ok(schema.projects);
  assert.ok(schema.facilities);
  assert.ok(schema.developmentActions);
  assert.ok(schema.environmentalActions);
  assert.ok(schema.infrastructureRelationships);
});
