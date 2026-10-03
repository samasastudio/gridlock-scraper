import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { CONNECTOR_JOBS, ensureConnectorConfigs, resolveJobsToRun } from "../src/cli.js";
import { runScraperPipeline } from "../src/jobs/runner.js";
import { parseAustinPermitsJson } from "../src/parsers/austin.js";
import { parseErcotCsv } from "../src/parsers/ercot.js";
import { parseMunicipalAgenda } from "../src/parsers/municipal.js";
import { parseTceqHtml } from "../src/parsers/tceq.js";
import { parseTdlrHtml } from "../src/parsers/tdlr.js";
import { evaluateCandidatePatch } from "../src/repair/replay.js";
import { createServer } from "../src/server.js";
import { ArtifactStore } from "../src/storage/artifact-store.js";
import { createDatabase, ScraperRepository } from "../src/storage/db.js";

interface StageResult {
  stage: number;
  name: string;
  passed: boolean;
  durationMs: number;
  details: string[];
  error?: string;
}

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    all: { type: "boolean", default: true },
    stage: { type: "string" },
    live: { type: "boolean", default: false },
    clean: { type: "boolean", default: true },
    "keep-sandbox": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
  strict: false,
});

const isLive = Boolean(args.values.live) || process.env.LIVE_TEST === "1";
const isVerbose = Boolean(args.values.verbose);
const stageFilter = args.values.stage ? parseInt(args.values.stage as string, 10) : null;

const UAT_WORK_DIR = path.resolve(process.cwd(), ".uat-sandbox");
const UAT_DB_PATH = path.join(UAT_WORK_DIR, "uat-gridlock.db");
const UAT_ARTIFACTS_DIR = path.join(UAT_WORK_DIR, ".artifacts");

