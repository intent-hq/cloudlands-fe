/**
 * Speed check for the blended Cmd+K ranker (target: under 16 ms per keystroke).
 * Ranks a large fixture (500 workspaces, 200 repos, 1,000 notes, 200 agents)
 * and prints median and p95 timings per query. Report the output in the PR;
 * timing is not asserted in tests (lint bans wall-clock assertions).
 *
 *   pnpm exec tsx scripts/palette-ranking-speed.ts
 */
import { performance } from 'node:perf_hooks';
import {
  computeResults,
  type ComputeResultsInput,
} from '../src/store/renderer/slices/command-palette/command-palette-results';

const NOW = Date.now();
const DAY = 86_400_000;
const WORDS = [
  'build',
  'palette',
  'login',
  'deploy',
  'release',
  'search',
  'cloud',
  'agent',
  'fix',
  'docs',
  'server',
  'cache',
  'ranking',
  'review',
  'intent',
  'repo',
  'notes',
  'spec',
  'ios',
  'daemon',
];
const icon = {};
let seed = 42;
const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
const pick = () => WORDS[Math.floor(rand() * WORDS.length)];
const title = (i: number) => `${pick()} ${pick()} ${pick()} ${i}`;
const age = () => Math.floor(rand() * 60 * DAY);

const input: Omit<ComputeResultsInput, 'query'> = {
  activeFilter: null,
  workspaceId: 'ws-0',
  agents: Array.from({ length: 200 }, (_, i) => ({
    id: `a${i}`,
    type: 'agent',
    label: title(i),
    icon,
    timestamp: NOW - age(),
  })),
  notes: Array.from({ length: 1000 }, (_, i) => ({
    id: `n${i}`,
    type: 'note',
    label: title(i),
    description: `${pick()} / ${pick()}`,
    icon,
    timestamp: NOW - age(),
  })),
  indexedNotes: Array.from({ length: 10 }, (_, i) => ({
    id: `x${i}`,
    noteId: `x${i}`,
    workspaceId: 'ws-9',
    type: 'note',
    label: title(i),
    icon,
  })),
  changes: Array.from({ length: 50 }, (_, i) => ({
    id: `src/${pick()}/${pick()}${i}.ts`,
    type: 'change',
    label: `${pick()}${i}.ts`,
    icon,
  })),
  terminals: Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`,
    type: 'terminal',
    label: `Terminal ${i}`,
    icon,
  })),
  browserUrls: Array.from({ length: 20 }, (_, i) => ({
    id: `b${i}`,
    type: 'browser',
    label: `${pick()}.example.com`,
    icon,
  })),
  recentItems: [],
  files: Array.from({ length: 8 }, (_, i) => ({
    id: `f${i}`,
    path: `src/${pick()}/${pick()}.ts`,
    label: `${pick()}.ts`,
    icon,
  })),
  commands: Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, label: title(i), icon })),
  workspaceItems: Array.from({ length: 500 }, (_, i) => ({
    id: `w${i}`,
    label: title(i),
    description: pick(),
    icon,
    _workspace: true as const,
    _activityTime: NOW - age(),
  })),
  messages: Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    type: 'message',
    label: 'x',
    icon,
  })),
  repos: Array.from({ length: 200 }, (_, i) => ({
    id: `r${i}`,
    label: `${pick()}-org/${pick()}-${i}`,
    aliases: [`${pick()}-${i}`],
    description: `~/code/${pick()}-${i}`,
    kind: 'repo' as const,
    lastUsedAt: NOW - age(),
  })),
  pickMemory: Array.from({ length: 200 }, (_, i) => ({
    query: pick().slice(0, 3),
    itemKey: `agent:a${i}`,
    timestamp: NOW - age(),
  })),
  now: NOW,
};

const QUERIES = ['b', 'bu', 'build', 'cl', 'new work', 'fix login', 'palette rank', 'zzqx'];
const RUNS = 200;

const rows: string[] = [];
for (const query of QUERIES) {
  for (let i = 0; i < 20; i++) computeResults({ ...input, query });
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    computeResults({ ...input, query });
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(RUNS / 2)];
  const p95 = times[Math.floor(RUNS * 0.95)];
  rows.push(`| \`${query}\` | ${median.toFixed(2)} | ${p95.toFixed(2)} |`);
}

console.log('Fixture: 500 workspaces, 200 repos, 1,000 notes, 200 agents, 60 commands');
console.log('| Query | Median ms | p95 ms |');
console.log('|---|---|---|');
console.log(rows.join('\n'));
