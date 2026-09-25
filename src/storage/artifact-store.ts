import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export interface StoredArtifactMetadata {
  sha256Hash: string;
  byteSize: number;
  storagePath: string;
}

export class ArtifactStore {
  constructor(private readonly baseDirectory: string = "./data/artifacts") {}

  /**
   * Computes the cryptographic SHA-256 hash of a raw uncompressed payload buffer or string.
   */
  public computeHash(content: Buffer | string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Persists a raw payload to content-addressed storage with gzip compression.
   * Path format: <baseDirectory>/<sourceFamily>/<hash>.<extension>
   */
  public store(
    sourceFamily: string,
    content: Buffer | string,
    extension: string = "html"
  ): StoredArtifactMetadata {
    const rawBuffer = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, "utf8");

    const sha256Hash = this.computeHash(rawBuffer);
    const byteSize = rawBuffer.length;

    const storagePath = join(
      this.baseDirectory,
      sourceFamily,
      `${sha256Hash}.${extension}`
    );

    mkdirSync(dirname(storagePath), { recursive: true });

    const compressed = gzipSync(rawBuffer);
    writeFileSync(storagePath, compressed);

    return {
      sha256Hash,
      byteSize,
      storagePath,
    };
  }

  /**
   * Retrieves a previously stored artifact by its storage path, decompressing if gzipped.
   */
  public retrieve(storagePath: string): Buffer {
    const diskBytes = readFileSync(storagePath);
    if (
      diskBytes.length >= 2 &&
      diskBytes[0] === 0x1f &&
      diskBytes[1] === 0x8b
    ) {
      return gunzipSync(diskBytes);
    }
    return diskBytes;
  }
}
