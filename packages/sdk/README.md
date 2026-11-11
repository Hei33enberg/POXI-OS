# @poxi/sdk

Thin typed REST client for the [Poxi](https://poxi.guru) API. One class, global `fetch`, no dependencies.

## Install

```sh
npm install @poxi/sdk
```

## Use

```js
import { PoxiClient } from '@poxi/sdk';

const poxi = new PoxiClient({ apiKey: process.env.POXI_API_KEY });

// 1. Generate a venue from a prompt
const venue = await poxi.createVenue({
  prompt: '9,000-seat indoor arena, 360° stage, 4 VIP boxes, step-free access everywhere',
});

// 2. Lock seats (600s TTL, atomic, 409 if taken)
const hold = await poxi.holdSeats({
  eventId: venue.eventId,
  seats: ['A-12', 'A-13'],
  sessionId: 'buyer-session-1',
  idempotencyKey: 'cart-8f21',
});

// 3. Check out at 0% commission
const { checkoutUrl } = await poxi.checkout({ holdId: hold.holdId, email: 'buyer@example.com' });

// 4. Release if the buyer walks away
await poxi.releaseHold(hold.holdId);
```

## API

| Method | Endpoint |
|---|---|
| `createVenue(input)` | `POST /v1/agent/chat` |
| `getEvent(eventId)` | `GET /v1/events/:id` |
| `holdSeats(input)` | `POST /v1/holds` |
| `releaseHold(holdId)` | `DELETE /v1/holds/:id` |
| `checkout(input)` | `POST /v1/checkout` |
| `scanTicket(input)` | `POST /v1/tickets/scan` |
| `getMetrics(query)` | `GET /v1/metrics` |
| `ping()` | `GET /v1/health` |

Types live in [`src/types.d.ts`](src/types.d.ts).

## Errors

Every non-2xx response throws `PoxiError` with `status`, `code`, `body` and `request`.

```js
import { PoxiError } from '@poxi/sdk';

try {
  await poxi.holdSeats({ eventId, seats: ['A-12'] });
} catch (error) {
  if (error instanceof PoxiError && error.status === 409) {
    // seat already locked by someone else — pick another
  }
}
```

## Options

| Option | Default |
|---|---|
| `baseUrl` | `https://poxi.guru` |
| `apiKey` | `null` (sent as `Authorization: Bearer …`) |
| `timeoutMs` | `30000` (`createVenue` uses `120000`) |
| `fetch` | `globalThis.fetch` |

## License

MIT © 2026 Poxi / Hei33enberg
