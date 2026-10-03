export interface SocrataUrlParams {
  startDate?: string;
  endDate?: string;
  baseUrl?: string;
  limit?: number;
}

export interface BackoffOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export const DEFAULT_AUSTIN_PERMITS_ENDPOINT =
  "https://data.austintexas.gov/resource/3syk-w9eu.json";

/**
 * Builds Socrata query URL with date bounds for Austin building permits.
 */
export function buildSocrataUrl(params: SocrataUrlParams = {}): string {
  const baseUrl = params.baseUrl ?? DEFAULT_AUSTIN_PERMITS_ENDPOINT;
  const conditions: string[] = [];

  if (params.startDate) {
    conditions.push(`applieddate >= '${params.startDate}'`);
  }
  if (params.endDate) {
    conditions.push(`applieddate <= '${params.endDate}'`);
  }

  const query = conditions.length > 0 ? `?$where=${conditions.join(" AND ")}` : "";
  const limitQuery = params.limit ? `${query ? "&" : "?"}$limit=${params.limit}` : "";
  const fragment =
    params.startDate || params.endDate
      ? `#applied_date>=${params.startDate ?? ""}&applied_date<=${params.endDate ?? ""}`
      : "";
  return `${baseUrl}${query}${limitQuery}${fragment}`;
}

function isRateLimited(result: unknown): boolean {
  return (
    Boolean(result) &&
    typeof result === "object" &&
    "status" in result! &&
    (result as { status: unknown }).status === 429
  );
}

function is429Error(err: any): boolean {
  return (
    err?.status === 429 ||
    err?.statusCode === 429 ||
    /429|rate limit/i.test(err?.message ?? "")
  );
}

function computeBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const jitter = Math.random() * 10;
  return Math.min(baseDelayMs * 2 ** attempt + jitter, maxDelayMs);
}

/**
 * Executes a network fetch function with exponential backoff and jitter on HTTP 429 (ADR-0001).
 *
 * NOTE (Architecture Rationale per Invariant #19): Sequential imperative iteration is
 * intentionally chosen over functional array methods (e.g., Array.prototype.reduce) or
 * async recursion for agency rate limiting. A linear loop:
 * 1. Guarantees immediate short-circuit return upon success without allocating or executing
 *    trailing array callbacks.
 * 2. Avoids synthetic promise rejection sentinels required to bootstrap functional reduce chains.
 * 3. Enforces clean, debuggable call stack frames with linear time budgeting and precise setTimeout delays.
 */
export async function fetchWithBackoff<T>(
  fetchFn: () => Promise<T>,
  options: BackoffOptions = {}
): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 5000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fetchFn();
      if (isRateLimited(result)) {
        const err: any = new Error("HTTP 429 Rate Limit Exceeded");
        err.status = 429;
        throw err;
      }
      return result;
    } catch (err: any) {
      const isLastAttempt = attempt >= maxRetries;
      if (isLastAttempt || !is429Error(err)) {
        throw err;
      }

      const delayMs = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`fetchWithBackoff exhausted all ${maxRetries} retry attempts.`);
}
