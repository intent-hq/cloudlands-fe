#!/usr/bin/env tsx

/**
 * Memory Events CLI
 *
 * Query memory events captured by the instrumentation.
 * Uses DuckDB for efficient querying of JSONL data.
 *
 * Usage:
 *   pnpm memory-events                    # Show recent events
 *   pnpm memory-events summary            # Show summary stats
 *   pnpm memory-events trend              # Show heap trend over time
 *   pnpm memory-events by-agent           # Group by agent
 *   pnpm memory-events leaks              # Show potential leaks (positive deltas)
 *   pnpm memory-events around <event>     # Show events around a specific event type
 *   pnpm memory-events clear --confirm    # Clear the log file
 *   pnpm memory-events path               # Show log file path
 *   pnpm memory-events raw                # Show raw JSONL content
 *   pnpm memory-events duckdb <query>     # Run custom DuckDB query
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const EVENTS_PATH = path.resolve(process.cwd(), '.augment/memory/memory-events.jsonl');

function fileExists(): boolean {
  return fs.existsSync(EVENTS_PATH);
}

function duckdb(query: string): string {
  if (!fileExists()) {
    return 'No memory events file found. Run the app to generate events.';
  }
  try {
    // Replace placeholder with actual path
    const fullQuery = query.replace(/\$FILE/g, EVENTS_PATH);
    return execSync(`duckdb -c "${fullQuery}"`, { encoding: 'utf-8' });
  } catch (err: any) {
    return `DuckDB error: ${err.message}`;
  }
}

function cmdRecent(count = 20) {
  console.log(duckdb(`
    SELECT ts, event, agentId, heapUsedMB, deltaMB, context
    FROM read_json_auto('$FILE')
    ORDER BY ts DESC
    LIMIT ${count}
  `));
}

function cmdSummary() {
  console.log('=== Memory Events Summary ===\n');
  console.log(duckdb(`
    SELECT
      count(*) as total_events,
      min(heapUsedMB) as min_heap_mb,
      max(heapUsedMB) as max_heap_mb,
      avg(heapUsedMB)::DECIMAL(10,2) as avg_heap_mb,
      sum(CASE WHEN deltaMB > 0 THEN deltaMB ELSE 0 END)::DECIMAL(10,2) as total_growth_mb
    FROM read_json_auto('$FILE')
  `));

  console.log('\n=== Events by Type ===\n');
  console.log(duckdb(`
    SELECT event, count(*) as count, avg(deltaMB)::DECIMAL(10,2) as avg_delta_mb
    FROM read_json_auto('$FILE')
    GROUP BY event
    ORDER BY count DESC
  `));
}

function cmdTrend() {
  console.log(duckdb(`
    SELECT
      ts,
      event,
      heapUsedMB,
      deltaMB,
      SUM(COALESCE(deltaMB, 0)) OVER (ORDER BY ts) as cumulative_delta_mb
    FROM read_json_auto('$FILE')
    ORDER BY ts
  `));
}

function cmdByAgent() {
  console.log(duckdb(`
    SELECT
      agentId,
      count(*) as events,
      min(heapUsedMB) as min_heap,
      max(heapUsedMB) as max_heap,
      sum(CASE WHEN deltaMB > 0 THEN deltaMB ELSE 0 END)::DECIMAL(10,2) as growth_mb
    FROM read_json_auto('$FILE')
    WHERE agentId IS NOT NULL
    GROUP BY agentId
    ORDER BY growth_mb DESC
  `));
}

function cmdLeaks(threshold = 1) {
  console.log(`Showing events with delta > ${threshold}MB:\n`);
  console.log(duckdb(`
    SELECT ts, event, agentId, heapUsedMB, deltaMB, context
    FROM read_json_auto('$FILE')
    WHERE deltaMB > ${threshold}
    ORDER BY deltaMB DESC
    LIMIT 50
  `));
}

function cmdAround(eventType: string) {
  console.log(duckdb(`
    WITH events AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY ts) as rn
      FROM read_json_auto('$FILE')
    ),
    targets AS (
      SELECT rn FROM events WHERE event = '${eventType}'
    )
    SELECT e.ts, e.event, e.agentId, e.heapUsedMB, e.deltaMB
    FROM events e, targets t
    WHERE e.rn BETWEEN t.rn - 3 AND t.rn + 3
    ORDER BY e.ts
  `));
}

function cmdClear(confirm: boolean) {
  if (!confirm) {
    console.error('Use --confirm to clear the log file');
    process.exit(1);
  }
  if (fileExists()) {
    fs.unlinkSync(EVENTS_PATH);
    console.log('✅ Cleared memory events log');
  } else {
    console.log('No log file to clear');
  }
}

function cmdPath() {
  console.log(EVENTS_PATH);
  console.log(`Exists: ${fileExists()}`);
  if (fileExists()) {
    const stats = fs.statSync(EVENTS_PATH);
    console.log(`Size: ${(stats.size / 1024).toFixed(2)} KB`);
    const lines = fs.readFileSync(EVENTS_PATH, 'utf-8').split('\n').filter(Boolean).length;
    console.log(`Events: ${lines}`);
  }
}

function cmdRaw(count = 20) {
  if (!fileExists()) {
    console.log('No memory events file found.');
    return;
  }
  const lines = fs.readFileSync(EVENTS_PATH, 'utf-8').split('\n').filter(Boolean);
  lines.slice(-count).forEach(line => console.log(line));
}

function cmdCustom(query: string) {
  console.log(duckdb(query));
}

// Parse args
const [,, cmd = 'recent', ...rest] = process.argv;
const flags: Record<string, any> = {};
const args: string[] = [];

for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  } else {
    args.push(rest[i]);
  }
}

switch (cmd) {
  case 'recent': cmdRecent(Number(flags.count || flags.n || 20)); break;
  case 'summary': cmdSummary(); break;
  case 'trend': cmdTrend(); break;
  case 'by-agent': cmdByAgent(); break;
  case 'leaks': cmdLeaks(Number(flags.threshold || 1)); break;
  case 'around': cmdAround(args[0] || 'agent_turn_complete'); break;
  case 'clear': cmdClear(!!flags.confirm); break;
  case 'path': cmdPath(); break;
  case 'raw': cmdRaw(Number(flags.count || 20)); break;
  case 'duckdb': cmdCustom(args.join(' ')); break;
  default:
    console.log('Unknown command:', cmd);
    console.log('Commands: recent, summary, trend, by-agent, leaks, around, clear, path, raw, duckdb');
}
