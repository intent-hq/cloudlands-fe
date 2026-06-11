#!/usr/bin/env tsx

/**
 * Memory Events CLI
 *
 * Query memory events captured by the instrumentation.
 * Uses built-in JSONL summaries for common commands; DuckDB is optional for custom queries.
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

interface MemoryEvent {
  ts?: string;
  event?: string;
  agentId?: string | null;
  heapUsedMB?: number;
  deltaMB?: number;
  context?: unknown;
}

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
    return execSync(`duckdb -c ${JSON.stringify(fullQuery)}`, { encoding: 'utf-8' });
  } catch (err: any) {
    return `DuckDB error: ${err.message}`;
  }
}

function loadEvents(): MemoryEvent[] {
  if (!fileExists()) return [];
  const lines = fs.readFileSync(EVENTS_PATH, 'utf-8').split('\n').filter(Boolean);
  const events: MemoryEvent[] = [];
  let invalid = 0;
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      invalid++;
    }
  }
  if (invalid > 0) console.error(`Skipped ${invalid} invalid memory event line(s).`);
  return events;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isNumber(value: number | undefined): value is number {
  return value != null;
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function printRows(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log('No memory events found. Run the app to generate events.');
    return;
  }
  const columns = Object.keys(rows[0]);
  console.log(columns.join('\t'));
  for (const row of rows) {
    console.log(columns.map((column) => formatValue(row[column])).join('\t'));
  }
}

function cmdRecent(count = 20) {
  const rows = loadEvents()
    .slice(-count)
    .reverse()
    .map(({ ts, event, agentId, heapUsedMB, deltaMB, context }) => ({
      ts,
      event,
      agentId,
      heapUsedMB,
      deltaMB,
      context,
    }));
  printRows(rows);
}

function cmdSummary() {
  console.log('=== Memory Events Summary ===\n');
  const events = loadEvents();
  const heaps = events.map((event) => numberValue(event.heapUsedMB)).filter(isNumber);
  const growth = events.reduce((sum, event) => sum + Math.max(numberValue(event.deltaMB) || 0, 0), 0);
  printRows([{
    total_events: events.length,
    min_heap_mb: heaps.length ? Math.min(...heaps) : undefined,
    max_heap_mb: heaps.length ? Math.max(...heaps) : undefined,
    avg_heap_mb: heaps.length ? heaps.reduce((sum, value) => sum + value, 0) / heaps.length : undefined,
    total_growth_mb: growth,
  }]);

  console.log('\n=== Events by Type ===\n');
  const byType = new Map<string, { count: number; deltaTotal: number; deltaCount: number }>();
  for (const event of events) {
    const key = event.event || '(unknown)';
    const current = byType.get(key) || { count: 0, deltaTotal: 0, deltaCount: 0 };
    current.count++;
    const delta = numberValue(event.deltaMB);
    if (delta != null) {
      current.deltaTotal += delta;
      current.deltaCount++;
    }
    byType.set(key, current);
  }
  printRows([...byType.entries()]
    .map(([event, stats]) => ({
      event,
      count: stats.count,
      avg_delta_mb: stats.deltaCount ? stats.deltaTotal / stats.deltaCount : undefined,
    }))
    .sort((a, b) => Number(b.count) - Number(a.count)));
}

function cmdTrend() {
  let cumulative = 0;
  printRows(loadEvents().map(({ ts, event, heapUsedMB, deltaMB }) => {
    cumulative += numberValue(deltaMB) || 0;
    return { ts, event, heapUsedMB, deltaMB, cumulative_delta_mb: cumulative };
  }));
}

function cmdByAgent() {
  const byAgent = new Map<string, { events: number; heaps: number[]; growth: number }>();
  for (const event of loadEvents()) {
    if (!event.agentId) continue;
    const current = byAgent.get(event.agentId) || { events: 0, heaps: [], growth: 0 };
    current.events++;
    const heap = numberValue(event.heapUsedMB);
    if (heap != null) current.heaps.push(heap);
    current.growth += Math.max(numberValue(event.deltaMB) || 0, 0);
    byAgent.set(event.agentId, current);
  }
  printRows([...byAgent.entries()]
    .map(([agentId, stats]) => ({
      agentId,
      events: stats.events,
      min_heap: stats.heaps.length ? Math.min(...stats.heaps) : undefined,
      max_heap: stats.heaps.length ? Math.max(...stats.heaps) : undefined,
      growth_mb: stats.growth,
    }))
    .sort((a, b) => Number(b.growth_mb) - Number(a.growth_mb)));
}

function cmdLeaks(threshold = 1) {
  console.log(`Showing events with delta > ${threshold}MB:\n`);
  printRows(loadEvents()
    .filter((event) => (numberValue(event.deltaMB) || 0) > threshold)
    .sort((a, b) => (numberValue(b.deltaMB) || 0) - (numberValue(a.deltaMB) || 0))
    .slice(0, 50)
    .map(({ ts, event, agentId, heapUsedMB, deltaMB, context }) => ({
      ts,
      event,
      agentId,
      heapUsedMB,
      deltaMB,
      context,
    })));
}

function cmdAround(eventType: string) {
  const events = loadEvents();
  const rows: Record<string, unknown>[] = [];
  events.forEach((event, index) => {
    if (event.event !== eventType) return;
    events.slice(Math.max(0, index - 3), index + 4).forEach((nearby) => {
      rows.push({
        ts: nearby.ts,
        event: nearby.event,
        agentId: nearby.agentId,
        heapUsedMB: nearby.heapUsedMB,
        deltaMB: nearby.deltaMB,
      });
    });
  });
  printRows(rows);
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
