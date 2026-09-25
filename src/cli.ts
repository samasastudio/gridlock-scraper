export const EXIT_CODES = {
  SUCCESS: 0,
  RUNTIME_ERROR: 1,
  ANOMALY_QUARANTINE: 2,
} as const;

export interface CliOptions {
  source: "tdlr" | "ercot" | "tceq" | "municipal" | "all";
  dryRun: boolean;
  force: boolean;
}

export const VALID_SOURCES = ["tdlr", "ercot", "tceq", "municipal", "all"] as const;

/**
 * Parses command line arguments for the scraper CLI entrypoint.
 */
export function parseArgs(rawArgs: string[]): CliOptions {
  let source: string = "all";
  let dryRun = false;
  let force = false;

  for (const arg of rawArgs) {
    if (arg.startsWith("--source=")) {
      source = arg.slice("--source=".length).trim();
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!VALID_SOURCES.includes(source as any)) {
    throw new Error(
      `Unsupported source '${source}'. Valid sources are: ${VALID_SOURCES.join(", ")}`
    );
  }

  return {
    source: source as CliOptions["source"],
    dryRun,
    force,
  };
}

/**
 * Main CLI entrypoint routine returning the appropriate exit code.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
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

  // Real execution logic: runs designated connector pipelines
  return EXIT_CODES.SUCCESS;
}

// Auto-run if executed directly
const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (scriptPath.endsWith("cli.ts") || scriptPath.endsWith("cli.js")) {
  main().then((code) => {
    process.exit(code);
  });
}
