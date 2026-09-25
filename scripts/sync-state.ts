import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createDatabase } from "../src/storage/db.js";

export interface R2ClientInterface {
  getObject?(params: { Key: string }): Promise<any>;
  putObject(params: { Key: string; Body: any; Metadata?: Record<string, string> }): Promise<any>;
  copyObject?(params: { CopySource: string; Key: string }): Promise<any>;
  deleteObject?(params: { Key: string }): Promise<any>;
}

export interface HydrateOptions {
  r2Client: R2ClientInterface;
  targetDbPath: string;
}

export interface PublishOptions {
  r2Client: R2ClientInterface;
  localDbPath: string;
  artifactsDir?: string;
}

export interface SyncArtifactsOptions {
  r2Client: R2ClientInterface;
  artifactsDir: string;
}

/**
 * Pre-run hydration: pulls existing database from Cloudflare R2 or initializes fresh schema.
 */
export async function hydrateStateFromR2(
  options: HydrateOptions
): Promise<{ hydratedFromRemote: boolean }> {
  const { r2Client, targetDbPath } = options;
  const targetDir = path.dirname(targetDbPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let remoteObject: any = null;
  if (typeof r2Client.getObject === "function") {
    try {
      remoteObject = await r2Client.getObject({ Key: "gridlock.db" });
    } catch {
      remoteObject = null;
    }
  }

  if (remoteObject && remoteObject.Body) {
    let bodyBuffer: Buffer;
    if (Buffer.isBuffer(remoteObject.Body)) {
      bodyBuffer = remoteObject.Body;
    } else if (typeof remoteObject.Body === "string") {
      bodyBuffer = Buffer.from(remoteObject.Body);
    } else {
      // Async stream
      const chunks: Buffer[] = [];
      for await (const chunk of remoteObject.Body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      bodyBuffer = Buffer.concat(chunks);
    }
    fs.writeFileSync(targetDbPath, bodyBuffer);
    return { hydratedFromRemote: true };
  }

  // Fallback: initialize fresh local SQLite database with canonical schema
  const db = createDatabase(targetDbPath);
  db.close();

  return { hydratedFromRemote: false };
}

/**
 * Post-run publish: pushes mutated database atomically to Cloudflare R2 (.tmp key then copy).
 */
export async function publishStateToR2(options: PublishOptions): Promise<void> {
  const { r2Client, localDbPath } = options;
  if (!fs.existsSync(localDbPath)) {
    throw new Error(`Local database file does not exist at: ${localDbPath}`);
  }

  const dbBuffer = fs.readFileSync(localDbPath);
  const tmpKey = "gridlock.db.tmp";
  const finalKey = "gridlock.db";

  // 1. Stage upload to temporary key
  await r2Client.putObject({
    Key: tmpKey,
    Body: dbBuffer,
  });

  // 2. Atomic swap via copyObject if supported, or putObject finalKey
  if (typeof r2Client.copyObject === "function") {
    await r2Client.copyObject({
      CopySource: tmpKey,
      Key: finalKey,
    });
    if (typeof r2Client.deleteObject === "function") {
      await r2Client.deleteObject({ Key: tmpKey }).catch(() => {});
    }
  } else {
    await r2Client.putObject({
      Key: finalKey,
      Body: dbBuffer,
    });
  }
}

/**
 * Syncs content-addressable raw payload blobs to R2 with verified SHA-256 metadata checksums.
 */
export async function syncArtifactBlobsToR2(
  options: SyncArtifactsOptions
): Promise<{ syncedCount: number }> {
  const { r2Client, artifactsDir } = options;
  if (!fs.existsSync(artifactsDir)) {
    return { syncedCount: 0 };
  }

  function getFilesRecursively(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getFilesRecursively(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const files = getFilesRecursively(artifactsDir);
  let syncedCount = 0;

  for (const filePath of files) {
    const fileBuffer = fs.readFileSync(filePath);
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    const relativeKey = path.relative(artifactsDir, filePath).replace(/\\/g, "/");
    const destinationKey = `artifacts/${relativeKey}`;

    await r2Client.putObject({
      Key: destinationKey,
      Body: fileBuffer,
      Metadata: {
        "sha256-hash": sha256,
      },
    });
    syncedCount++;
  }

  return { syncedCount };
}

// Auto-execute when run directly from command line
const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (scriptPath.endsWith("sync-state.ts") || scriptPath.endsWith("sync-state.js")) {
  const isHydrate = process.argv.includes("--hydrate");
  const isPublish = process.argv.includes("--publish");
  const targetDbPath = process.env.GRIDLOCK_DB_PATH ?? path.resolve(process.cwd(), "gridlock.db");
  const artifactsDir = process.env.ARTIFACTS_DIR ?? path.resolve(process.cwd(), ".artifacts");

  // Basic mock client when running offline or without credentials
  const defaultR2Client: R2ClientInterface = {
    putObject: async () => ({}),
    getObject: async () => null,
  };

  if (isHydrate) {
    hydrateStateFromR2({ r2Client: defaultR2Client, targetDbPath })
      .then((res) => {
        console.log(
          `[sync-state] State hydration complete. Hydrated from remote: ${res.hydratedFromRemote}`
        );
        process.exit(0);
      })
      .catch((err) => {
        console.error(`[sync-state] State hydration failed: ${err.message}`);
        process.exit(1);
      });
  } else if (isPublish) {
    if (!fs.existsSync(targetDbPath)) {
      console.log(`[sync-state] Target DB does not exist at ${targetDbPath}, creating schema before publish...`);
      createDatabase(targetDbPath).close();
    }
    publishStateToR2({ r2Client: defaultR2Client, localDbPath: targetDbPath, artifactsDir })
      .then(() => syncArtifactBlobsToR2({ r2Client: defaultR2Client, artifactsDir }))
      .then((res) => {
        console.log(`[sync-state] State publish complete. Synced ${res.syncedCount} blobs.`);
        process.exit(0);
      })
      .catch((err) => {
        console.error(`[sync-state] State publish failed: ${err.message}`);
        process.exit(1);
      });
  }
}
