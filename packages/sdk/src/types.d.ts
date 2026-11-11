/** Public types for @poxi/sdk. */

export type VenueType = 'arena' | 'stadium' | 'concert_hall' | 'club' | 'theatre' | 'conference';

export interface CreateVenueInput {
  /** Plain-language description of the venue to build. */
  prompt: string;
  venueType?: VenueType;
  capacity?: number;
  /** Continue an existing venue-building session. */
  sessionId?: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Seat {
  id: string;
  section?: string;
  row?: string;
  number?: string;
  level?: string;
  x?: number;
  y?: number;
  z?: number;
  priceTier?: string;
  accessible?: boolean;
  status?: 'available' | 'held' | 'sold';
}

export interface SeatingPlan {
  sections?: Array<{ id: string; name: string; seatCount?: number }>;
  seats?: Seat[];
  capacity?: number;
}

export interface VenueResult {
  venueId: string;
  eventId?: string;
  name?: string;
  type?: VenueType;
  seatingPlan?: SeatingPlan;
  /** Renderable geometry payload (sections, tiers, stage, sightlines). */
  geometry?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EventRecord {
  id: string;
  name?: string;
  venueId?: string;
  startsAt?: string;
  timezone?: string;
  currency?: string;
  capacity?: number;
  seatsAvailable?: number;
  priceTiers?: Array<{ id: string; name: string; price: number; currency?: string }>;
  [key: string]: unknown;
}

export interface HoldInput {
  eventId: string;
  /** Seat ids, max 10. */
  seats: string[];
  sessionId?: string;
  /** 30–600; the server caps at 600. */
  ttlSeconds?: number;
  idempotencyKey?: string;
}

export interface Hold {
  holdId: string;
  eventId: string;
  seats: string[];
  /** ISO-8601 expiry (600s TTL by default). */
  expiresAt: string;
  ttlSeconds?: number;
  status?: 'active' | 'released' | 'expired' | 'converted';
  [key: string]: unknown;
}

export interface CheckoutInput {
  holdId: string;
  email?: string;
  quantity?: number;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  commission?: number;
  [key: string]: unknown;
}

export interface ScanInput {
  ticketCode: string;
  eventId?: string;
  gate?: string;
}

export interface ScanResult {
  status: 'valid' | 'already_used' | 'invalid';
  seat?: string;
  ticketId?: string;
  eventId?: string;
  scannedAt?: string;
  [key: string]: unknown;
}

export interface MetricsQuery {
  eventId?: string;
  from?: string;
  to?: string;
}

export interface MetricsResult {
  [key: string]: unknown;
}

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export declare class PoxiError extends Error {
  status: number | null;
  code: string | null;
  body: unknown;
  request: { method: string; path: string } | null;
}

export declare class PoxiClient {
  constructor(options?: ClientOptions);
  readonly baseUrl: string;
  request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options?: { query?: Record<string, unknown>; timeoutMs?: number; idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<T>;
  createVenue(input: CreateVenueInput): Promise<VenueResult>;
  getEvent(eventId: string): Promise<EventRecord>;
  holdSeats(input: HoldInput): Promise<Hold>;
  releaseHold(holdId: string): Promise<{ released: boolean; holdId: string }>;
  checkout(input: CheckoutInput): Promise<CheckoutResult>;
  scanTicket(input: ScanInput): Promise<ScanResult>;
  getMetrics(query?: MetricsQuery): Promise<MetricsResult>;
  ping(): Promise<{ ok: true; latencyMs: number; data: unknown }>;
}

export default PoxiClient;
