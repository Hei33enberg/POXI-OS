/**
 * Tiny fetch helper for the CLI. Keeps @poxi/cli dependency-free.
 */
export const DEFAULT_API_URL = 'https://poxi.guru';
export const CLI_VERSION = '0.1.0';
export const USER_AGENT = `poxi-cli/${CLI_VERSION}`;

export class ApiError extends Error {
  constructor(message, { status = null, body = null, path = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export function apiBaseUrl() {
  return (process.env.POXI_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
}

export function hasApiKey() {
  return Boolean(process.env.POXI_API_KEY);
}

/**
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @param {{ timeoutMs?: number, query?: Record<string, unknown>, idempotencyKey?: string }} [options]
 */
export async function request(method, path, body, options = {}) {
  const url = new URL(`${apiBaseUrl()}${path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const headers = { accept: 'application/json', 'user-agent': USER_AGENT };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (hasApiKey()) headers.authorization = `Bearer ${process.env.POXI_API_KEY}`;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
    });
  } catch (cause) {
    throw new ApiError(`cannot reach ${url.origin}: ${cause && cause.message ? cause.message : String(cause)}`, {
      path,
    });
  }

  const text = await response.text();
  let data = text || null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* plain text response */
    }
  }

  if (!response.ok) {
    const detail = data && typeof data === 'object' && data.error
      ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
      : response.statusText;
    throw new ApiError(`HTTP ${response.status} ${response.statusText} — ${detail}`, {
      status: response.status,
      body: data,
      path,
    });
  }

  return data;
}

/**
 * Probe a path and time it. Used by `poxi doctor`.
 * @param {string} path
 */
export async function probe(path) {
  const started = Date.now();
  try {
    const data = await request('GET', path, undefined, { timeoutMs: 8000 });
    return { path, ok: true, status: 200, latencyMs: Date.now() - started, body: data };
  } catch (error) {
    return {
      path,
      ok: false,
      status: error.status ?? 0,
      latencyMs: Date.now() - started,
      error: error.message,
      body: error.body ?? null,
    };
  }
}
