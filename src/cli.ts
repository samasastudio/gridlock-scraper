import path from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import { extractAustinPermits } from "./extractors/austin.js";
import { extractErcotQueue } from "./extractors/ercot.js";
import { extractMunicipalAgendas } from "./extractors/municipal.js";
import { extractTceqRecords } from "./extractors/tceq.js";
import { extractTdlrTabs } from "./extractors/tdlr.js";
import type { ExtractorOptions, RawExtractionResult } from "./extractors/types.js";
import { runScraperPipeline } from "./jobs/runner.js";
import { parseAustinPermitsJson } from "./parsers/austin.js";
import { parseErcotCsv } from "./parsers/ercot.js";
import { parseMunicipalAgenda } from "./parsers/municipal.js";
import { parseTceqHtml } from "./parsers/tceq.js";
import { parseTdlrHtml } from "./parsers/tdlr.js";
import type { ObservationCandidate, SourceFamily } from "./schemas/common.js";
import { ArtifactStore } from "./storage/artifact-store.js";
import { createDatabase } from "./storage/db.js";

export const EXIT_CODES = {
  SUCCESS: 0,
  RUNTIME_ERROR: 1,
  ANOMALY_QUARANTINE: 2,
} as const;

export const VALID_SOURCES = [
  "tdlr",
  "ercot",
  "tceq",
  "municipal",
  "austin",
  "austin_permits",
  "all",
] as const;

export type ValidSource = (typeof VALID_SOURCES)[number];

export interface CliOptions {
  source: ValidSource;
  dryRun: boolean;
  force: boolean;
}

export interface ConnectorJobDefinition {
  name: string;
  connectorId: string;
  sourceFamily: SourceFamily;
  extractor: (options?: ExtractorOptions) => Promise<RawExtractionResult>;
  parser: (raw: string) => ObservationCandidate[];
}

export const CONNECTOR_JOBS: Record<
  "tdlr" | "ercot" | "tceq" | "municipal" | "austin" | "austin_permits",
  ConnectorJobDefinition
> = {
  tdlr: {
    name: "TDLR TABS Construction Filings",
    connectorId: "tdlr_v1",
    sourceFamily: "tdlr_tabs",
    extractor: extractTdlrTabs,
    parser: parseTdlrHtml,
  },
  ercot: {
    name: "ERCOT Generation Interconnection Queue",
    connectorId: "ercot_queue_v1",
    sourceFamily: "ercot_queue",
    extractor: extractErcotQueue,
    parser: parseErcotCsv,
  },
  tceq: {
    name: "TCEQ Environmental Authorizations",
    connectorId: "tceq_v1",
    sourceFamily: "tceq",
    extractor: extractTceqRecords,
    parser: parseTceqHtml,
  },
  municipal: {
    name: "Texas Municipal Planning Agendas",
    connectorId: "municipal_agenda_v1",
    sourceFamily: "municipal_agenda",
    extractor: extractMunicipalAgendas,
    parser: parseMunicipalAgenda,
  },
  austin: {
    name: "City of Austin Building Permits",
    connectorId: "austin_permits_v1",
    sourceFamily: "austin_permits",
    extractor: extractAustinPermits,
    parser: parseAustinPermitsJson,
  },
  austin_permits: {
    name: "City of Austin Building Permits",
    connectorId: "austin_permits_v1",
    sourceFamily: "austin_permits",
    extractor: extractAustinPermits,
    parser: parseAustinPermitsJson,
  },
};

/**
 * Parses command line arguments for the scraper CLI entrypoint using Node.js util.parseArgs.
 */
