/**
 * Minimal HTTP client for the hosted Poxi REST API.
 * All tools go through here so POXI_API_URL / POXI_API_KEY stay in one place.
 */

export const DEFAULT_API_URL = 'https://poxi.guru';

export class PoxiApiError extends Error {
  constructor(message, { status, body, path, method } = {}) {
    super(message);
    this.name = 'PoxiApiError';
    this.status = status;
    this.body = body;
    this.path = path;
    this.method = method;
  }

  toJSON() {
    return {
      error: this.name,
      message: this.message,
      status: this.status ?? null,
      method: this.method ?? null,
      path: this.path ?? null,
      body: this.body ?? null,
    };
  }
}

export function apiBaseUrl() {
  const raw = process.env.POXI_API_URL || DEFAULT_API_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * @param {string} method HTTP verb
 * @param {string} path   Path beginning with /v1
 * @param {object} [body] JSON body for POST/PATCH/PUT
 * @param {object} [options] { query, timeoutMs, idempotencyKey, signal }
 * @returns {Promise<any>} parsed JSON (or text) response body
 */
export async function poxiRequest(method, path, body, options = {}) {
  const { query, timeoutMs = 30000, idempotencyKey, signal } = options;
  const base = apiBaseUrl();
  let url = `${base}${path}`;

  if (query && typeof query === 'object') {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = {
    accept: 'application/json',
    'user-agent': 'poxi-mcp/0.1.0 (+https://poxi.guru)',
  };
  if (body !== undefined && body !== null) headers['content-type'] = 'application/json';
  if (process.env.POXI_API_KEY) headers.authorization = `Bearer ${process.env.POXI_API_KEY}`;
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const finalSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
      signal: finalSignal,
    });
  } catch (error) {
    const reason = error && error.name === 'TimeoutError'
      ? `request to ${method} ${path} timed out after ${timeoutMs}ms`
      : `request to ${method} ${path} failed: ${error && error.message ? error.message : String(error)}`;
    throw new PoxiApiError(reason, { path, method });
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = data && typeof data === 'object' && data.error
      ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
      : text.slice(0, 500) || response.statusText;
    throw new PoxiApiError(`Poxi API ${response.status} ${response.statusText} for ${method} ${path}: ${detail}`, {
      status: response.status,
      body: data,
      path,
      method,
    });
  }

  return data;
}