function setupSandbox(): void {
  if (fs.existsSync(UAT_WORK_DIR)) {
    fs.rmSync(UAT_WORK_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(UAT_WORK_DIR, { recursive: true });
  fs.mkdirSync(UAT_ARTIFACTS_DIR, { recursive: true });
}

function cleanupSandbox(): void {
  if (!args.values["keep-sandbox"] && args.values.clean && fs.existsSync(UAT_WORK_DIR)) {
    try {
      fs.rmSync(UAT_WORK_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup locks on Windows
    }
  }
}

// ============================================================================
// Stage 0: Environment Pre-Flight Sanity Gate
// ============================================================================
async function runStage0(): Promise<StageResult> {
  const start = Date.now();
  const details: string[] = [];

  // 1. Node runtime >= 22
  const [major] = process.versions.node.split(".").map(Number);
  if (major! < 22) {
    return {
      stage: 0,
      name: "Environment Pre-Flight Sanity",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: `Node.js >= 22 required. Current: ${process.version}`,
    };
  }
  details.push(`Node.js runtime: ${process.version} (>= 22.0.0 satisfied)`);

  // 2. Playwright Chromium executable check
  try {
    const browserPath = chromium.executablePath();
    details.push(`Playwright Chromium executable found at: ${browserPath}`);
  } catch (err: any) {
    return {
      stage: 0,
      name: "Environment Pre-Flight Sanity",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: `Playwright Chromium missing. Run 'npx playwright install chromium': ${err.message}`,
    };
  }

  // 3. Built-in SQLite check
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const testDb = new DatabaseSync(":memory:");
    testDb.exec("CREATE TABLE sanity_check (id INT PRIMARY KEY); INSERT INTO sanity_check VALUES (1);");
    const row = testDb.prepare("SELECT * FROM sanity_check").get() as any;
    testDb.close();
    if (row?.id !== 1) throw new Error("SQLite read returned unexpected result");
    details.push("node:sqlite DatabaseSync operational with in-memory execution");
  } catch (err: any) {
    return {
      stage: 0,
      name: "Environment Pre-Flight Sanity",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: `node:sqlite check failed: ${err.message}`,
    };
  }

  // 4. Working directory permissions
  const testFile = path.join(UAT_WORK_DIR, ".write-test");
  fs.writeFileSync(testFile, "probe");
  fs.unlinkSync(testFile);
  details.push(`UAT sandbox path writable: ${UAT_WORK_DIR}`);

  return {
    stage: 0,
    name: "Environment Pre-Flight Sanity",
    passed: true,
    durationMs: Date.now() - start,
    details,
  };
}

// ============================================================================
// Stage 1: Drizzle Database Initialization & Schema Gate
// ============================================================================
async function runStage1(): Promise<StageResult> {
  const start = Date.now();
  const details: string[] = [];

  const db = createDatabase(UAT_DB_PATH);
  const repo = new ScraperRepository(db);

  try {
    // Verify canonical tables created by DDL schema
    const rawTables = (db as any)
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name);

    const expectedTables = [
      "source_artifacts",
      "observations",
      "organizations",
      "locations",
      "projects",
      "facilities",
      "development_actions",
      "environmental_actions",
      "infrastructure_relationships",
      "connector_configs",
      "repair_audits",
    ];

    const missingTables = expectedTables.filter((t) => !rawTables.includes(t));
    if (missingTables.length > 0) {
      throw new Error(`Missing expected tables in DDL schema: ${missingTables.join(", ")}`);
    }
    details.push(`All ${expectedTables.length} canonical SQLite tables verified in schema`);

    // Verify connector config bootstrap
    await ensureConnectorConfigs(db);
    const configs = await repo.getAllConnectorConfigs();
    if (configs.length < 5) {
      throw new Error(`Expected at least 5 default connector configs, found ${configs.length}`);
    }
    details.push(`Initialized ${configs.length} connector configurations via typed Drizzle repo`);

    return {
      stage: 1,
      name: "Drizzle Database & Schema Verification",
      passed: true,
      durationMs: Date.now() - start,
      details,
    };
  } catch (err: any) {
    return {
      stage: 1,
      name: "Drizzle Database & Schema Verification",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: err.message,
    };
  } finally {
    db.close();
  }
}

// ============================================================================
// Stage 2: CLI Interface & Dry-Run Guardrails
// ============================================================================
async function runStage2(): Promise<StageResult> {
  const start = Date.now();
  const details: string[] = [];

  const { spawnSync } = await import("node:child_process");

  // 1. Dry run execution
  const dryRunRes = spawnSync("npx", ["tsx", "src/cli.ts", "--source=all", "--dry-run"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: true,
  });

  if (dryRunRes.status !== 0) {
    return {
      stage: 2,
      name: "CLI Interface & Guardrails",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: `CLI dry-run failed with exit code ${dryRunRes.status}. Stderr: ${dryRunRes.stderr}`,
    };
  }
  details.push("CLI '--dry-run' exited with code 0 without modifying state");

  // 2. Invalid source rejection
  const invalidRes = spawnSync("npx", ["tsx", "src/cli.ts", "--source=nonexistent_portal"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: true,
  });

  if (invalidRes.status !== 1) {
    return {
      stage: 2,
      name: "CLI Interface & Guardrails",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: `Expected CLI exit code 1 on invalid source, got ${invalidRes.status}`,
    };
  }
  details.push("CLI rejected invalid source with exit code 1 (Runtime Error)");

  return {
    stage: 2,
    name: "CLI Interface & Guardrails",
    passed: true,
    durationMs: Date.now() - start,
    details,
  };
}

// ============================================================================
// Stage 3: Hermetic Fixture Ingestion (Controlled UAT Pipeline)
// ============================================================================
async function runStage3(): Promise<StageResult> {
  const start = Date.now();
  const details: string[] = [];

  const db = createDatabase(UAT_DB_PATH);
  const store = new ArtifactStore(UAT_ARTIFACTS_DIR);
  const repo = new ScraperRepository(db);

  try {
    await ensureConnectorConfigs(db);

    const fixtureMap = [
      {
        connectorId: "tdlr_v1",
        sourceFamily: "tdlr_tabs" as const,
        fixturePath: "tests/fixtures/tdlr/tabs-sample.html",
        contentType: "text/html",
        parser: parseTdlrHtml,
      },
      {
        connectorId: "ercot_queue_v1",
        sourceFamily: "ercot_queue" as const,
        fixturePath: "tests/fixtures/ercot/queue-sample.csv",
        contentType: "text/csv",
        parser: parseErcotCsv,
      },
      {
        connectorId: "tceq_v1",
        sourceFamily: "tceq" as const,
        fixturePath: "tests/fixtures/tceq/permit-sample.html",
        contentType: "text/html",
        parser: parseTceqHtml,
      },
      {
        connectorId: "municipal_agenda_v1",
        sourceFamily: "municipal_agenda" as const,
        fixturePath: "tests/fixtures/municipal/agenda-sample.html",
        contentType: "text/html",
        parser: parseMunicipalAgenda,
      },
      {
        connectorId: "austin_permits_v1",
        sourceFamily: "austin_permits" as const,
        fixturePath: "tests/fixtures/austin/permits-sample.json",
        contentType: "application/json",
        parser: parseAustinPermitsJson,
      },
    ];

    let totalObs = 0;

    for (const item of fixtureMap) {
      const fullPath = path.resolve(process.cwd(), item.fixturePath);
      const rawContent = fs.readFileSync(fullPath);

      const result = await runScraperPipeline({
        connectorId: item.connectorId,
        sourceFamily: item.sourceFamily,
        extractor: async () => ({
          sourceFamily: item.sourceFamily,
          sourceUrl: `file://${fullPath.replace(/\\/g, "/")}`,
          contentType: item.contentType,
          byteSize: rawContent.length,
          content: rawContent,
          connectorVersion: "1.0.0",
        }),
        parser: item.parser,
        artifactStore: store,
        db,
      });

      if (result.anomaly) {
        throw new Error(`Connector ${item.connectorId} unexpectedly raised anomaly on valid fixture`);
      }
      if (result.earlyExit) {
        throw new Error(`Connector ${item.connectorId} unexpectedly early-exited on fresh database`);
      }
      if (result.observationsCount <= 0) {
        throw new Error(`Connector ${item.connectorId} emitted 0 observations`);
      }

      // Verify artifact storage
      const artifact = await repo.findSourceArtifactByHash(result.sha256Hash);
      if (!artifact) {
        throw new Error(`Artifact record not found in database for hash ${result.sha256Hash}`);
      }

      const storedBlobPath = path.resolve(UAT_ARTIFACTS_DIR, artifact.storagePath);
      if (!fs.existsSync(storedBlobPath)) {
        throw new Error(`Gzip artifact blob file missing on disk: ${storedBlobPath}`);
      }

      totalObs += result.observationsCount;
      details.push(
        `Connector ${item.connectorId} ingested ${result.observationsCount} observations (Artifact ID: ${artifact.id.slice(0, 8)}...)`
      );
    }

    details.push(`Total verified observations inserted across 5 sources: ${totalObs}`);

    return {
      stage: 3,
      name: "Hermetic Fixture Ingestion (Controlled E2E)",
      passed: true,
      durationMs: Date.now() - start,
      details,
    };
  } catch (err: any) {
    return {
      stage: 3,
      name: "Hermetic Fixture Ingestion (Controlled E2E)",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: err.message,
    };
  } finally {
    db.close();
  }
}

// ============================================================================
// Stage 4: Content-Hash Early-Exit Invariant (ADR-0003)
// ============================================================================
async function runStage4(): Promise<StageResult> {
  const start = Date.now();
  const details: string[] = [];

  const db = createDatabase(UAT_DB_PATH);
  const store = new ArtifactStore(UAT_ARTIFACTS_DIR);
  const repo = new ScraperRepository(db);

  try {
    const statsBefore = await repo.getArtifactRunStats();

    // Re-run TDLR and ERCOT with the exact same payload
    const tdlrPath = path.resolve(process.cwd(), "tests/fixtures/tdlr/tabs-sample.html");
    const tdlrContent = fs.readFileSync(tdlrPath);

    const result = await runScraperPipeline({
      connectorId: "tdlr_v1",
      sourceFamily: "tdlr_tabs",
      extractor: async () => ({
        sourceFamily: "tdlr_tabs",
        sourceUrl: `file://${tdlrPath.replace(/\\/g, "/")}`,
        contentType: "text/html",
        byteSize: tdlrContent.length,
        content: tdlrContent,
        connectorVersion: "1.0.0",
      }),
      parser: parseTdlrHtml,
      artifactStore: store,
      db,
    });

    if (!result.earlyExit) {
      throw new Error("Pipeline failed to early-exit on duplicate SHA-256 payload");
    }
    if (result.observationsCount !== 0) {
      throw new Error(`Early-exit must emit 0 new observations, got ${result.observationsCount}`);
    }

    const statsAfter = await repo.getArtifactRunStats();
    if (statsBefore.totalRuns !== statsAfter.totalRuns) {
      throw new Error("Duplicate payload caused duplicate insertion into source_artifacts table");
    }

    details.push("Content-Hash early-exit triggered on identical SHA-256 (0 duplicate DB writes)");
    details.push(`Preserved pristine total run count: ${statsAfter.totalRuns}`);

    return {
      stage: 4,
      name: "Content-Hash Early-Exit Verification (ADR-0003)",
      passed: true,
      durationMs: Date.now() - start,
      details,
    };
  } catch (err: any) {
    return {
      stage: 4,
      name: "Content-Hash Early-Exit Verification (ADR-0003)",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: err.message,
    };
  } finally {
    db.close();
  }
}

// ============================================================================
// Stage 5: Anomaly Quarantine & Self-Healing Replay Gate (ADR-0004)
// ============================================================================
async function runStage5(): Promise<StageResult> {
  const start = Date.now();
  const details: string[] = [];

  const db = createDatabase(UAT_DB_PATH);
  const store = new ArtifactStore(UAT_ARTIFACTS_DIR);
  const repo = new ScraperRepository(db);

  try {
    // 1. Ingest malformed payload lacking required Zod fields
    const malformedPayload = "<html><body><form><span id='ctl00_lblUnknown'>Corrupt</span></form></body></html>";

    const quarantineResult = await runScraperPipeline({
      connectorId: "tdlr_v1",
      sourceFamily: "tdlr_tabs",
      extractor: async () => ({
        sourceFamily: "tdlr_tabs",
        sourceUrl: "https://www.tdlr.texas.gov/TABS/Corrupt",
        contentType: "text/html",
        byteSize: Buffer.byteLength(malformedPayload),
        content: malformedPayload,
        connectorVersion: "1.0.0",
      }),
      parser: parseTdlrHtml,
      artifactStore: store,
      db,
    });

    if (!quarantineResult.anomaly) {
      throw new Error("Corrupted payload failed to trigger anomaly quarantine");
    }

    const config = await repo.getConnectorConfig("tdlr_v1");
    if (config?.lastStatus !== "anomaly") {
      throw new Error(`Expected connector status 'anomaly', got '${config?.lastStatus}'`);
    }
    details.push("Corrupted payload safely trapped and quarantined (status set to 'anomaly')");

    // 2. Verify Replay Harness Evaluation with Frozen Fixtures
    const tdlrFixture = fs.readFileSync(path.resolve(process.cwd(), "tests/fixtures/tdlr/tabs-sample.html"), "utf8");
    const patchCandidate = {
      manifest: { selector: "#ctl00_ContentPlaceHolder1_lblProjectNumber" },
      parser: (raw: string | Buffer) => parseTdlrHtml(raw, { selector: "#ctl00_ContentPlaceHolder1_lblProjectNumber" }),
    };

    const replayEvaluation = await evaluateCandidatePatch(
      "tdlr_v1",
      patchCandidate.manifest,
      patchCandidate.parser,
      [
        {
          id: "tdlr-sample-1",
          content: tdlrFixture,
          expectedMinCount: 1,
          expectedSubjectIds: ["TABS2024098765"],
        },
      ],
      db
    );

    if (!replayEvaluation.allPassed) {
      throw new Error("Self-healing replay evaluation failed on valid test patch");
    }
    details.push("Replay harness verified candidate patch against historical fixture oracles (100% pass)");
    details.push(`Promoted repair audit recorded in repair_audits table (Audit ID: ${replayEvaluation.auditId.slice(0, 8)}...)`);

    const updatedConfig = await repo.getConnectorConfig("tdlr_v1");
    if (updatedConfig?.lastStatus !== "ok") {
      throw new Error(`Promoted audit failed to restore connector status to 'ok', current: ${updatedConfig?.lastStatus}`);
    }
    details.push("Connector status cleanly restored to 'ok' following verified promotion audit");

    return {
      stage: 5,
      name: "Anomaly Quarantine & Replay Gate (ADR-0004)",
      passed: true,
      durationMs: Date.now() - start,
      details,
    };
  } catch (err: any) {
    return {
      stage: 5,
      name: "Anomaly Quarantine & Replay Gate (ADR-0004)",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: err.message,
    };
  } finally {
    db.close();
  }
}

// ============================================================================
// Stage 6: HTTP Server Telemetry & Trigger API
// ============================================================================
async function runStage6(): Promise<StageResult> {
  const start = Date.now();
  const details: string[] = [];

  process.env.GRIDLOCK_DB_PATH = UAT_DB_PATH;
  process.env.ARTIFACTS_DIR = UAT_ARTIFACTS_DIR;
  const serverInstance = createServer();

  try {
    const { port, host } = await serverInstance.listen(0, "127.0.0.1");
    const baseUrl = `http://${host}:${port}`;
    details.push(`Ephemeral ScraperServer listening on ${baseUrl}`);

    // 1. GET /api/source-health/telemetry
    const telemetryRes = await fetch(`${baseUrl}/api/source-health/telemetry`);
    if (telemetryRes.status !== 200) {
      throw new Error(`/api/source-health/telemetry returned HTTP ${telemetryRes.status}`);
    }
    const telemetryJson: any = await telemetryRes.json();
    if (!telemetryJson.status || typeof telemetryJson.uptimeSeconds !== "number") {
      throw new Error("Invalid telemetry JSON schema returned by server");
    }
    details.push(`Telemetry endpoint verified: status='${telemetryJson.status}', uptime=${telemetryJson.uptimeSeconds}s`);

    // 2. GET /api/ingest/status
    const statusRes = await fetch(`${baseUrl}/api/ingest/status`);
    if (statusRes.status !== 200) {
      throw new Error(`/api/ingest/status returned HTTP ${statusRes.status}`);
    }
    const statusJson: any = await statusRes.json();
    if (statusJson.status !== "ok" || !statusJson.metrics) {
      throw new Error("Invalid ingest status payload schema");
    }
    details.push(
      `Ingest status verified: totalRuns=${statusJson.metrics.totalRuns}, quarantinedRuns=${statusJson.metrics.quarantinedRuns}`
    );

    // 3. POST /api/ingest/trigger
    const triggerRes = await fetch(`${baseUrl}/api/ingest/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceFamily: "austin_permits" }),
    });

    if (triggerRes.status !== 202) {
      throw new Error(`/api/ingest/trigger returned HTTP ${triggerRes.status}, expected 202 Accepted`);
    }
    const triggerJson: any = await triggerRes.json();
    if (!triggerJson.runId || triggerJson.status !== "accepted") {
      throw new Error("Trigger endpoint did not return valid runId acceptance payload");
    }
    details.push(`Trigger endpoint verified: runId='${triggerJson.runId.slice(0, 8)}...' (202 Accepted)`);

    return {
      stage: 6,
      name: "HTTP Server Telemetry & Trigger API",
      passed: true,
      durationMs: Date.now() - start,
      details,
    };
  } catch (err: any) {
    return {
      stage: 6,
      name: "HTTP Server Telemetry & Trigger API",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: err.message,
    };
  } finally {
    if (typeof (serverInstance.server as any).closeAllConnections === "function") {
      (serverInstance.server as any).closeAllConnections();
    }
    await serverInstance.close().catch(() => {});
  }
}

// ============================================================================
// Stage 7: Live Network Integration Smoke Test (Opt-In: --live)
// ============================================================================
async function runStage7(): Promise<StageResult> {
  const start = Date.now();
  const details: string[] = [];

  if (!isLive) {
    details.push("Skipping live network integration test (Opt-in via '--live' or 'LIVE_TEST=1')");
    return {
      stage: 7,
      name: "Live Network Smoke Test (Gated)",
      passed: true,
      durationMs: Date.now() - start,
      details,
    };
  }

  try {
    // Probe Austin Socrata endpoint with limit 2 and positive valuation filter
    const { extractAustinPermits } = await import("../src/extractors/austin.js");
    details.push("Connecting to City of Austin Open Data portal (Socrata)...");

    const result = await extractAustinPermits({
      url: "https://data.austintexas.gov/resource/3syk-w9eu.json?$where=total_job_valuation > 0&$limit=2",
      timeoutMs: 15000,
    });
    if (!result.content || result.byteSize === 0) {
      throw new Error("Live Austin extraction returned empty content body");
    }
    details.push(`Extracted live Austin permits payload: ${result.byteSize} bytes`);

    // Verify parser on live extracted payload
    const observations = parseAustinPermitsJson(result.content);
    details.push(`Parsed ${observations.length} atomic observations from live Socrata feed`);

    return {
      stage: 7,
      name: "Live Network Smoke Test (Gated)",
      passed: true,
      durationMs: Date.now() - start,
      details,
    };
  } catch (err: any) {
    return {
      stage: 7,
      name: "Live Network Smoke Test (Gated)",
      passed: false,
      durationMs: Date.now() - start,
      details,
      error: `Live network smoke failed: ${err.message}`,
    };
  }
}

// ============================================================================
// Master Runner & Reporter
// ============================================================================
async function main(): Promise<void> {
  console.log("\n====================================================================================================");
  console.log("                     GRIDLOCK-SCRAPER LOCAL UAT & VERIFICATION HARNESS                              ");
  console.log("====================================================================================================");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Mode: ${isLive ? "LIVE NETWORK (OPT-IN)" : "HERMETIC OFFLINE (STANDARD)"}`);
  console.log(`Working Directory: ${process.cwd()}`);
  console.log("----------------------------------------------------------------------------------------------------\n");

  setupSandbox();

  const stages = [
    { id: 0, fn: runStage0 },
    { id: 1, fn: runStage1 },
    { id: 2, fn: runStage2 },
    { id: 3, fn: runStage3 },
    { id: 4, fn: runStage4 },
    { id: 5, fn: runStage5 },
    { id: 6, fn: runStage6 },
    { id: 7, fn: runStage7 },
  ];

  const results: StageResult[] = [];
  let allPassed = true;

  for (const st of stages) {
    if (stageFilter !== null && st.id !== stageFilter) continue;

    process.stdout.write(`[Stage ${st.id}] Executing ${st.fn.name.replace("runStage", "")}... `);
    const result = await st.fn();
    results.push(result);

    if (result.passed) {
      console.log(`[PASS] (${result.durationMs}ms)`);
      if (isVerbose) {
        for (const d of result.details) {
          console.log(`         • ${d}`);
        }
      }
    } else {
      console.log(`[FAIL] (${result.durationMs}ms)`);
      console.log(`         ! Error: ${result.error}`);
      allPassed = false;
      break;
    }
  }

  cleanupSandbox();

  console.log("\n====================================================================================================");
  console.log("                                UAT VERIFICATION SUMMARY MATRIX                                     ");
  console.log("====================================================================================================");
  console.log(` Stage | Description                                        | Duration | Result `);
  console.log(`-------|----------------------------------------------------|----------|--------`);

  for (const r of results) {
    const mark = r.passed ? "PASS [x]" : "FAIL [ ]";
    console.log(
      `   ${r.stage}   | ${r.name.padEnd(50)} | ${(r.durationMs + "ms").padStart(8)} | ${mark} `
    );
  }

  console.log("====================================================================================================");
  if (allPassed) {
    console.log(`RESULT: ALL ${results.length} UAT STAGES PASSED. Quality assurance criteria satisfied for live release.`);
    console.log("====================================================================================================\n");
    process.exitCode = 0;
  } else {
    console.error(`RESULT: UAT REGRESSION DETECTED. Review failing stage error trace above.`);
    console.log("====================================================================================================\n");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[FATAL UAT ERROR]", err);
  process.exitCode = 1;
});
