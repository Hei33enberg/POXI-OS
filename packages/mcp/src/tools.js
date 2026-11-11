/**
 * Tool definitions for @poxi/mcp.
 *
 * Every tool maps 1:1 onto a hosted REST endpoint under /v1 unless
 * POXI_API_URL points at a self-hosted-compatible deployment.
 */
import { poxiRequest } from './http.js';

export class ToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolInputError';
  }
}

function requireString(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(`"${key}" is required and must be a non-empty string`);
  }
  return value.trim();
}

function requireStringArray(args, key, { min = 1, max = 10 } = {}) {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolInputError(`"${key}" is required and must be a non-empty array of seat ids`);
  }
  if (value.length < min || value.length > max) {
    throw new ToolInputError(`"${key}" must contain between ${min} and ${max} seat ids (got ${value.length})`);
  }
  return value.map((seat) => {
    if (typeof seat !== 'string' || seat.trim() === '') {
      throw new ToolInputError(`"${key}" must only contain non-empty strings`);
    }
    return seat.trim();
  });
}

function encodeId(id, key) {
  const value = requireString({ [key]: id }, key);
  return encodeURIComponent(value);
}

/** @type {Array<{name:string,title:string,description:string,inputSchema:object,handler:Function}>} */
export const tools = [
  {
    name: 'poxi_create_venue',
    title: 'Create venue',
    description:
      'Generate a 3D venue (arena, stadium, concert hall or club) from a natural-language prompt. Returns the venue geometry, seating plan and event scaffolding. Wraps POST /v1/agent/chat.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'What to build, in plain language. Example: "12,000-seat indoor arena, 360 degree stage, 4 VIP boxes, step-free access on every level".',
        },
        venueType: {
          type: 'string',
          description: 'Optional explicit type when the prompt is ambiguous.',
          enum: ['arena', 'stadium', 'concert_hall', 'club', 'theatre', 'conference'],
        },
        capacity: {
          type: 'integer',
          description: 'Target seat capacity. Overrides any capacity mentioned in the prompt.',
          minimum: 1,
          maximum: 200000,
        },
        sessionId: {
          type: 'string',
          description: 'Conversation id to continue an existing venue-building session.',
        },
      },
      required: ['prompt'],
      additionalProperties: true,
    },
    async handler(args) {
      const prompt = requireString(args, 'prompt');
      const body = { prompt };
      if (args.venueType) body.venueType = args.venueType;
      if (args.capacity !== undefined) body.capacity = args.capacity;
      if (args.sessionId) body.sessionId = args.sessionId;
      return poxiRequest('POST', '/v1/agent/chat', body, { timeoutMs: 120000 });
    },
  },
  {
    name: 'poxi_get_event',
    title: 'Get event',
    description: 'Fetch a single event with its venue, seating map, pricing tiers and availability. Wraps GET /v1/events/:id.',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Event id returned by poxi_create_venue or listed in the dashboard.' },
      },
      required: ['eventId'],
      additionalProperties: false,
    },
    async handler(args) {
      const id = encodeId(args.eventId, 'eventId');
      return poxiRequest('GET', `/v1/events/${id}`);
    },
  },
  {
    name: 'poxi_hold_seats',
    title: 'Hold seats',
    description:
      'Atomically lock seats for an event. Locks expire after 600 seconds. A seat already locked by another buyer returns HTTP 409. Retries with the same idempotencyKey are safe. Limit: 10 holds per session. Wraps POST /v1/holds.',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Event to hold seats for.' },
        seats: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 10,
          description: 'Seat ids, e.g. ["A-12","A-13"].',
        },
        sessionId: { type: 'string', description: 'Buyer session id. Holds are counted per session (max 10).' },
        ttlSeconds: {
          type: 'integer',
          description: 'Requested TTL in seconds. Capped at 600 by the server.',
          minimum: 30,
          maximum: 600,
        },
        idempotencyKey: {
          type: 'string',
          description: 'Optional client-generated key so a retried hold returns the original hold instead of double-locking.',
        },
      },
      required: ['eventId', 'seats'],
      additionalProperties: false,
    },
    async handler(args) {
      const body = {
        eventId: requireString(args, 'eventId'),
        seats: requireStringArray(args, 'seats', { min: 1, max: 10 }),
      };
      if (args.sessionId) body.sessionId = args.sessionId;
      if (args.ttlSeconds !== undefined) body.ttlSeconds = args.ttlSeconds;
      return poxiRequest('POST', '/v1/holds', body, { idempotencyKey: args.idempotencyKey });
    },
  },
  {
    name: 'poxi_release_hold',
    title: 'Release hold',
    description: 'Release a hold early and return its seats to inventory. Wraps DELETE /v1/holds/:id.',
    inputSchema: {
      type: 'object',
      properties: {
        holdId: { type: 'string', description: 'Hold id returned by poxi_hold_seats.' },
      },
      required: ['holdId'],
      additionalProperties: false,
    },
    async handler(args) {
      const id = encodeId(args.holdId, 'holdId');
      return poxiRequest('DELETE', `/v1/holds/${id}`);
    },
  },
  {
    name: 'poxi_checkout',
    title: 'Checkout',
    description:
      'Turn a hold into a paid order through Stripe Connect at 0% ticket commission. Returns a Stripe Checkout URL. Wraps POST /v1/checkout.',
    inputSchema: {
      type: 'object',
      properties: {
        holdId: { type: 'string', description: 'Active hold id. The hold must not have expired (600s TTL).' },
        email: { type: 'string', description: 'Buyer email for the ticket delivery.' },
        quantity: { type: 'integer', description: 'Optional number of seats to check out from the hold.', minimum: 1 },
        successUrl: { type: 'string', description: 'Redirect after payment.' },
        cancelUrl: { type: 'string', description: 'Redirect after cancellation.' },
      },
      required: ['holdId'],
      additionalProperties: false,
    },
    async handler(args) {
      const body = { holdId: requireString(args, 'holdId') };
      if (args.email) body.email = args.email;
      if (args.quantity !== undefined) body.quantity = args.quantity;
      if (args.successUrl) body.successUrl = args.successUrl;
      if (args.cancelUrl) body.cancelUrl = args.cancelUrl;
      return poxiRequest('POST', '/v1/checkout', body);
    },
  },
  {
    name: 'poxi_scan_ticket',
    title: 'Scan ticket',
    description:
      'Validate a ticket at the gate for the Gate Scanner PWA (/scanner). Returns valid / already_used / invalid plus the seat assignment. Wraps POST /v1/tickets/scan.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketCode: { type: 'string', description: 'Ticket code or signed QR payload.' },
        eventId: { type: 'string', description: 'Event the gate is admitting for.' },
        gate: { type: 'string', description: 'Optional gate or door label, recorded on the scan.' },
      },
      required: ['ticketCode'],
      additionalProperties: false,
    },
    async handler(args) {
      const body = { ticketCode: requireString(args, 'ticketCode') };
      if (args.eventId) body.eventId = args.eventId;
      if (args.gate) body.gate = args.gate;
      return poxiRequest('POST', '/v1/tickets/scan', body);
    },
  },
  {
    name: 'poxi_get_metrics',
    title: 'Get metrics',
    description:
      'Read sell-through, revenue, hold contention and scan throughput for an event or the whole account. Wraps GET /v1/metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Limit metrics to one event. Omit for account-wide metrics.' },
        from: { type: 'string', description: 'ISO-8601 start of the window.' },
        to: { type: 'string', description: 'ISO-8601 end of the window.' },
      },
      additionalProperties: false,
    },
    async handler(args) {
      return poxiRequest('GET', '/v1/metrics', undefined, {
        query: { eventId: args.eventId, from: args.from, to: args.to },
      });
    },
  },
];

const byName = new Map(tools.map((tool) => [tool.name, tool]));

export function listTools() {
  return tools.map(({ name, title, description, inputSchema }) => ({
    name,
    title,
    description,
    inputSchema,
  }));
}

export function getTool(name) {
  return byName.get(name) || null;
}
