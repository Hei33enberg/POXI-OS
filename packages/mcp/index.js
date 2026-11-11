#!/usr/bin/env node
/**
 * @poxi/mcp — Model Context Protocol server for Poxi.
 *
 * Runs over stdio (newline-delimited JSON-RPC 2.0, with optional
 * Content-Length framing for LSP-style clients). No MCP SDK dependency.
 */
import { run } from './src/server.js';

run().catch((error) => {
  process.stderr.write(`[poxi-mcp] fatal: ${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
