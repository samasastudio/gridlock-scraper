import { createHash, createHmac } from "node:crypto";
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

  // Node 22 native recursive directory traversal
  const files = fs
    .readdirSync(artifactsDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? artifactsDir, entry.name));

  let syncedCount = 0;

  // NOTE (Architecture Rationale): Sequential iteration ensures R2 PUT requests
  // are rate-managed and memory overhead is bounded to single file buffers.
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

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function signS3Request(
  method: string,
  urlStr: string,
  accessKeyId: string,
  secretAccessKey: string,
  body: Buffer = Buffer.from(""),
  extraHeaders: Record<string, string> = {}
): Record<string, string> {
  const url = new URL(urlStr);
  const now = new Date();
  const datetime = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = datetime.slice(0, 8);
  const region = "auto";
  const service = "s3";

  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": datetime,
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])
    ),
  };

  const sortedKeys = Object.keys(headers).sort();
  const signedHeaders = sortedKeys.join(";");
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");

  const canonicalUri = url.pathname.length > 0 ? url.pathname : "/";
  const canonicalQuery = Array.from(url.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kSecret = Buffer.from("AWS4" + secretAccessKey, "utf8");
  const kDate = hmacSha256(kSecret, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}

interface R2Config {
  baseBucketUrl: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

async function getR2Object(
  config: R2Config,
  params: { Key: string }
): Promise<{ Body: Buffer } | null> {
  const url = `${config.baseBucketUrl}/${params.Key}`;
  try {
    const headers = signS3Request("GET", url, config.accessKeyId, config.secretAccessKey);
    const res = await fetch(url, { method: "GET", headers });
    if (res.status === 404 || !res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return { Body: Buffer.from(arrayBuffer) };
  } catch (err: any) {
    console.warn(`[R2 getObject failed] ${params.Key}:`, err.message);
    return null;
  }
}

async function putR2Object(
  config: R2Config,
  params: {
    Key: string;
    Body: any;
    Metadata?: Record<string, string>;
  }
): Promise<Record<string, unknown>> {
  const url = `${config.baseBucketUrl}/${params.Key}`;
  const buffer = Buffer.isBuffer(params.Body) ? params.Body : Buffer.from(params.Body);
  const headers = signS3Request(
    "PUT",
    url,
    config.accessKeyId,
    config.secretAccessKey,
    buffer,
    params.Metadata
  );
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: buffer,
  });
  if (!res.ok) {
    throw new Error(`R2 putObject failed for ${params.Key}: HTTP ${res.status} ${res.statusText}`);
  }
  return {};
}

async function copyR2Object(
  config: R2Config,
  params: { CopySource: string; Key: string }
): Promise<Record<string, unknown>> {
  const url = `${config.baseBucketUrl}/${params.Key}`;
  const copySourceHeader = `/${config.bucket}/${params.CopySource}`;
  const headers = signS3Request(
    "PUT",
    url,
    config.accessKeyId,
    config.secretAccessKey,
    Buffer.from(""),
    { "x-amz-copy-source": copySourceHeader }
  );
  const res = await fetch(url, {
    method: "PUT",
    headers,
  });
  if (!res.ok) {
    throw new Error(
      `R2 copyObject failed (${params.CopySource} -> ${params.Key}): HTTP ${res.status}`
    );
  }
  return {};
}

async function deleteR2Object(
  config: R2Config,
  params: { Key: string }
): Promise<Record<string, unknown>> {
  const url = `${config.baseBucketUrl}/${params.Key}`;
  const headers = signS3Request("DELETE", url, config.accessKeyId, config.secretAccessKey);
  await fetch(url, { method: "DELETE", headers }).catch(() => {});
  return {};
}

export function createR2ClientFromEnv(): R2ClientInterface {
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET ?? "gridlock";

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return {
      putObject: async () => ({}),
      getObject: async () => null,
      copyObject: async () => ({}),
      deleteObject: async () => ({}),
    };
  }

  const cleanEndpoint = endpoint.replace(/\/+$/, "");
  const baseBucketUrl = cleanEndpoint.endsWith(`/${bucket}`)
    ? cleanEndpoint
    : `${cleanEndpoint}/${bucket}`;

  const config: R2Config = { baseBucketUrl, bucket, accessKeyId, secretAccessKey };

  const getObject = (params: { Key: string }) => getR2Object(config, params);
  const putObject = (params: { Key: string; Body: any; Metadata?: Record<string, string> }) =>
    putR2Object(config, params);
  const copyObject = (params: { CopySource: string; Key: string }) => copyR2Object(config, params);
  const deleteObject = (params: { Key: string }) => deleteR2Object(config, params);

  return {
    getObject,
    putObject,
    copyObject,
    deleteObject,
  };
}

// Auto-execute when run directly from command line
const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (scriptPath.endsWith("sync-state.ts") || scriptPath.endsWith("sync-state.js")) {
  const isHydrate = process.argv.includes("--hydrate");
  const isPublish = process.argv.includes("--publish");
  const targetDbPath = process.env.GRIDLOCK_DB_PATH ?? path.resolve(process.cwd(), "gridlock.db");
  const artifactsDir = process.env.ARTIFACTS_DIR ?? path.resolve(process.cwd(), ".artifacts");

  const r2Client = createR2ClientFromEnv();

  if (isHydrate) {
    hydrateStateFromR2({ r2Client, targetDbPath })
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
      console.log(
        `[sync-state] Target DB does not exist at ${targetDbPath}, creating schema before publish...`
      );
      createDatabase(targetDbPath).close();
    }
    publishStateToR2({ r2Client, localDbPath: targetDbPath, artifactsDir })
      .then(() => syncArtifactBlobsToR2({ r2Client, artifactsDir }))
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
