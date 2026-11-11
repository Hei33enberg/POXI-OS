# The Poxi ticket hold protocol

A ticket hold is a temporary, exclusive reservation of one or more seats. It exists so a buyer can pay without the seat being taken from under them, and so inventory is released automatically when they walk away.

This document describes the behaviour every Poxi client (`@poxi/mcp`, `@poxi/sdk`, `@poxi/cli`) can rely on.

- **Base URL** — `https://poxi.guru`
- **Prefix** — `/v1`
- **Content type** — `application/json`
- **Auth** — `Authorization: Bearer $POXI_API_KEY` when a key is configured.

## 1. Lifecycle

```
        hold_seats                 checkout                 scan
available ─────────► held ──────────────────► sold ─────────────► admitted
                      │
        TTL expiry or │ release_hold
                      ▼
                  available
```

| State | Meaning |
|---|---|
| `available` | Seat can be held |
| `held` | Seat locked by one holder until `expiresAt` |
| `sold` | Order paid; seat never returns to inventory |
| `admitted` | Ticket scanned at the gate; a second scan is refused |

## 2. Atomic locking

A hold either locks **all** requested seats or **none** of them. There is no partial hold.

Two concurrent requests for the same seat cannot both succeed. The engine resolves them in a single atomic step: the first writer wins, every other request receives `409 Conflict` naming the conflicting seats.

The practical consequence: **a client must never assume its hold won until it reads `holdId` from a `201` response.** Optimistic UI that paints seats as reserved before the response is a client bug, not an engine bug.

## 3. TTL — 600 seconds

- A hold lives for **600 seconds** from creation.
- `expiresAt` (ISO-8601, UTC) in the hold response is authoritative. Clients must not compute it from a local clock.
- `ttlSeconds` may be requested lower (minimum 30) but the server caps it at 600. A missing `ttlSeconds` means 600.
- When the TTL elapses, the seats return to `available` automatically. No release call is required.
- An expired hold cannot be checked out. `POST /v1/checkout` on an expired hold returns `410 Gone`.
- After the TTL elapses and the hold is cleaned up, an attempt to release it returns `404 Not Found`; treat that as "already free".

600 seconds is deliberately longer than a typical card authorisation and shorter than an abandoned-cart session. It is not configurable per event.

## 4. Conflict semantics — `409`

```http
POST /v1/holds
Content-Type: application/json

{ "eventId": "evt_123", "seats": ["A-12", "A-13"] }
```

If `A-13` is already held:

```http
HTTP/1.1 409 Conflict

{
  "error": "seats_unavailable",
  "conflicts": ["A-13"],
  "seats": ["A-12", "A-13"],
  "retryAfterMs": 0
}
```

Rules:

- `409` means **nothing was locked**. The caller holds no seats.
- `conflicts` lists only the seats that blocked the request.
- Do not retry the identical seat set — it will keep failing while the other holder is live. Re-read availability or choose different seats.
- `409` is not an error condition to be retried in a loop. It is normal contention feedback.

Other status codes:

| Status | Meaning for a hold request |
|---|---|
| `201` | Hold created, all seats locked |
| `400` | Malformed body, unknown seat id, or more than 10 seats |
| `401` | Key configured but invalid |
| `404` | Unknown event or seat |
| `409` | At least one seat unavailable — nothing locked |
| `429` | Rate limited; honour `Retry-After` |

## 5. Idempotency

Every mutating request accepts an `Idempotency-Key` header (`idempotencyKey` in the SDK/MCP tools).

- Two requests with the same key and the same body produce **one** hold. The second returns the original `201` payload, including the same `holdId`.
- The key is scoped to the account and the endpoint, and is retained for at least the hold TTL.
- Reusing a key with a **different** body returns `422 Unprocessable Entity` (`idempotency_key_reuse`). Do not mutate the body and keep the key.
- Use one key per logical cart. Generate it on the client, e.g. `crypto.randomUUID()`, and persist it across retries.

This is what makes a network timeout safe: retry with the same key, get the same hold.

## 6. Hold limits

- **10 holds per session.** A session is the `sessionId` sent on the hold request (or the authenticated account when omitted).
- A session counts *live* holds only; releasing a hold or letting it expire frees a slot.
- Exceeding the limit returns `429 Too Many Requests` with `error: "hold_limit_reached"`.
- **10 seats per hold.** Larger groups must split across multiple holds, each of which counts toward the 10-hold session limit. Plan group sales accordingly: 10 holds × 10 seats = 100 seats per session.
- Use one stable `sessionId` per buyer session. Creating a new session id to dodge the limit is discouraged and rate-limited.

## 7. Release

```http
DELETE /v1/holds/hold_456
```

- Returns `200` with `{ "released": true, "holdId": "hold_456" }`.
- Releasing is idempotent at the inventory level: releasing an already-released or expired hold returns `404` or `200` with `released: false`, and **never** frees seats belonging to a different hold.
- Release early and often. Relying on TTL expiry leaves seats idle for up to 10 minutes and depresses sell-through.

## 8. Checkout — 0% commission

```http
POST /v1/checkout

{ "holdId": "hold_456", "email": "buyer@example.com" }
```

Response:

```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/...",
  "orderId": "ord_789",
  "amount": 12000,
  "currency": "pln",
  "commission": 0
}
```

- Payment runs through **Stripe Connect**: the organizer is the connected account, Poxi is the platform.
- **Ticket commission is 0%.** The buyer pays the face value plus whatever the organizer configures (taxes, service fees they choose). Poxi does not add a per-ticket cut.
- `amount` is in the currency's minor unit (grosze, cents).
- Checkout must happen inside the hold TTL. The hold is converted to `sold` only when Stripe confirms payment; until then the seats stay locked to that hold.
- A failed or abandoned payment leaves the hold intact until TTL expiry, so the buyer can retry without losing their seats.

## 9. Scanning

```http
POST /v1/tickets/scan

{ "ticketCode": "POXI-...", "eventId": "evt_123", "gate": "Gate B" }
```

| `status` | Meaning | Gate action |
|---|---|---|
| `valid` | First scan, ticket for this event | Admit |
| `already_used` | Previously scanned; `scannedAt` and `gate` returned | Refuse |
| `invalid` | Unknown code, wrong event, refunded or voided | Refuse |

The Gate Scanner PWA at `/scanner` uses this endpoint. Scans are recorded, so `already_used` is reliable even across devices and offline reconnects.

## 10. What this protocol does not promise

- It does not promise that a hold survives a payment provider outage beyond its TTL.
- It does not promise FIFO fairness. Contention is resolved by atomic write order, not by queue position.
- It does not reserve seats across separate events; a seat belongs to exactly one event.
- It does not expose the internal locking implementation. Only the HTTP behaviour above is contractual.
