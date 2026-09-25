import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
  // 1. Compile-time validation: tsc semantic typecheck
  assert.doesNotThrow(() => {
    execSync("npx tsc --noEmit", { stdio: "pipe", cwd: process.cwd() });
  }, "TypeScript compiler (tsc --noEmit) must pass cleanly to verify inferred entity contracts");

  // 2. Runtime Drizzle schema column verification
  assert.equal(schema.sourceArtifacts.sha256Hash.name, "sha256_hash");
  assert.equal(schema.observations.subjectType.name, "subject_type");
  assert.equal(schema.projects.slug.name, "slug");

  // 3. Prohibit untyped raw SQL query strings in database repository methods (Invariant 8)
  const dbFileContent = fs.readFileSync(
    path.resolve(process.cwd(), "src/storage/db.ts"),
    "utf8"
  );
  const nonDdlContent = dbFileContent.replace(/export const DDL_SCHEMA = `[\s\S]*?`;/, "");
  assert.doesNotMatch(
    nonDdlContent,
    /(["'`])\s*(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,
    "Prohibited raw SQL string detected in ScraperRepository; all queries must use typed Drizzle schema"
  );
});
