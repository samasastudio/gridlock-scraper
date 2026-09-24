import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface StoredArtifactMetadata {
  sha256Hash: string;
  byteSize: number;
  storagePath: string;
}

export class ArtifactStore {
  constructor(private readonly baseDirectory: string = "./data/artifacts") {}

  /**
   * Computes the cryptographic SHA-256 hash of a raw payload buffer or string.
   */
  public computeHash(content: Buffer | string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Persists a raw payload to content-addressed storage.
   * Path format: <baseDirectory>/<sourceFamily>/<hash>.<extension>
   */
  public store(
    sourceFamily: string,
    content: Buffer | string,
    extension: string = "html"
  ): StoredArtifactMetadata {
    const sha256Hash = this.computeHash(content);
    const byteSize = Buffer.isBuffer(content)
      ? content.length
      : Buffer.byteLength(content, "utf8");

    const storagePath = join(
      this.baseDirectory,
      sourceFamily,
      `${sha256Hash}.${extension}`
    );

    mkdirSync(dirname(storagePath), { recursive: true });
    writeFileSync(storagePath, content);

    return {
      sha256Hash,
      byteSize,
      storagePath,
    };
  }

  /**
   * Retrieves a previously stored artifact by its storage path.
   */
  public retrieve(storagePath: string): Buffer {
    return readFileSync(storagePath);
  }
}
