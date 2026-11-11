/**
 * @poxi/sdk — thin fetch wrapper over the Poxi REST API.
 *
 * Zero dependencies. Node 18+, Bun, Deno, or any runtime with global fetch.
 *
 * @example
 * import { PoxiClient } from '@poxi/sdk';
 * const poxi = new PoxiClient({ apiKey: process.env.POXI_API_KEY });
 * const venue = await poxi.createVenue({ prompt: '8,000-seat arena, 360 stage' });
 */

export const DEFAULT_API_URL = 'https://poxi.guru';
export const SDK_VERSION = '0.1.0';

export class PoxiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, body?: any, request?: { method: string, path: string } }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'PoxiError';
    this.status = info.status ?? null;
    this.code = info.code ?? null;
    this.body = info.body ?? null;
    this.request = info.request ?? null;
  }
}

export class PoxiClient {
  /**
   * @param {{ apiKey?: string, baseUrl?: string, timeoutMs?: number, fetch?: typeof fetch, headers?: Record<string,string> }} [options]
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_API_URL).replace(/\/+$/, '');
    this.apiKey = options.apiKey || null;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fetchImpl = options.fetch || globalThis.fetch;
    this.defaultHeaders = options.headers || {};

    if (typeof this.fetchImpl !== 'function') {
      throw new PoxiError('No fetch implementation available. Use Node 18+ or pass options.fetch.');
    }
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {object} [body]
   * @param {{ query?: Record<string, unknown>, timeoutMs?: number, idempotencyKey?: string, signal?: AbortSignal }} [options]
   * @returns {Promise<any>}
   */
  async request(method, path, body, options = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
    }

    /** @type {Record<string,string>} */
    const headers = {
      accept: 'application/json',
      'user-agent': `poxi-sdk/${SDK_VERSION}`,
      ...this.defaultHeaders,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      throw new PoxiError(`Network error on ${method} ${path}: ${cause && cause.message ? cause.message : String(cause)}`, {
        request: { method, path },
      });
    }

    const raw = await response.text();
    let data = raw || null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        /* keep text */
      }
    }

    if (!response.ok) {
      const detail = data && typeof data === 'object' && data.error
        ? (typeof data.error === 'string' ? data.error : data.error.message || JSON.stringify(data.error))
        : response.statusText;
      throw new PoxiError(`Poxi API ${response.status} on ${method} ${path}: ${detail}`, {
        status: response.status,
        code: data && typeof data === 'object' ? data.code : undefined,
        body: data,
        request: { method, path },
      });
    }

    return data;
  }

  /**
   * Generate a 3D venue from a prompt.
   * @param {import('./types.js').CreateVenueInput} input
   * @returns {Promise<import('./types.js').VenueResult>}
   */
  createVenue(input) {
    if (!input || typeof input.prompt !== 'string' || input.prompt.trim() === '') {
      throw new PoxiError('createVenue requires a non-empty "prompt"');
    }
    return this.request('POST', '/v1/agent/chat', { ...input, prompt: input.prompt.trim() }, { timeoutMs: 120000 });
  }

  /** @param {string} eventId */
  getEvent(eventId) {
    return this.request('GET', `/v1/events/${encodeURIComponent(eventId)}`);
  }

  /**
   * @param {import('./types.js').HoldInput} input
   * @returns {Promise<import('./types.js').Hold>}
   */
  holdSeats(input) {
    const { eventId, seats, sessionId, ttlSeconds, idempotencyKey } = input || {};
    if (!eventId) throw new PoxiError('holdSeats requires "eventId"');
    if (!Array.isArray(seats) || seats.length === 0) throw new PoxiError('holdSeats requires a non-empty "seats" array');
    if (seats.length > 10) throw new PoxiError('holdSeats accepts at most 10 seats per call');

    /** @type {Record<string, unknown>} */
    const body = { eventId, seats };
    if (sessionId) body.sessionId = sessionId;
    if (ttlSeconds !== undefined) body.ttlSeconds = ttlSeconds;

    return this.request('POST', '/v1/holds', body, { idempotencyKey });
  }

  /** @param {string} holdId */
  releaseHold(holdId) {
    return this.request('DELETE', `/v1/holds/${encodeURIComponent(holdId)}`);
  }

  /**
   * @param {import('./types.js').CheckoutInput} input
   * @returns {Promise<{ checkoutUrl: string, orderId?: string, amount?: number, currency?: string }>}
   */
  checkout(input) {
    const { holdId, ...rest } = input || {};
    if (!holdId) throw new PoxiError('checkout requires "holdId"');
    return this.request('POST', '/v1/checkout', { holdId, ...rest });
  }

  /**
   * @param {import('./types.js').ScanInput} input
   * @returns {Promise<{ status: 'valid'|'already_used'|'invalid', seat?: string, ticketId?: string }>}
   */
  scanTicket(input) {
    const { ticketCode, ...rest } = input || {};
    if (!ticketCode) throw new PoxiError('scanTicket requires "ticketCode"');
    return this.request('POST', '/v1/tickets/scan', { ticketCode, ...rest });
  }

  /**
   * @param {{ eventId?: string, from?: string, to?: string }} [query]
   */
  getMetrics(query = {}) {
    return this.request('GET', '/v1/metrics', undefined, { query });
  }

  /** Cheap reachability probe used by `poxi doctor`. */
  async ping() {
    const started = Date.now();
    const data = await this.request('GET', '/v1/health', undefined, { timeoutMs: 10000 });
    return { ok: true, latencyMs: Date.now() - started, data };
  }
}

export default PoxiClient;
