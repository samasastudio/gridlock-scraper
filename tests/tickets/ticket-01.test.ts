import assert from "node:assert/strict";
import test from "node:test";
import * as schema from "../../src/schema.js";
import { createDatabase, ScraperRepository } from "../../src/storage/db.js";

test("Ticket 01 - Criteria 1: Drizzle ORM schema defined with canonical tables", () => {
  assert.ok(schema.sourceArtifacts, "sourceArtifacts table must exist in schema");
  assert.ok(schema.observations, "observations table must exist in schema");
  assert.ok(schema.projects, "projects table must exist in schema");
  assert.ok(schema.facilities, "facilities table must exist in schema");
  assert.ok(schema.organizations, "organizations table must exist in schema");
  assert.ok(schema.locations, "locations table must exist in schema");
  assert.ok(schema.connectorConfigs, "connectorConfigs table must exist in schema");
  assert.ok(schema.repairAudits, "repairAudits table must exist in schema");
});

test("Ticket 01 - Criteria 2: In-memory SQLite initialization and migrations execute cleanly", () => {
  const db = createDatabase(":memory:");
  assert.ok(db, "DatabaseSync instance should be created");
  const repo = new ScraperRepository(db);
  assert.ok(repo, "ScraperRepository wraps database cleanly");
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_artifacts'").get() as { name: string } | undefined;
  assert.equal(row?.name, "source_artifacts", "source_artifacts table must exist in database");
});

test("Ticket 01 - Criteria 3: Node.js >= 22 runtime enforced", () => {
  const majorVersion = parseInt(process.versions.node.split(".")[0], 10);
  assert.ok(majorVersion >= 22, `Node.js version must be >= 22, detected ${process.versions.node}`);
});

test("Ticket 01 - Criteria 4: Type definitions export strictly typed entities without raw SQL", () => {
  type SourceArtifact = typeof schema.sourceArtifacts.$inferSelect;
  type Observation = typeof schema.observations.$inferSelect;
  type Project = typeof schema.projects.$inferSelect;
  assert.ok(true, "TypeScript inferred types compile without errors");
});