export function parseArgs(rawArgs: string[]): CliOptions {
  let parsed: any;
  try {
    parsed = nodeParseArgs({
      args: rawArgs,
      options: {
        source: { type: "string", default: "all" },
        "dry-run": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err: any) {
    throw new Error(`Unknown option or invalid syntax: ${err.message}`);
  }

  const source = parsed.values.source ?? "all";
  const dryRun = Boolean(parsed.values["dry-run"]);
  const force = Boolean(parsed.values.force);

  if (!VALID_SOURCES.includes(source as any)) {
    throw new Error(
      `Unsupported source '${source}'. Valid sources are: ${VALID_SOURCES.join(", ")}`
    );
  }

  return {
    source: source as ValidSource,
    dryRun,
    force,
  };
}

export function resolveJobsToRun(source: ValidSource): ConnectorJobDefinition[] {
  if (source === "all") {
    return [
      CONNECTOR_JOBS.tdlr,
      CONNECTOR_JOBS.ercot,
      CONNECTOR_JOBS.tceq,
      CONNECTOR_JOBS.municipal,
      CONNECTOR_JOBS.austin,
    ];
  }
  const job = CONNECTOR_JOBS[source];
  if (!job) {
    throw new Error(`No connector job configured for source '${source}'`);
  }
  return [job];
}

export function ensureConnectorConfigs(db: any): void {
  for (const job of Object.values(CONNECTOR_JOBS)) {
    db.prepare(`
      INSERT OR IGNORE INTO connector_configs (id, source_family, manifest, invariants, last_status)
      VALUES (?, ?, '{}', '{}', 'idle')
    `).run(job.connectorId, job.sourceFamily);
  }
}

/**
 * Main CLI entrypoint routine returning the appropriate exit code.
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  overrideDb?: any
): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err: any) {
    console.error(`[CLI Error] ${err.message}`);
    return EXIT_CODES.RUNTIME_ERROR;
  }

  if (options.dryRun) {
    console.log(
      `[CLI] Dry run successful for source: ${options.source}. No database writes or extractions executed.`
    );
    return EXIT_CODES.SUCCESS;
  }

  const dbPath = process.env.GRIDLOCK_DB_PATH ?? path.resolve(process.cwd(), "gridlock.db");
  const db = overrideDb ?? createDatabase(dbPath);
  const store = new ArtifactStore(
    process.env.ARTIFACTS_DIR ?? path.resolve(process.cwd(), ".artifacts")
  );

  let hadAnomaly = false;

  try {
    ensureConnectorConfigs(db);
    const jobs = resolveJobsToRun(options.source);

    // NOTE (Architecture Rationale): Sequential iteration is mandatory here
    // to respect single-threaded SQLite write transaction locks and avoid
    // tripping anti-bot rate-limiting across external Texas state agency portals.
    for (const job of jobs) {
      console.log(`[CLI] Running connector: ${job.name} (${job.connectorId})...`);
      const result = await runScraperPipeline({
        connectorId: job.connectorId,
        sourceFamily: job.sourceFamily,
        extractor: job.extractor,
        parser: job.parser,
        artifactStore: store,
        db,
      });

      if (result.anomaly) {
        console.warn(
          `[CLI Anomaly] Connector ${job.connectorId} quarantined an invariant failure.`
        );
        hadAnomaly = true;
      } else if (result.earlyExit) {
        console.log(
          `[CLI Early-Exit] Connector ${job.connectorId} unchanged (SHA-256 match).`
        );
      } else {
        console.log(
          `[CLI Success] Connector ${job.connectorId} emitted ${result.observationsCount} observations.`
        );
      }
    }

    return hadAnomaly ? EXIT_CODES.ANOMALY_QUARANTINE : EXIT_CODES.SUCCESS;
  } catch (err: any) {
    console.error(`[CLI Runtime Error] ${err.message}`);
    return EXIT_CODES.RUNTIME_ERROR;
  } finally {
    if (!overrideDb) {
      db.close();
    }
  }
}

// Auto-run if executed directly
const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (scriptPath.endsWith("cli.ts") || scriptPath.endsWith("cli.js")) {
  main().then((code) => {
    process.exit(code);
  });
}
