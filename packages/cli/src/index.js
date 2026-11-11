#!/usr/bin/env node
/**
 * @poxi/cli — `poxi` command line.
 *
 *   poxi venue create "<prompt>"
 *   poxi doctor
 *   poxi event get <eventId>
 *   poxi hold <eventId> --seats A-12,A-13
 *   poxi release <holdId>
 */
import process from 'node:process';
import { ApiError, apiBaseUrl, hasApiKey, probe, request, CLI_VERSION } from './api.js';

const HELP = `poxi ${CLI_VERSION} — AI-native 3D venues and 0% commission ticketing

USAGE
  poxi <command> [options]

COMMANDS
  venue create <prompt>        Generate a 3D venue from a description
  event get <eventId>          Show an event with venue, pricing and availability
  hold <eventId> --seats <ids> Lock seats (600s TTL, atomic)
  release <holdId>             Release a hold early
  doctor                       Check API reachability and local config
  help                         Show this help

OPTIONS
  --json                       Print raw JSON
  --api-url <url>              Override the API origin (default ${'https://poxi.guru'})
  --capacity <n>               Target capacity for "venue create"
  --type <arena|stadium|concert_hall|club|theatre|conference>
  --session <id>               Session id for venue create / hold
  --ttl <seconds>              Hold TTL, 30-600 (server caps at 600)
  --seats <a,b,c>              Comma-separated seat ids
  -h, --help                   Show help
  -v, --version                Show version

ENV
  POXI_API_URL   API origin, default https://poxi.guru
  POXI_API_KEY   Optional bearer token

EXAMPLES
  poxi venue create "12,000-seat arena, 360 stage, 4 VIP boxes"
  poxi doctor
  poxi hold evt_123 --seats A-12,A-13 --ttl 600
`;

const VALUE_FLAGS = new Set(['--api-url', '--capacity', '--type', '--session', '--ttl', '--seats', '--prompt', '--email']);

function parseArgs(argv) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags[token.slice(0, eq)] = token.slice(eq + 1);
        continue;
      }
      if (VALUE_FLAGS.has(token)) {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith('--')) {
          throw new Error(`missing value for ${token}`);
        }
        flags[token] = next;
        index += 1;
        continue;
      }
      flags[token] = true;
      continue;
    }
    if (token === '-h') {
      flags['--help'] = true;
      continue;
    }
    if (token === '-v') {
      flags['--version'] = true;
      continue;
    }
    positionals.push(token);
  }

  return { flags, positionals };
}

function print(value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === 'string') {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message, code = 1) {
  process.stderr.write(`poxi: ${message}\n`);
  process.exitCode = code;
}

function describeVenue(result) {
  const plan = result.seatingPlan || result.seating_plan || {};
  const seatCount = Array.isArray(plan.seats) ? plan.seats.length : plan.capacity || result.capacity;
  const lines = [
    `Venue     ${result.name || result.venueName || result.venueId || '(unnamed)'}`,
    `venueId   ${result.venueId || result.venue_id || '—'}`,
  ];
  if (result.eventId) lines.push(`eventId   ${result.eventId}`);
  if (result.type) lines.push(`Type      ${result.type}`);
  if (seatCount) lines.push(`Seats     ${seatCount}`);
  if (result.summary) lines.push(`Summary   ${result.summary}`);
  lines.push('', 'Next: poxi event get <eventId>, then poxi hold <eventId> --seats A-12,A-13');
  return lines.join('\n');
}

async function commandVenueCreate(flags, positionals) {
  const prompt = flags['--prompt'] || positionals.join(' ').trim();
  if (!prompt) {
    fail('venue create needs a prompt, e.g. poxi venue create "8,000-seat arena with a 360 stage"');
    return;
  }

  const body = { prompt };
  if (flags['--capacity']) body.capacity = Number(flags['--capacity']);
  if (flags['--type']) body.venueType = flags['--type'];
  if (flags['--session']) body.sessionId = flags['--session'];

  process.stderr.write(`Generating venue at ${apiBaseUrl()} ...\n`);
  const result = await request('POST', '/v1/agent/chat', body, { timeoutMs: 180000 });

  if (flags['--json']) {
    print(result, true);
  } else {
    print(describeVenue(result || {}));
  }
}

async function commandEventGet(flags, positionals) {
  const eventId = positionals[0];
  if (!eventId) {
    fail('event get needs an event id');
    return;
  }
  const event = await request('GET', `/v1/events/${encodeURIComponent(eventId)}`);

  if (flags['--json']) {
    print(event, true);
    return;
  }

  const lines = [
    `Event     ${event.name || event.id || eventId}`,
    `eventId   ${event.id || eventId}`,
  ];
  if (event.startsAt) lines.push(`Starts    ${event.startsAt}${event.timezone ? ` (${event.timezone})` : ''}`);
  if (event.venueId) lines.push(`venueId   ${event.venueId}`);
  if (event.capacity !== undefined) lines.push(`Capacity  ${event.capacity}`);
  if (event.seatsAvailable !== undefined) lines.push(`Available ${event.seatsAvailable}`);
  if (Array.isArray(event.priceTiers)) {
    lines.push('Tiers');
    for (const tier of event.priceTiers) {
      lines.push(`  ${tier.name || tier.id}: ${tier.price} ${tier.currency || event.currency || ''}`.trimEnd());
    }
  }
  print(lines.join('\n'));
}

