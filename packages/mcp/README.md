# @poxi/mcp

Model Context Protocol server for [Poxi](https://poxi.guru) — AI-native 3D venue generation and 0%-commission ticketing.

Hand-written JSON-RPC over stdio. **No MCP SDK, no runtime dependencies.**

## Run

```sh
npx @poxi/mcp
```

MCP client config:

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

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `POXI_API_URL` | `https://poxi.guru` | API origin. All tools call `${POXI_API_URL}/v1/...` |
| `POXI_API_KEY` | — | Sent as `Authorization: Bearer …` when set |

## Tools

| Tool | Endpoint | What it does |
|---|---|---|
| `poxi_create_venue` | `POST /v1/agent/chat` | Prompt → 3D venue + seating plan |
| `poxi_get_event` | `GET /v1/events/:id` | Event, venue, pricing, availability |
| `poxi_hold_seats` | `POST /v1/holds` | Atomic seat lock, 600s TTL, `409` on conflict |
| `poxi_release_hold` | `DELETE /v1/holds/:id` | Release seats early |
| `poxi_checkout` | `POST /v1/checkout` | Stripe Connect checkout, 0% commission |
| `poxi_scan_ticket` | `POST /v1/tickets/scan` | Gate validation for `/scanner` |
| `poxi_get_metrics` | `GET /v1/metrics` | Sell-through, revenue, hold contention |

Each tool returns the API JSON body both as `content[0].text` and as `structuredContent`.
API and validation failures set `isError: true` with the status and body preserved.

## Protocol surface

`initialize`, `ping`, `tools/list`, `tools/call`, plus `notifications/initialized`
and `notifications/cancelled`. Protocol versions accepted: `2024-11-05`,
`2025-03-26`, `2025-06-18` (falls back to `2024-11-05`).

Transport is newline-delimited JSON; `Content-Length` framing is also parsed.

## Smoke test

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node index.js
```

## License

MIT © 2026 Poxi / Hei33enberg
