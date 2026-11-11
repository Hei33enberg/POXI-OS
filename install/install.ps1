# POXI-OS installer (Windows / PowerShell)
#
#   powershell -ExecutionPolicy Bypass -File install\install.ps1
#
# Verifies Node.js, pulls @poxi/mcp through npx, prints the MCP client config.

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host 'POXI-OS — Poxi MCP server installer' -ForegroundColor Cyan
Write-Host '-----------------------------------'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js 18+ is required: https://nodejs.org' -ForegroundColor Red
    exit 1
}

$nodeVersion = (node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 18) {
    Write-Host "Node.js $nodeVersion found, 18+ required." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js v$nodeVersion OK"

if (-not $env:POXI_API_URL) { $env:POXI_API_URL = 'https://poxi.guru' }
Write-Host "API      $env:POXI_API_URL"

Write-Host 'Starting @poxi/mcp over stdio (handshake test)...'
$payload = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"poxi-install","version":"0.1.0"}}}'
$response = $payload | npx -y @poxi/mcp 2>$null

if ($LASTEXITCODE -ne 0 -or -not $response) {
    Write-Host 'npx @poxi/mcp did not start. Check your npm registry access.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'Add this to your MCP client config:' -ForegroundColor Green
Write-Host @'
{
  "mcpServers": {
    "poxi": {
      "command": "npx",
      "args": ["-y", "@poxi/mcp"],
      "env": { "POXI_API_URL": "https://poxi.guru" }
    }
  }
}
'@
Write-Host 'Usage: poxi_create_venue -> poxi_hold_seats -> poxi_checkout. Docs: https://poxi.guru'
Write-Host 'Run the server yourself any time with: npx @poxi/mcp'
