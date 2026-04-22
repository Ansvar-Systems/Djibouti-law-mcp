/**
 * Rate-limited HTTP client for JORD (Journal Officiel de la République de Djibouti).
 *
 * - 500ms minimum delay between requests (respect the government server)
 * - User-Agent header identifying the MCP
 * - Fetches WordPress REST API JSON and article HTML from journalofficiel.dj
 * - Source: https://www.journalofficiel.dj/wp-json/wp/v2/
 * - No auth needed (public Journal Officiel)
 */

const USER_AGENT =
  'djibouti-law-mcp/1.0 (https://github.com/Ansvar-Systems/Djibouti-law-mcp; hello@ansvar.eu)';
const MIN_DELAY_MS = 500;

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export interface FetchResult {
  status: number;
  body: string;
  headers: Record<string, string>;
  contentType: string;
  url: string;
}

/**
 * Fetch a URL with rate limiting and proper headers.
 * Retries up to 3 times on 429/5xx errors with exponential backoff.
 */
export async function fetchWithRateLimit(url: string, maxRetries = 3): Promise<FetchResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateLimit();

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json, text/html, */*',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
      });
    } catch (err) {
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        console.log(
          `  Network error for ${url}: ${(err as Error).message}; retrying in ${backoff}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw err;
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        console.log(`  HTTP ${response.status} for ${url}, retrying in ${backoff}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
    }

    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return {
      status: response.status,
      body,
      headers,
      contentType: response.headers.get('content-type') ?? '',
      url: response.url,
    };
  }

  throw new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
}

/** Fetch and parse JSON from the JORD WP REST API. */
export async function fetchJson<T = unknown>(
  url: string,
): Promise<{ data: T; result: FetchResult }> {
  const result = await fetchWithRateLimit(url);
  if (result.status !== 200) {
    throw new Error(`HTTP ${result.status} for ${url}`);
  }
  return { data: JSON.parse(result.body) as T, result };
}
