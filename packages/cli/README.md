# @poxi/cli

`poxi` from your terminal. Dependency-free, Node 18+.

## Install

```sh
npm install -g @poxi/cli
# or
npx @poxi/cli doctor
```

## Commands

```sh
# Generate a venue from a prompt
poxi venue create "12,000-seat indoor arena, 360° stage, 4 VIP boxes, step-free access"

# Inspect an event
poxi event get evt_123

# Lock seats (atomic, 600s TTL)
poxi hold evt_123 --seats A-12,A-13 --ttl 600

# Release them again
poxi release hold_456

# Check connectivity + config
poxi doctor
```

`poxi doctor` prints a small table and exits `1` when the API is unreachable:

```
OK    Node.js          v22.23.2
OK    POXI_API_URL     https://poxi.guru (default)
OK    POXI_API_KEY     not set (anonymous requests)
OK    API reachability GET /v1/health → 200 in 143ms
```

## Options

| Flag | Applies to | Meaning |
|---|---|---|
| `--json` | all | Print raw API JSON |
| `--api-url <url>` | all | Override API origin for this run |
| `--capacity <n>` | `venue create` | Target capacity |
| `--type <type>` | `venue create` | `arena`, `stadium`, `concert_hall`, `club`, `theatre`, `conference` |
| `--session <id>` | `venue create`, `hold` | Session id (holds are counted per session) |
| `--ttl <seconds>` | `hold` | 30–600, server caps at 600 |
| `--seats a,b,c` | `hold` | Seat ids, max 10 |

## Environment

| Variable | Default |
|---|---|
| `POXI_API_URL` | `https://poxi.guru` |
| `POXI_API_KEY` | unset — sent as `Authorization: Bearer …` when present |

## Exit codes

`0` success · `1` failure (API error, `409` seat conflict, unreachable API)

## License

MIT © 2026 Poxi / Hei33enberg
