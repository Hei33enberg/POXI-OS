/**
 * Hand-rolled Model Context Protocol server (JSON-RPC 2.0 over stdio).
 *
 * Supported methods:
 *   initialize, notifications/initialized, ping,
 *   tools/list, tools/call, notifications/cancelled
 *
 * Transport: newline-delimited JSON (MCP stdio transport) and, for hosts that
 * still speak it, LSP-style Content-Length framing.
 */
import process from 'node:process';
import { writeSync } from 'node:fs';
import { apiBaseUrl } from './http.js';
import { getTool, listTools, ToolInputError } from './tools.js';

export const SERVER_NAME = 'poxi-mcp';
export const SERVER_VERSION = '0.1.0';
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

const INSTRUCTIONS = [
  'Poxi generates 3D venues and sells tickets at 0% commission.',
  'Start with poxi_create_venue and a concrete prompt (venue type, capacity, stage layout, accessibility).',
  'To sell: poxi_get_event -> poxi_hold_seats (600s TTL, HTTP 409 means a seat is taken) -> poxi_checkout.',
  'Release holds you will not use with poxi_release_hold. Max 10 holds per session.',
].join(' ');

function writeMessage(payload) {
  // Synchronous write: piped stdout is async in Node and can be dropped when
  // the host closes stdin right after a batch of requests.
  try {
    writeSync(1, `${JSON.stringify(payload)}\n`);
  } catch {
    // Broken pipe — the host went away. Nothing useful to do.
  }
}

function sendResult(id, result) {
  if (id === undefined || id === null) return;
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  if (id === undefined || id === null) return;
  const error = { code, message };
  if (data !== undefined) error.data = data;
  writeMessage({ jsonrpc: '2.0', id, error });
}

function log(message) {
  try {
    writeSync(2, `[poxi-mcp] ${message}\n`);
  } catch {
    // stderr unavailable; stay silent.
  }
}

function textResult(value, isError = false) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const result = { content: [{ type: 'text', text: payload }] };
  if (value && typeof value === 'object' && !Array.isArray(value)) result.structuredContent = value;
  if (isError) result.isError = true;
  return result;
}

async function handleToolsCall(id, params) {
  const name = params && params.name;
  if (typeof name !== 'string' || name === '') {
    sendError(id, -32602, 'Invalid params: "name" is required for tools/call');
    return;
  }

  const tool = getTool(name);
  if (!tool) {
    sendError(id, -32602, `Unknown tool: ${name}`);
    return;
  }

  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};

  try {
    const value = await tool.handler(args);
    sendResult(id, textResult(value === undefined ? { ok: true } : value));
  } catch (error) {
    if (error instanceof ToolInputError) {
      sendResult(id, textResult({ error: 'invalid_input', message: error.message, tool: name }, true));
      return;
    }
    const detail = typeof error.toJSON === 'function' ? error.toJSON() : {
      error: error && error.name ? error.name : 'Error',
      message: error && error.message ? error.message : String(error),
    };
    sendResult(id, textResult({ tool: name, ...detail }, true));
  }
}

async function handleRequest(message) {
  const { id, method, params } = message;

  switch (method) {
    case 'initialize': {
      const requested = params && params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
      sendResult(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
          title: 'Poxi',
        },
        instructions: INSTRUCTIONS,
      });
      return;
    }

    case 'ping':
      sendResult(id, {});
      return;

    case 'tools/list':
      sendResult(id, { tools: listTools() });
      return;

    case 'tools/call':
      await handleToolsCall(id, params);
      return;

    // Notifications (no response expected).
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/roots/list_changed':
      return;

    default:
      sendError(id, -32601, `Method not found: ${typeof method === 'string' ? method : String(method)}`);
  }
}

function handleMessage(message) {
  if (Array.isArray(message)) {
    for (const item of message) handleEnvelope(item);
    return;
  }
  handleEnvelope(message);
}

function handleEnvelope(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    sendError(message && message.id, -32600, 'Invalid Request: expected a JSON-RPC 2.0 object');
    return;
  }
  if (typeof message.method !== 'string') {
    // A response sent to us; nothing to do.
    return;
  }
  handleRequest(message).catch((error) => {
    log(`unhandled error on ${message.method}: ${error && error.stack ? error.stack : String(error)}`);
    sendError(message.id, -32603, 'Internal error');
  });
}

/**
 * Pull one framed message off the buffer.
 * @returns {{raw:string, consumed:number}|null}
 */
function takeFrame(buffer) {
  if (buffer.length === 0) return null;

  // Skip leading whitespace/newlines between frames.
  const trimmedStart = buffer.replace(/^[\r\n]+/, '');
  const leading = buffer.length - trimmedStart.length;
  if (trimmedStart.length === 0) return { raw: '', consumed: buffer.length };

  if (/^content-length:/i.test(trimmedStart)) {
    const headerEnd = trimmedStart.indexOf('\r\n\r\n');
    if (headerEnd === -1) return null;
    const header = trimmedStart.slice(0, headerEnd);
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) return { raw: '', consumed: leading + headerEnd + 4 };
    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (trimmedStart.length < bodyStart + length) return null;
    return {
      raw: trimmedStart.slice(bodyStart, bodyStart + length),
      consumed: leading + bodyStart + length,
    };
  }

  const newline = trimmedStart.indexOf('\n');
  if (newline === -1) return null;
  return {
    raw: trimmedStart.slice(0, newline).replace(/\r$/, ''),
    consumed: leading + newline + 1,
  };
}

export function run() {
  return new Promise((resolve) => {
    let buffer = '';
    let chain = Promise.resolve();
    let closed = false;

    const enqueue = (fn) => {
      chain = chain.then(fn).catch((error) => {
        log(`queue error: ${error && error.stack ? error.stack : String(error)}`);
      });
    };

    const drain = () => {
      for (;;) {
        const frame = takeFrame(buffer);
        if (!frame) return;
        buffer = buffer.slice(frame.consumed);
        if (!frame.raw.trim()) continue;

        let parsed;
        try {
          parsed = JSON.parse(frame.raw);
        } catch (error) {
          sendError(null, -32700, `Parse error: ${error.message}`);
          continue;
        }
        enqueue(() => handleMessage(parsed));
      }
    };

    const shutdown = (code = 0) => {
      if (closed) return;
      closed = true;
      chain.finally(() => {
        resolve();
        if (code !== 0) process.exit(code);
      });
    };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      drain();
    });
    process.stdin.on('end', () => {
      drain();
      shutdown(0);
    });
    process.stdin.on('error', (error) => {
      log(`stdin error: ${error.message}`);
      shutdown(1);
    });

    process.stdout.on('error', (error) => {
      // Host closed the pipe; exit quietly.
      log(`stdout error: ${error.message}`);
      shutdown(0);
    });

    process.on('SIGINT', () => shutdown(0));
    process.on('SIGTERM', () => shutdown(0));

    log(`ready v${SERVER_VERSION} → ${apiBaseUrl()}`);
  });
}
