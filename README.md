# POXI-OS

The public developer ecosystem for **[poxi.guru](https://poxi.guru)** — an AI-native 3D venue generator and event ticketing engine.

Describe an arena, stadium, concert hall or club in plain language. Poxi generates the 3D venue and seating plan, exposes a ticket hold engine (atomic seat locks, 600s TTL, no double-booking) and a **0% commission** checkout through Stripe Connect.

## 5-minute start

```sh
npx @poxi/mcp
```

That starts the POXI MCP server over stdio. Add it to your MCP client (Claude Desktop, Cursor, or any stdio MCP host):

```json
{
  "mcpServers": {
    "poxi": {
      "command": "npx",
      "args": ["-y", "@poxi/mcp"],
      "env": { "POXI_API_URL": "https://poxi.guru" }
    }
  }
}
```

Then ask your agent for the first prompt:

> Create a 12,000-seat indoor arena with a 360° stage, 4 VIP boxes and accessible seating on every level.

The agent calls `poxi_create_venue`, which posts to `POST /v1/agent/chat` and returns the generated venue — 3D geometry, seating map and event scaffolding.

Set `POXI_API_KEY` if your account has one — it is sent as a bearer token on every call.

## What is open source, what is hosted

| | MIT open source (this repo) | Hosted service (poxi.guru) |
|---|---|---|
| MCP server `@poxi/mcp` | ✅ | — |
| TypeScript/JS SDK `@poxi/sdk` | ✅ | — |
| CLI `@poxi/cli` | ✅ | — |
| Agent skill `poxi-venue-architect` | ✅ | — |
| Protocol + API docs | ✅ | — |
| Venue generation model | — | ✅ |
| Hold engine (atomic locks, 600s TTL) | — | ✅ |
| Checkout / Stripe Connect payouts | — | ✅ |
| Gate Scanner PWA (`/scanner`) | — | ✅ |
| Shopify Theme App Extension | — | ✅ |

You can read, fork and self-host the clients. The generation, hold and payment services run on the hosted platform at `https://poxi.guru` (app: `https://poxi-guru.fly.dev`).

## Packages

| Package | What it does |
|---|---|
| [`@poxi/mcp`](packages/mcp) | MCP server: 7 tools over stdio, zero SDK dependencies |
| [`@poxi/sdk`](packages/sdk) | Thin `fetch` REST client with JSDoc types |
| [`@poxi/cli`](packages/cli) | `poxi venue create`, `poxi doctor` |
| [`skills/poxi-venue-architect`](skills/poxi-venue-architect/SKILL.md) | Agent skill for building and editing venues |

## Docs

- [Protocol: the ticket hold engine](docs/protocol.md) — 600s TTL, `409` conflicts, idempotency, 10 holds per session, 0% commission
- [API reference](docs/api.md) — every `/v1` endpoint used by these clients

## Links

- Product: https://poxi.guru
- Live app: https://poxi-guru.fly.dev
- Gate Scanner PWA: https://poxi.guru/scanner
- MCP registry entry: [distribution/server.json](distribution/server.json)

## Status

Early. `@poxi/mcp`, `@poxi/sdk` and `@poxi/cli` are version `0.1.0` and the REST API is `v1`. Nothing here is published to a registry by this repository; the installers and `npx` commands assume the packages are published.

## License

MIT © 2026 Poxi / Hei33enberg. See [LICENSE](LICENSE).
