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
    conditions.push(`applied_date >= '${params.startDate}'`);
  }
  if (params.endDate) {
    conditions.push(`applied_date <= '${params.endDate}'`);
  }

  const query = conditions.length > 0 ? `?$where=${conditions.join(" AND ")}` : "";
  const limitQuery = params.limit ? `${query ? "&" : "?"}$limit=${params.limit}` : "";
  return `${baseUrl}${query}${limitQuery}`;
}

/**
 * Executes a network fetch function with exponential backoff and jitter on HTTP 429 (ADR-0001).
 */
export async function fetchWithBackoff<T>(
  fetchFn: () => Promise<T>,
  options: BackoffOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 5000;

  let attempt = 0;
  while (true) {
    try {
      return await fetchFn();
    } catch (err: any) {
      attempt++;
      const is429 =
        err?.status === 429 ||
        err?.statusCode === 429 ||
        /429|rate limit/i.test(err?.message ?? "");

      if (attempt >= maxRetries || !is429) {
        throw err;
      }

      const jitter = Math.random() * 10;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + jitter, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
