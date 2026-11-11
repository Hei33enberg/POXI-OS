# Poxi API reference (`v1`)

- **Base URL** — `https://poxi.guru`
- **Live app** — `https://poxi-guru.fly.dev`
- **Prefix** — all endpoints below are under `/v1`
- **Format** — JSON in, JSON out
- **Auth** — `Authorization: Bearer $POXI_API_KEY` when you have a key

Every endpoint here is used by at least one client in this repo:

| Client | File |
|---|---|
| `@poxi/mcp` | [`packages/mcp/src/tools.js`](../packages/mcp/src/tools.js) |
| `@poxi/sdk` | [`packages/sdk/src/index.js`](../packages/sdk/src/index.js) |
| `@poxi/cli` | [`packages/cli/src/index.js`](../packages/cli/src/index.js) |

---

## `POST /v1/agent/chat`

Generate or modify a venue from natural language. This is the entry point for
everything else: it returns a venue with geometry and a seating plan, and an
event you can sell tickets for.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | yes | Description of the venue |
| `venueType` | string | no | `arena`, `stadium`, `concert_hall`, `club`, `theatre`, `conference` |
| `capacity` | integer | no | Target seats; overrides capacity in the prompt |
| `sessionId` | string | no | Continue an existing build session |

```bash
curl -s https://poxi.guru/v1/agent/chat \
  -H 'content-type: application/json' \
  -d '{"prompt":"12,000-seat indoor arena, 360 stage, 4 VIP boxes, step-free access"}'
```

**200**

```json
{
  "venueId": "ven_abc",
  "eventId": "evt_123",
  "name": "Arena 12K",
  "type": "arena",
  "capacity": 12000,
  "seatingPlan": {
    "sections": [{ "id": "floor", "name": "Floor", "seatCount": 2500 }],
    "seats": [{ "id": "A-12", "section": "lower-bowl", "row": "A", "number": "12", "status": "available" }],
    "capacity": 12000
  },
  "geometry": { "stage": { "type": "in_the_round" }, "levels": [] }
}
```

Generation is slower than the other endpoints — allow up to ~120s.

---

## `GET /v1/events/:id`

Event with venue, tiers and availability.

```bash
curl -s https://poxi.guru/v1/events/evt_123
```

**200**

```json
{
  "id": "evt_123",
  "name": "Arena 12K — Opening Night",
  "venueId": "ven_abc",
  "startsAt": "2026-12-31T20:00:00Z",
  "timezone": "Europe/Warsaw",
  "currency": "pln",
  "capacity": 12000,
  "seatsAvailable": 9412,
  "priceTiers": [{ "id": "t1", "name": "Floor", "price": 24900, "currency": "pln" }]
}
```

**404** — unknown event.

---

## `POST /v1/holds`

Atomically lock seats. See [protocol.md](protocol.md) for the full contract.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventId` | string | yes | |
| `seats` | string[] | yes | 1–10 seat ids |
| `sessionId` | string | no | Buyers are limited to 10 live holds per session |
| `ttlSeconds` | integer | no | 30–600, server caps at 600 |

**Headers** — `Idempotency-Key: <uuid>` (optional, strongly recommended on retry)

```bash
curl -s https://poxi.guru/v1/holds \
  -H 'content-type: application/json' \
  -H 'idempotency-key: 8f21c0de' \
  -d '{"eventId":"evt_123","seats":["A-12","A-13"],"sessionId":"sess_1"}'
```

**201**

```json
{
  "holdId": "hold_456",
  "eventId": "evt_123",
  "seats": ["A-12", "A-13"],
  "status": "active",
  "ttlSeconds": 600,
  "expiresAt": "2026-11-11T18:42:10Z"
}
```

**409** — nothing locked, `conflicts` lists the blocking seats.
**429** — hold limit reached (`hold_limit_reached`).

---

## `DELETE /v1/holds/:id`

```bash
curl -s -X DELETE https://poxi.guru/v1/holds/hold_456
```

**200** — `{ "released": true, "holdId": "hold_456" }`
**404** — unknown, expired or already released hold.

---

## `POST /v1/checkout`

Convert a hold into a paid order via Stripe Connect. 0% ticket commission.

**Body**

| Field | Type | Required |
|---|---|---|
| `holdId` | string | yes |
| `email` | string | no |
| `quantity` | integer | no |
| `successUrl` / `cancelUrl` | string | no |

```bash
curl -s https://poxi.guru/v1/checkout \
  -H 'content-type: application/json' \
  -d '{"holdId":"hold_456","email":"buyer@example.com"}'
```

**200**

```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/...",
  "orderId": "ord_789",
  "amount": 49800,
  "currency": "pln",
  "commission": 0
}
```

**410** — hold expired. **409** — hold already converted.

---

## `POST /v1/tickets/scan`

Gate validation, used by the Gate Scanner PWA at `/scanner`.

**Body**

| Field | Type | Required |
|---|---|---|
| `ticketCode` | string | yes |
| `eventId` | string | no |
| `gate` | string | no |

**200**

```json
{
  "status": "valid",
  "ticketId": "tkt_321",
  "eventId": "evt_123",
  "seat": "A-12",
  "scannedAt": "2026-12-31T19:04:11Z"
}
```

`status` is one of `valid`, `already_used`, `invalid`. A repeat scan returns
`already_used` with the original `scannedAt` and `gate`.

---

## `GET /v1/metrics`

Sell-through, revenue, hold contention and scan throughput.

**Query** — `eventId` (optional), `from`, `to` (ISO-8601)

```bash
curl -s 'https://poxi.guru/v1/metrics?eventId=evt_123'
```

```json
{
  "eventId": "evt_123",
  "capacity": 12000,
  "sold": 2588,
  "held": 146,
  "available": 9266,
  "revenue": 64471200,
  "currency": "pln",
  "commission": 0,
  "holdConflicts": 312,
  "scans": 1874
}
```

---

## `GET /v1/health`

Reachability probe. Used by `poxi doctor`.

```json
{ "status": "ok", "version": "v1" }
```

---

## Error envelope

```json
{
  "error": "seats_unavailable",
  "message": "One or more seats are already held",
  "conflicts": ["A-13"]
}
```

| Status | When |
|---|---|
| `400` | Malformed body or invalid field |
| `401` | Invalid API key |
| `404` | Unknown resource |
| `409` | Conflict (seat held, hold converted) |
| `410` | Hold expired |
| `422` | Idempotency key reused with a different body |
| `429` | Rate or hold limit exceeded — honour `Retry-After` |
| `5xx` | Retry with the same `Idempotency-Key` |

## Surface summary

| Surface | Location |
|---|---|
| REST API | `https://poxi.guru/v1` |
| Live app | `https://poxi-guru.fly.dev` |
| Gate Scanner PWA | `https://poxi.guru/scanner` |
| Shopify Theme App Extension | distributed through the Shopify admin for poxi.guru organizers |
