import path from "node:path";
import { parseArgs } from "node:util";
import { createDatabase, ScraperRepository } from "../src/storage/db.js";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    db: { type: "string" },
    limit: { type: "string", default: "10" },
  },
  strict: false,
});

const dbPath = values.db ?? process.env.GRIDLOCK_DB_PATH ?? path.resolve(process.cwd(), "gridlock.db");
const limit = parseInt(values.limit ?? "10", 10);

console.log("\n====================================================================================================");
console.log(`                     GRIDLOCK-SCRAPER DATABASE DIAGNOSTIC INSPECTOR                                `);
console.log("====================================================================================================");
console.log(`Target Database: ${dbPath}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("----------------------------------------------------------------------------------------------------\n");

const db = createDatabase(dbPath);
const repo = new ScraperRepository(db);

try {
  // 1. Table Record Counts
  console.log("--- TABLE RECORD TOTALS ---");
  const tables = [
    "source_artifacts",
    "observations",
    "projects",
    "facilities",
    "locations",
    "organizations",
    "development_actions",
    "environmental_actions",
    "connector_configs",
    "repair_audits",
  ];

  for (const table of tables) {
    try {
      const row = (db as any).prepare(`SELECT count(*) as count FROM ${table}`).get() as any;
      console.log(`  ${table.padEnd(30)} : ${row?.count ?? 0}`);
    } catch {
      console.log(`  ${table.padEnd(30)} : [Table not found]`);
    }
  }

  // 2. Connector Configs & Operational Status
  console.log("\n--- CONNECTOR STATUSES ---");
  const configs = (db as any)
    .prepare("SELECT id, source_family, last_status, last_run_at, updated_at FROM connector_configs")
    .all() as any[];

  if (configs.length === 0) {
    console.log("  (No connector configurations found)");
  } else {
    console.log(` ${"ID".padEnd(22)} | ${"Family".padEnd(18)} | ${"Status".padEnd(10)} | ${"Last Run".padEnd(20)}`);
    console.log(`-${"-".repeat(22)}-|-${"-".repeat(18)}-|-${"-".repeat(10)}-|-${"-".repeat(20)}`);
    for (const c of configs) {
      console.log(
        ` ${c.id.padEnd(22)} | ${(c.source_family ?? "").padEnd(18)} | ${(c.last_status ?? "idle").padEnd(10)} | ${(c.last_run_at ?? "never").padEnd(20)}`
      );
    }
  }

  // 3. Recent Source Artifacts
  console.log(`\n--- RECENT SOURCE ARTIFACTS (Top ${limit}) ---`);
  const artifacts = (db as any)
    .prepare("SELECT id, sha256_hash, source_family, byte_size, connector_version, captured_at FROM source_artifacts ORDER BY captured_at DESC LIMIT ?")
    .all(limit) as any[];

  if (artifacts.length === 0) {
    console.log("  (No source artifacts recorded)");
  } else {
    for (const a of artifacts) {
      console.log(`  [${a.captured_at}] ${a.source_family} | ${a.byte_size} bytes | ver: ${a.connector_version}`);
      console.log(`    ID: ${a.id} | SHA-256: ${a.sha256_hash}`);
    }
  }

  // 4. Recent Observations Sample
  console.log(`\n--- RECENT OBSERVATIONS (Top ${limit}) ---`);
  const obs = (db as any)
    .prepare("SELECT subject_type, subject_id, property, value_json, observed_at FROM observations ORDER BY observed_at DESC LIMIT ?")
    .all(limit) as any[];

  if (obs.length === 0) {
    console.log("  (No observations recorded)");
  } else {
    for (const o of obs) {
      console.log(`  [${o.subject_type}] ${o.subject_id} -> ${o.property}: ${o.value_json}`);
    }
  }

  // 5. Active Repair Audits
  console.log("\n--- REPAIR AUDITS ---");
  const audits = (db as any)
    .prepare("SELECT id, connector_id, status, failure_reason, created_at FROM repair_audits ORDER BY created_at DESC LIMIT 5")
    .all() as any[];

  if (audits.length === 0) {
    console.log("  (No repair audits recorded)");
  } else {
    for (const au of audits) {
      console.log(`  Audit ${au.id.slice(0, 8)} | ${au.connector_id} | Status: ${au.status} | Reason: ${au.failure_reason}`);
    }
  }

  console.log("\n====================================================================================================\n");
} finally {
  db.close();
}
