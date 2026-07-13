#!/usr/bin/env tsx

/**
 * Agent Errors CLI
 *
 * Usage:
 *   pnpm agent-errors summary
 *   pnpm agent-errors list [--count 20] [--level error|warning|critical] [--source main|renderer|preload|logger|app-error]
 *   pnpm agent-errors get <error-id>
 *   pnpm agent-errors path
 *   pnpm agent-errors clear --confirm
 */

import fs from 'fs';
import path from 'path';

type AgentHints = {
  possibleCauses?: string[];
  suggestedFixes?: string[];
  relatedFiles?: string[];
  searchQueries?: string[];
};

type TrackedError = {
  id: string;
  timestamp?: string;
  source?: string;
  level?: 'error' | 'warning' | 'critical' | string;
  message: string;
  code?: string;
  stack?: string;
  component?: string;
  workspaceId?: string;
  userId?: string;
  context?: Record<string, any>;
  environment?: Record<string, any>;
  agentHints?: AgentHints;
  recentLogs?: any[];
};

const ERRORS_PATH = path.resolve(process.cwd(), '.augment/errors/tracked-errors.json');

function loadErrors(): TrackedError[] {
  try {
    const raw = fs.readFileSync(ERRORS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray((parsed as any).errors)) return (parsed as any).errors;
    return [];
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    console.error('Failed to read tracked errors:', err?.message || err);
    process.exit(1);
  }
}

function saveErrors(errors: TrackedError[]) {
  fs.mkdirSync(path.dirname(ERRORS_PATH), { recursive: true });
  fs.writeFileSync(ERRORS_PATH, JSON.stringify(errors, null, 2));
}

function formatLine(e: TrackedError): string {
  const ts = e.timestamp ? new Date(e.timestamp).toISOString() : '';
  const level = (e.level || 'error').toUpperCase();
  const src = e.source || 'unknown';
  const msg = e.message?.replace(/\s+/g, ' ').trim();
  return `${e.id || '(no-id)'} | ${level} | ${src} | ${ts} | ${msg}`;
}

function cmdSummary() {
  const errors = loadErrors();
  if (errors.length === 0) {
    console.log('✅ No tracked errors found.');
    console.log(`Errors file: ${ERRORS_PATH}`);
    return;
  }

  const byLevel = new Map<string, number>();
  const bySource = new Map<string, number>();

  for (const e of errors) {
    const lvl = (e.level || 'error').toLowerCase();
    byLevel.set(lvl, (byLevel.get(lvl) || 0) + 1);
    const src = (e.source || 'unknown').toLowerCase();
    bySource.set(src, (bySource.get(src) || 0) + 1);
  }

  console.log(`📄 Tracked errors: ${errors.length}`);
  console.log('By level:', Object.fromEntries(byLevel));
  console.log('By source:', Object.fromEntries(bySource));
  console.log('\nMost recent 5:');

  const recent = [...errors].slice(-5).reverse();
  for (const e of recent) {
    console.log(' -', formatLine(e));
  }

  console.log(`\nErrors file: ${ERRORS_PATH}`);
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function cmdList(args: string[]) {
  const flags = parseFlags(args);
  const count = Number(flags.count || flags.n || 10);
  const level = typeof flags.level === 'string' ? flags.level.toLowerCase() : undefined;
  const source = typeof flags.source === 'string' ? flags.source.toLowerCase() : undefined;

  let errors = loadErrors();
  if (level) errors = errors.filter(e => (e.level || 'error').toLowerCase() === level);
  if (source) errors = errors.filter(e => (e.source || '').toLowerCase() === source);

  if (errors.length === 0) {
    console.log('✅ No tracked errors found for the given filters.');
    return;
  }

  const subset = errors.slice(-count).reverse();
  subset.forEach(e => console.log(formatLine(e)));
}

function cmdGet(id: string) {
  if (!id) {
    console.error('Usage: agent-errors get <error-id>');
    process.exit(1);
  }
  const errors = loadErrors();
  const found = errors.find(e => e.id === id);
  if (!found) {
    console.error(`Error not found: ${id}`);
    process.exit(1);
  }
  console.log(JSON.stringify(found, null, 2));
}

function cmdPath() {
  console.log(ERRORS_PATH);
}

function cmdClear(args: string[]) {
  const flags = parseFlags(args);
  if (!flags.confirm) {
    console.error('Refusing to clear without --confirm');
    process.exit(1);
  }
  saveErrors([]);
  console.log('✅ Cleared tracked errors.');
  console.log(`File: ${ERRORS_PATH}`);
}

function showHelp() {
  console.log('Agent Errors CLI');
  console.log('Commands:');
  console.log('  summary                 Show counts and recent errors');
  console.log('  list [--count N] [--level L] [--source S]');
  console.log('  get <error-id>          Show full error entry');
  console.log('  path                    Show errors file path');
  console.log('  clear --confirm         Clear tracked errors');
}

const [, , command = 'summary', ...rest] = process.argv;

switch (command) {
  case 'summary':
    cmdSummary();
    break;
  case 'list':
    cmdList(rest);
    break;
  case 'get':
    cmdGet(rest[0]);
    break;
  case 'path':
  case 'paths':
    cmdPath();
    break;
  case 'clear':
    cmdClear(rest);
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
