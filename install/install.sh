#!/usr/bin/env sh
# POXI-OS installer (macOS / Linux)
#
#   sh install/install.sh
#
# Verifies Node.js, pulls @poxi/mcp through npx, prints the MCP client config.

set -eu

printf '\nPOXI-OS — Poxi MCP server installer\n'
printf -- '-----------------------------------\n'

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js 18+ is required: https://nodejs.org\n' >&2
  exit 1
fi

NODE_VERSION="$(node --version | tr -d 'v')"
NODE_MAJOR="$(printf '%s' "$NODE_VERSION" | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  printf 'Node.js %s found, 18+ required.\n' "$NODE_VERSION" >&2
  exit 1
fi
printf 'Node.js v%s OK\n' "$NODE_VERSION"

POXI_API_URL="${POXI_API_URL:-https://poxi.guru}"
export POXI_API_URL
printf 'API      %s\n' "$POXI_API_URL"

printf 'Starting @poxi/mcp over stdio (handshake test)...\n'
PAYLOAD='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"poxi-install","version":"0.1.0"}}}'

if ! printf '%s\n' "$PAYLOAD" | npx -y @poxi/mcp >/dev/null 2>&1; then
  printf 'npx @poxi/mcp did not start. Check your npm registry access.\n' >&2
  exit 1
fi

printf '\nAdd this to your MCP client config:\n'
cat <<'JSON'
{
  "mcpServers": {
    "poxi": {
      "command": "npx",
      "args": ["-y", "@poxi/mcp"],
      "env": { "POXI_API_URL": "https://poxi.guru" }
    }
  }
}
JSON

printf 'Usage: poxi_create_venue -> poxi_hold_seats -> poxi_checkout. Docs: https://poxi.guru\n'
printf 'Run the server yourself any time with: npx @poxi/mcp\n'
