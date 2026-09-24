import type { Browser } from "playwright";
import type { SourceFamily } from "../schemas/common.js";

export interface RawExtractionResult {
  sourceFamily: SourceFamily;
  sourceUrl: string;
  contentType: string;
  byteSize: number;
  content: Buffer | string;
  connectorVersion: string;
}

export interface ExtractorOptions {
  browser?: Browser;
  url?: string;
  timeoutMs?: number;
}