async function commandHold(flags, positionals) {
  const eventId = positionals[0];
  const seats = typeof flags['--seats'] === 'string'
    ? flags['--seats'].split(',').map((seat) => seat.trim()).filter(Boolean)
    : [];

  if (!eventId) {
    fail('hold needs an event id: poxi hold <eventId> --seats A-12,A-13');
    return;
  }
  if (seats.length === 0) {
    fail('hold needs --seats with at least one seat id');
    return;
  }
  if (seats.length > 10) {
    fail('hold accepts at most 10 seats per call');
    return;
  }

  const body = { eventId, seats };
  if (flags['--session']) body.sessionId = flags['--session'];
  if (flags['--ttl']) body.ttlSeconds = Number(flags['--ttl']);

  const hold = await request('POST', '/v1/holds', body);

  if (flags['--json']) {
    print(hold, true);
    return;
  }
  print([
    `holdId    ${hold.holdId || hold.id || '—'}`,
    `Seats     ${Array.isArray(hold.seats) ? hold.seats.join(', ') : seats.join(', ')}`,
    `Expires   ${hold.expiresAt || hold.expires_at || '—'} (TTL ${hold.ttlSeconds ?? 600}s)`,
    '',
    'Next: poxi release <holdId> or POST /v1/checkout',
  ].join('\n'));
}

async function commandRelease(flags, positionals) {
  const holdId = positionals[0];
  if (!holdId) {
    fail('release needs a hold id');
    return;
  }
  const result = await request('DELETE', `/v1/holds/${encodeURIComponent(holdId)}`);
  if (flags['--json']) {
    print(result, true);
    return;
  }
  print(`Released ${holdId}`);
}

async function commandDoctor(flags) {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node.js',
    ok: nodeMajor >= 18,
    detail: `v${process.versions.node}${nodeMajor >= 18 ? '' : ' — Node 18+ required for global fetch'}`,
  });

  const base = apiBaseUrl();
  checks.push({
    name: 'POXI_API_URL',
    ok: true,
    detail: `${base}${process.env.POXI_API_URL ? '' : ' (default)'}`,
  });

  checks.push({
    name: 'POXI_API_KEY',
    ok: true,
    detail: hasApiKey() ? 'set' : 'not set — requests sent unauthenticated',
  });

  let health = await probe('/v1/health');
  if (!health.ok && health.status === 404) health = await probe('/');

  checks.push({
    name: 'API reachability',
    ok: health.ok,
    detail: health.ok
      ? `GET ${health.path} → 200 in ${health.latencyMs}ms`
      : `GET ${health.path} failed: ${health.error || `HTTP ${health.status}`}`,
  });

  if (flags['--json']) {
    print({ apiUrl: base, node: process.versions.node, checks }, true);
  } else {
    for (const check of checks) {
      print(`${check.ok ? 'OK  ' : 'FAIL'}  ${check.name.padEnd(16)} ${check.detail}`);
    }
    print('');
    print(health.ok ? 'Environment looks usable.' : 'The API is not reachable from here. Check POXI_API_URL and your network.');
  }

  if (!health.ok) process.exitCode = 1;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
    return;
  }

  const { flags, positionals } = parsed;

  if (flags['--api-url']) process.env.POXI_API_URL = flags['--api-url'];
  if (flags['--version']) {
    print(`poxi ${CLI_VERSION}`);
    return;
  }
  if (flags['--help'] || positionals.length === 0 || positionals[0] === 'help') {
    print(HELP);
    return;
  }

  const [command, subcommand] = positionals;
  const rest = positionals.slice(2);

  try {
    if (command === 'venue') {
      if (subcommand !== 'create') {
        fail('unknown venue subcommand. Try: poxi venue create "12,000-seat arena"');
        return;
      }
      await commandVenueCreate(flags, rest);
      return;
    }
    if (command === 'event') {
      if (subcommand !== 'get') {
        fail('unknown event subcommand. Try: poxi event get <eventId>');
        return;
      }
      await commandEventGet(flags, rest);
      return;
    }
    if (command === 'hold') {
      await commandHold(flags, positionals.slice(1));
      return;
    }
    if (command === 'release') {
      await commandRelease(flags, positionals.slice(1));
      return;
    }
    if (command === 'doctor') {
      await commandDoctor(flags);
      return;
    }

    fail(`unknown command "${command}". Run "poxi help".`);
  } catch (error) {
    if (error instanceof ApiError) {
      fail(error.message);
      if (error.status === 409) {
        process.stderr.write('poxi: 409 means at least one seat is already held. Pick different seats.\n');
      }
      return;
    }
    fail(error && error.message ? error.message : String(error));
  }
}

main();
