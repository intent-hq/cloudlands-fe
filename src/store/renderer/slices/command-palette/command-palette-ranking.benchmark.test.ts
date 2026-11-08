/**
 * Frozen ranking benchmark for the blended Cmd+K list.
 *
 * Written before the ranker was tuned: do not edit cases to make the ranker
 * pass. Each case is (query, expected row 1). Brief cases come from the product
 * brief's flows, branches and acceptance criteria plus intent-hq/intent#8292 and
 * must pass 100%; the full set must pass >= 90%.
 */
import { describe, expect, it } from 'vitest';
import { computeResults, type ComputeResultsInput } from './command-palette-results';
import type { PaletteFilter, WorkspaceObject } from './command-palette-utils';

const icon = { iconName: 'test' };
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WS = 'ws-current';

const commands = [
  { id: 'new-workspace', label: 'New Workspace', icon, shortcut: '⌘T' },
  { id: 'settings', label: 'Settings', icon, shortcut: '⌘,' },
  { id: 'agent-settings', label: 'Agent Settings', icon },
  { id: 'new-agent', label: 'New Agent Chat', icon },
  { id: 'new-terminal', label: 'New Terminal', icon },
  { id: 'new-note', label: 'New Note', icon },
  { id: 'new-file', label: 'New File', icon, shortcut: '⌘N' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', icon },
];

const agent = (id: string, label: string, age: number): WorkspaceObject => ({
  id,
  type: 'agent',
  label,
  icon,
  timestamp: NOW - age,
});

const agents = [
  agent('avatar', 'Agent Avatar', 14 * DAY),
  agent('build-docs', 'Build docs', HOUR),
  agent('build-server', 'Build server', 10 * DAY),
  agent('readme', 'Readme cleanup', DAY),
  agent('fix-login', 'Fix login bug', 3 * DAY),
  agent('login-fix', 'Login fix', HOUR),
  agent('flaky', 'fix flaky test login', 30 * MIN),
  agent('expense', 'Daily expense plot layout', 5 * MIN),
  agent('settings-refactor', 'Settings refactor', 2 * MIN),
];

const note = (id: string, label: string, age: number): WorkspaceObject => ({
  id,
  type: 'note',
  label,
  icon,
  timestamp: NOW - age,
});

const notes = [
  note('spec', 'Spec', 2 * DAY),
  note('palette-design', 'Palette design', 5 * DAY),
  note('release', 'Release checklist', 20 * DAY),
];

const changes: WorkspaceObject[] = [
  { id: 'src/app.ts', type: 'change', label: 'app.ts', description: 'src/app.ts', icon },
];

const terminals: WorkspaceObject[] = [
  { id: 'term-1', type: 'terminal', label: 'Terminal 1', icon, timestamp: NOW - HOUR },
];

const browserUrls: WorkspaceObject[] = [
  {
    id: 'tab-1',
    type: 'browser',
    label: 'localhost:5173',
    url: 'http://localhost:5173',
    icon,
    timestamp: NOW - 10 * MIN,
  },
];

const workspace = (id: string, label: string, age: number, description?: string) => ({
  id,
  label,
  icon,
  description,
  _workspace: true as const,
  _activityTime: NOW - age,
});

const workspaceItems = [
  workspace('ws-ranking', 'Fix palette ranking', 5 * MIN, 'cloudlands-fe'),
  workspace('ws-deploy', 'Deploy pipeline', 20 * DAY, 'infra'),
  workspace('ws-onboarding', 'Onboarding copy', 2 * DAY, 'intentd'),
];

const repos = [
  {
    id: 'local:/Users/me/code/cloudlands-fe',
    label: 'intent-hq/cloudlands-fe',
    aliases: ['cloudlands-fe'],
    description: '~/code/cloudlands-fe',
    kind: 'repo' as const,
    lastUsedAt: NOW - HOUR,
    icon,
  },
  {
    id: 'github:intent-hq/cloudlands-fe',
    label: 'intent-hq/cloudlands-fe',
    aliases: ['cloudlands-fe'],
    description: 'GitHub',
    kind: 'repo' as const,
    lastUsedAt: NOW - 3 * DAY,
    icon,
  },
  {
    id: 'local:/Users/me/code/intentd',
    label: 'intent-hq/intentd',
    aliases: ['intentd'],
    description: '~/code/intentd',
    kind: 'repo' as const,
    lastUsedAt: NOW - 2 * DAY,
    icon,
  },
  {
    id: 'local:/Users/me/code/old-tool',
    label: 'me/old-tool',
    aliases: ['old-tool'],
    description: '~/code/old-tool',
    kind: 'repo' as const,
    lastUsedAt: NOW - 90 * DAY,
    icon,
  },
];

const file = (path: string) => ({
  id: path,
  label: path.split('/').pop() ?? path,
  path,
  description: path,
  icon,
});

function baseInput(overrides: Partial<ComputeResultsInput> = {}): ComputeResultsInput {
  return {
    query: '',
    activeFilter: null,
    workspaceId: WS,
    agents,
    notes,
    indexedNotes: [],
    changes,
    terminals,
    browserUrls,
    recentItems: [],
    files: [],
    commands,
    workspaceItems,
    messages: [],
    repos,
    pickMemory: [],
    now: NOW,
    ...overrides,
  };
}

interface BenchmarkCase {
  name: string;
  query: string;
  filter?: PaletteFilter;
  expected: string;
  brief: boolean;
  input?: Partial<ComputeResultsInput>;
}

const CASES: BenchmarkCase[] = [
  // ── Brief flows, branches and acceptance criteria (must pass 100%) ──
  {
    name: '#8292 flow: repo name prefix opens the local clone first',
    query: 'cloudl',
    expected: 'repo:local:/Users/me/code/cloudlands-fe',
    brief: true,
  },
  {
    name: 'pasted full repo name opens the repo',
    query: 'cloudlands',
    expected: 'repo:local:/Users/me/code/cloudlands-fe',
    brief: true,
  },
  {
    name: 'repo outside the 9 most recent is findable',
    query: 'old-tool',
    expected: 'repo:local:/Users/me/code/old-tool',
    brief: true,
  },
  {
    name: 'repo is searchable by owner/name',
    query: 'intent-hq/intentd',
    expected: 'repo:local:/Users/me/code/intentd',
    brief: true,
  },
  {
    name: '+ alone lists repos, most recent first',
    query: '',
    filter: 'repo',
    expected: 'repo:local:/Users/me/code/cloudlands-fe',
    brief: true,
  },
  {
    name: '"new work" finds the New Workspace command',
    query: 'new work',
    expected: 'command:new-workspace',
    brief: true,
  },
  {
    name: 'picked item for the exact query wins after restart',
    query: 'ag',
    expected: 'agent:avatar',
    brief: true,
    input: { pickMemory: [{ query: 'ag', itemKey: 'agent:avatar', timestamp: NOW - 6 * DAY }] },
  },
  {
    name: 'exact name match beats an exact-query pick',
    query: 'ag',
    expected: 'workspace:ws-ag',
    brief: true,
    input: {
      pickMemory: [{ query: 'ag', itemKey: 'agent:avatar', timestamp: NOW - 6 * DAY }],
      workspaceItems: [...workspaceItems, workspace('ws-ag', 'AG', 40 * DAY)],
    },
  },
  {
    name: 'exact name match is row 1 over a more recent starts-with',
    query: 'settings',
    expected: 'command:settings',
    brief: true,
  },
  {
    name: 'starts-with name beats a more recent loose match',
    query: 'deploy',
    expected: 'workspace:ws-deploy',
    brief: true,
  },
  {
    name: 'equal tiers: more recently used first',
    query: 'build',
    expected: 'agent:build-docs',
    brief: true,
  },
  {
    name: 'a better late file stays below row 1',
    query: 'readme',
    expected: 'agent:readme',
    brief: true,
    input: { files: [file('README.md')] },
  },
  {
    name: 'late exact file match cannot take row 1 from an instant match',
    query: 'app.ts',
    expected: 'change:src/app.ts',
    brief: true,
    input: { files: [file('src/app.ts')] },
  },
  {
    name: 'only a chat message matches: it is row 1',
    query: 'kubernetes ingress',
    expected: 'message:agent-9:msg-1',
    brief: true,
    input: {
      messages: [
        {
          id: 'agent-9:msg-1',
          type: 'message',
          label: 'Infra agent',
          description: 'set up the kubernetes ingress',
          icon,
        },
      ],
    },
  },
  {
    name: 'only a note body matches: the server note is row 1',
    query: 'quarterly okr',
    expected: 'note:ws-other:n-plan',
    brief: true,
    input: {
      indexedNotes: [
        {
          id: 'ws-other:n-plan',
          noteId: 'n-plan',
          workspaceId: 'ws-other',
          type: 'note',
          label: 'Planning',
          description: 'quarterly okr draft',
          icon,
        },
      ],
    },
  },
  {
    name: 'nothing instant matches: the first late source to arrive is row 1',
    query: 'zebra',
    expected: 'message:agent-2:msg-7',
    brief: true,
    input: {
      files: [file('assets/zebra.png')],
      messages: [
        { id: 'agent-2:msg-7', type: 'message', label: 'Assets', description: 'zebra', icon },
      ],
      lateArrivalOrder: ['message', 'file'],
    },
  },
  {
    name: 'multi-word: weakest word decides',
    query: 'fix login',
    expected: 'agent:fix-login',
    brief: true,
  },

  // ── Realistic queries from the dev fixture (full set >= 90%) ──
  { name: 'exact note title', query: 'spec', expected: 'note:ws-current:spec', brief: false },
  {
    name: 'note title prefix',
    query: 'rel',
    expected: 'note:ws-current:release',
    brief: false,
  },
  {
    name: 'starts-with beats word-start',
    query: 'login',
    expected: 'agent:login-fix',
    brief: false,
  },
  {
    name: 'alias exact match (repo name)',
    query: 'intentd',
    expected: 'repo:local:/Users/me/code/intentd',
    brief: false,
  },
  { name: 'terminal by name', query: 'term', expected: 'terminal:term-1', brief: false },
  { name: 'command prefix', query: 'toggle', expected: 'command:toggle-sidebar', brief: false },
  { name: 'browser page', query: 'localhost', expected: 'browser:tab-1', brief: false },
  {
    name: 'workspace by title word',
    query: 'onboarding',
    expected: 'workspace:ws-onboarding',
    brief: false,
  },
  {
    name: 'related-query pick boosts a prefix query',
    query: 'pal',
    expected: 'note:ws-current:palette-design',
    brief: false,
    input: {
      pickMemory: [
        { query: 'palette', itemKey: 'note:ws-current:palette-design', timestamp: NOW - DAY },
      ],
      workspaceItems: [...workspaceItems, workspace('ws-pal', 'Palette polish', 10 * MIN)],
    },
  },
  {
    name: 'faded pick (older than 30 days) no longer wins',
    query: 'build',
    expected: 'agent:build-docs',
    brief: false,
    input: {
      pickMemory: [{ query: 'build', itemKey: 'agent:build-server', timestamp: NOW - 45 * DAY }],
    },
  },
  {
    name: 'pick that no longer matches is ignored',
    query: 'bui',
    expected: 'agent:build-docs',
    brief: false,
    input: {
      pickMemory: [{ query: 'bui', itemKey: 'agent:avatar', timestamp: NOW - DAY }],
    },
  },
  {
    name: 'name match beats description match',
    query: 'infra',
    expected: 'agent:infra',
    brief: false,
    input: { agents: [...agents, agent('infra', 'Infra cleanup', 20 * DAY)] },
  },
  {
    name: 'repo filter with a query',
    query: 'intent',
    filter: 'repo',
    expected: 'repo:local:/Users/me/code/cloudlands-fe',
    brief: false,
  },
  {
    name: 'agent filter keeps new ranking',
    query: 'build',
    filter: 'agent',
    expected: 'agent:build-docs',
    brief: false,
  },
];

function rowOne(c: BenchmarkCase): string | undefined {
  const results = computeResults(
    baseInput({ query: c.query, activeFilter: c.filter ?? null, ...c.input }),
  );
  const first = results.find((row: any) => typeof row._key === 'string' && !row._seeAll);
  return first?._key;
}

describe('command palette ranking benchmark', () => {
  it.each(CASES.filter((c) => c.brief).map((c) => [c.name, c] as const))(
    'brief: %s',
    (_name, c) => {
      expect(rowOne(c)).toBe(c.expected);
    },
  );

  it('passes at least 90% of the full set', () => {
    const failures = CASES.filter((c) => rowOne(c) !== c.expected).map(
      (c) => `${c.name} (query "${c.query}"): got ${rowOne(c)}, expected ${c.expected}`,
    );
    const passRate = (CASES.length - failures.length) / CASES.length;
    expect(passRate, failures.join('\n')).toBeGreaterThanOrEqual(0.9);
  });
});
