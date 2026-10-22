// @verify-changed-triggers: .github/workflows/*.yml, scripts/setup-sccache.py
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const require = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load } = require('js-yaml');
const read = (path: string) => load(readFileSync(path, 'utf8'));

// Standard GitHub labels plus the org larger runners; Depot was retired.
// Windows stays on Server 2022 (gh-windows-16x): windows-2025 breaks node-gyp.
const HOSTED = new Set([
  'ubuntu-24.04',
  'gh-linux-8x',
  'gh-linux-arm64-8x',
  'gh-windows-16x',
  'macos-26-xlarge',
  'macos-15-xlarge',
]);
// Runners chosen through a matrix: `runner: <label>` rows and JSON `"runner":"<label>"` targets.
const matrixRunners = (text: string) => [
  ...[...text.matchAll(/^\s+runner: ([\w.-]+)\s*$/gm)].map((m) => m[1]),
  ...[...text.matchAll(/"runner":"([^"]+)"/g)].map((m) => m[1]),
];

const heavySlotsDefault = (expr: string) =>
  /^\$\{\{ vars\.CI_LINUX_HEAVY_SLOTS \|\| '(\d+)' \}\}$/.exec(expr)?.[1] ?? 'unparsed';

describe('GitHub-hosted CI runners', () => {
  const CACHE = ['self-hosted', 'linux', 'x64', 'intent-cache'];
  // intent-cache slots register with GitHub's default labels plus `intent-cache`.
  const slot = { status: 'online', labels: ['self-hosted', 'Linux', 'X64', 'intent-cache'] };
  const generic = { status: 'online', labels: ['self-hosted', 'Linux', 'X64'] };
  type Fixture = {
    runners?: { status: string; labels: string[] }[];
    jobs?: { status: string; labels: string[]; created_at?: string }[];
    error?: boolean;
    env?: Record<string, string>;
    event?: string;
    unreadable?: string;
    truncated?: boolean;
  };
  async function route({
    runners = [slot, slot],
    jobs = [],
    error = false,
    env = {},
    event = 'merge_group',
    unreadable,
    truncated = false,
  }: Fixture) {
    const workflow = read('.github/workflows/intent-pr.yml');
    const step = workflow.jobs.route.steps.find((s: { id?: string }) => s.id === 'decide');
    const values: Record<string, string> = {};
    const messages: string[] = [];
    const queried: string[] = [];
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const actions = {
      listSelfHostedRunnersForOrg: () => {},
      listSelfHostedRunnersForRepo: () => {},
      listWorkflowRunsForRepo: async ({ repo, status }: { repo: string; status: string }) => {
        queried.push(repo);
        if (repo === unreadable) throw new Error('403 fixture');
        // Fixture jobs belong to one queued run so each is counted once.
        return {
          data: {
            workflow_runs: repo === 'cloudlands-fe' && status === 'queued' ? [{ id: 2 }] : [],
            ...(truncated ? { total_count: 101 } : {}),
          },
        };
      },
      listJobsForWorkflowRun: async () => ({ data: { jobs } }),
    };
    const processEnv = {
      env: {
        // Actions resolves `vars.CI_LINUX_HEAVY_SLOTS || '2'`; with the variable unset that is the default.
        THRESHOLD: heavySlotsDefault(workflow.env.LINUX_BURST_THRESHOLD),
        SLOT_JOBS: step.env.SLOT_JOBS,
        ...env,
      },
    };
    await new AsyncFunction('core', 'github', 'context', 'process', step.with.script)(
      {
        setOutput: (key: string, value: string) => {
          values[key] = value;
        },
        info: (message: string) => messages.push(message),
      },
      {
        rest: { actions },
        paginate: async () => {
          if (error) throw new Error('fixture failure');
          return runners.map((r) => ({ ...r, labels: r.labels.map((name) => ({ name })) }));
        },
      },
      { repo: { owner: 'intent-hq', repo: 'cloudlands-fe' }, runId: 1, eventName: event },
      processEnv,
    );
    return {
      labels: JSON.parse(values.linux_labels),
      burst: values.linux_burst,
      slots: JSON.parse(values.slots) as Record<string, string[]>,
      messages,
      queried,
    };
  }
  const running = (labels = CACHE) => ({ status: 'in_progress', labels });

  const onSlots = (slots: Record<string, string[]>) =>
    Object.keys(slots)
      .filter((key) => JSON.stringify(slots[key]) === JSON.stringify(CACHE))
      .sort();

  it('routes heavy jobs to an idle intent-cache slot while one is free', async () => {
    const r = await route({ env: { SLOT_JOBS: '[]' } });
    expect(r.labels).toEqual(CACHE);
    expect(r.burst).toBe('false');
    expect([...new Set(r.queried)].sort()).toEqual(['cloudlands-fe', 'intent', 'intentd']);
    expect(read('.github/workflows/intent-pr.yml').env.LINUX_BURST_THRESHOLD).toBe(
      "${{ vars.CI_LINUX_HEAVY_SLOTS || '2' }}",
    );
  });

  it.each([
    ['offline', { runners: [] }],
    ['error', { error: true }],
    ['generic self-hosted Linux only', { runners: [generic, generic] }],
    [
      'both slots busy',
      { jobs: [running(), running(['self-hosted', 'Linux', 'X64', 'intent-cache'])] },
    ],
    ['one slot online and busy', { runners: [slot], jobs: [running()] }],
    ['kill switch', { env: { LINUX_RUNNER_DISABLED: 'true' } }],
  ])('bursts to GitHub-hosted runners when %s', async (_name, fixture: Fixture) => {
    const r = await route(fixture);
    expect(r.labels).toEqual(['gh-linux-8x']);
    expect(r.burst).toBe('true');
  });

  it('keeps routing to the slots while one is free and ignores non-slot jobs', async () => {
    const r = await route({
      env: { SLOT_JOBS: '[]' },
      jobs: [
        running(),
        ...Array.from({ length: 5 }, () => running(['self-hosted', 'Linux', 'X64'])),
      ],
    });
    expect(r.labels).toEqual(CACHE);
    expect(r.messages.some((m) => m.includes('queue depth=1 threshold=2 online=2 free=1'))).toBe(
      true,
    );
    const killed = await route({ env: { LINUX_RUNNER_DISABLED: 'true' } });
    expect(killed.messages).toContain('linux routing: burst=true (disabled for maintenance)');
    expect(killed.queried).toEqual([]);
  });

  it('counts only heavy intent-cache slots, not the fast pool that shares the generic labels', async () => {
    const small = {
      status: 'online',
      labels: ['self-hosted', 'Linux', 'X64', 'intent-cache-small'],
    };
    const smallOnly = await route({ runners: Array.from({ length: 6 }, () => small) });
    expect(smallOnly.labels).toEqual(['gh-linux-8x']);
    const fastJobs = Array.from({ length: 6 }, () =>
      running(['self-hosted', 'Linux', 'X64', 'intent-cache-small']),
    );
    const r = await route({
      runners: [slot, slot, small],
      jobs: fastJobs,
      env: { SLOT_JOBS: '[]' },
    });
    expect(r.labels).toEqual(CACHE);
    expect(r.messages.some((m) => m.includes('queue depth=0 threshold=2 online=2'))).toBe(true);
  });

  it('splits Unit Tests into four routed shards', () => {
    const test = read('.github/workflows/intent-pr.yml').jobs.test;
    // Two legs took ~26 min on a heavy slot and ~23 min hosted (30-min timeout).
    expect(test.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    expect(test.name).toBe('Unit Tests (shard ${{ matrix.shard }}/4)');
    expect(test['runs-on']).toBe(
      "${{ fromJSON(needs.route.outputs.slots || '{}')[format('test-{0}', matrix.shard)] || fromJSON('[\"gh-linux-8x\"]') }}",
    );
    const run = test.steps.find((step: { name?: string }) => step.name === 'Unit tests').run;
    expect(run).toContain('pnpm run test:unit --shard=${{ matrix.shard }}/4');
  });

  it('2 free slots and 4 heavy jobs: exactly 2 self-hosted, 2 hosted', async () => {
    // A PR runs Type Check & Lint plus four Unit Tests shards; the queue-only jobs hold no slot.
    const r = await route({ event: 'pull_request' });
    expect(Object.keys(r.slots).sort()).toEqual([
      'build-web',
      'checks',
      'test-1',
      'test-2',
      'test-3',
      'test-4',
      'test-integration',
    ]);
    // The Unit Tests shards outrank Type Check & Lint, then go in shard order;
    // each shard has its own key.
    expect(onSlots(r.slots)).toEqual(['test-1', 'test-2']);
    for (const key of ['checks', 'test-3', 'test-4', 'build-web', 'test-integration'])
      expect(r.slots[key]).toEqual(['gh-linux-8x']);
    expect(r.burst).toBe('true');
    expect(r.messages.some((m) => m.includes('free=2 (org list) granted=2'))).toBe(true);
    // The four shards alone on two free slots: exactly two self-hosted, two hosted.
    const shards = await route({
      env: { SLOT_JOBS: JSON.stringify([{ key: 'test', label: 'gh-linux-8x', shards: 4 }]) },
    });
    expect(onSlots(shards.slots)).toEqual(['test-1', 'test-2']);
    expect(Object.values(shards.slots).filter((l) => l[0] === 'gh-linux-8x')).toHaveLength(2);
    // One busy slot elsewhere leaves one for this run.
    const one = await route({ jobs: [running()] });
    expect(onSlots(one.slots)).toEqual(['test-1']);
    // Four free slots: every Unit Tests shard, including shard 4, takes one.
    const four = await route({ event: 'pull_request', env: { THRESHOLD: '4' }, runners: [slot, slot, slot, slot] });
    expect(onSlots(four.slots)).toEqual(['test-1', 'test-2', 'test-3', 'test-4']);
    expect(four.slots.checks).toEqual(['gh-linux-8x']);
  });

  it.each([
    ['0 free slots', { jobs: [running(), running()] }],
    ['kill switch', { env: { LINUX_RUNNER_DISABLED: 'true' } }],
    ['probe failure', { error: true }],
    ['offline fleet', { runners: [] }],
    // intentd's jobs may hold both slots, so unknown demand is not zero demand.
    ['an unreadable intentd queue', { unreadable: 'intentd' }],
    ['an unreadable intent queue', { unreadable: 'intent' }],
    ['a truncated queue view', { truncated: true }],
  ])('sends every listed heavy job hosted with %s', async (_name, fixture: Fixture) => {
    const r = await route(fixture);
    expect(Object.keys(r.slots)).toHaveLength(7);
    for (const labels of Object.values(r.slots)) expect(labels).toEqual(['gh-linux-8x']);
  });

  it('lists every routed heavy job once, with its hosted fallback', () => {
    const workflow = read('.github/workflows/intent-pr.yml');
    const listed = JSON.parse(
      workflow.jobs.route.steps.find((s: { id?: string }) => s.id === 'decide').env.SLOT_JOBS,
    ) as { key: string; label: string; shards?: number; events?: string[] }[];
    const readers = Object.entries(workflow.jobs as Record<string, { 'runs-on'?: string }>)
      .filter(([, job]) => job['runs-on']?.includes('needs.route.outputs'))
      .map(([id, job]) => [id, job['runs-on']] as const);
    expect(readers.map(([id]) => id).sort()).toEqual(listed.map((j) => j.key).sort());
    for (const [id, runner] of readers) {
      const entry = listed.find((j) => j.key === id)!;
      const key = entry.shards ? `format('${id}-{0}', matrix.shard)` : `'${id}'`;
      expect(runner).toBe(
        `\${{ fromJSON(needs.route.outputs.slots || '{}')[${key}] || fromJSON('["${entry.label}"]') }}`,
      );
    }
    // Queue-only jobs must say so, or they would hold a slot on every PR.
    for (const id of ['build-web', 'test-integration'])
      expect(listed.find((j) => j.key === id)!.events).toEqual(['merge_group']);
  });

  it('reads the heavy slot count from the CI_LINUX_HEAVY_SLOTS variable', async () => {
    // Raising the org or repo variable alone grows the pool: 14 slots take every listed job.
    const slots14 = Array.from({ length: 14 }, () => slot);
    const grown = await route({ runners: slots14, env: { THRESHOLD: '14' } });
    expect(onSlots(grown.slots)).toHaveLength(7);
    expect(grown.burst).toBe('false');
    expect(grown.messages.some((m) => m.includes('threshold=14 online=14 free=14'))).toBe(true);
    // The online count still caps it, and so does the variable.
    expect(
      onSlots((await route({ runners: [slot, slot, slot], env: { THRESHOLD: '14' } })).slots),
    ).toHaveLength(3);
    expect(onSlots((await route({ runners: slots14 })).slots)).toHaveLength(2);
    // An empty value falls back to today's two slots.
    const unset = await route({ runners: slots14, env: { THRESHOLD: '' } });
    expect(onSlots(unset.slots)).toHaveLength(2);
  });

  it.each(['two', '-1', '1.5', '2x'])(
    'fails open to GitHub-hosted runners when the slot count is %s',
    async (value) => {
      const r = await route({ env: { THRESHOLD: value } });
      expect(r.burst).toBe('true');
      expect(r.labels).toEqual(['gh-linux-8x']);
      for (const labels of Object.values(r.slots)) expect(labels).toEqual(['gh-linux-8x']);
      expect(r.messages).toContain(
        'linux routing: burst=true (probe failed (invalid queue threshold))',
      );
    },
  );

  it('ignores the xl pool: its runners and jobs neither add nor take heavy slots', async () => {
    // Every routed job here asks for gh-linux-8x, which stays on the heavy pool;
    // only gh-linux-16x jobs (intent and intentd) use the intent-cache-xl slots.
    const listed = JSON.parse(
      read('.github/workflows/intent-pr.yml').jobs.route.steps.find(
        (s: { id?: string }) => s.id === 'decide',
      ).env.SLOT_JOBS,
    ) as { label: string }[];
    expect(new Set(listed.map((j) => j.label))).toEqual(new Set(['gh-linux-8x']));
    const xl = { status: 'online', labels: ['self-hosted', 'Linux', 'X64', 'intent-cache-xl'] };
    const xlJob = running(['self-hosted', 'linux', 'x64', 'intent-cache-xl']);
    const xlOnly = await route({ runners: [xl, xl] });
    expect(xlOnly.labels).toEqual(['gh-linux-8x']);
    expect(xlOnly.messages).toContain(
      'linux routing: burst=true (no online intent-cache runner (org list))',
    );
    // No xl runners online, or xl runners busy with xl jobs: routing is unchanged.
    const baseline = await route({ jobs: [running()] });
    for (const fixture of [
      { runners: [slot, slot, { ...xl, status: 'offline' }], jobs: [running()] },
      { runners: [slot, slot, xl, xl], jobs: [running(), xlJob, xlJob] },
    ]) {
      const r = await route(fixture);
      expect(r.slots).toEqual(baseline.slots);
      expect(r.labels).toEqual(baseline.labels);
      expect(r.burst).toBe(baseline.burst);
    }
    expect(onSlots(baseline.slots)).toEqual(['test-1']);
  });

  it('never routes to tinybox', () => {
    expect(readFileSync('.github/workflows/intent-pr.yml', 'utf8')).not.toMatch(/tinybox/i);
  });

  it('provisions Python 3.12 before unit tests on either runner path', () => {
    const steps = read('.github/workflows/intent-pr.yml').jobs.test.steps;
    const setup = steps.findIndex((step: { uses?: string }) =>
      step.uses?.startsWith('actions/setup-python@'),
    );
    const tests = steps.findIndex((step: { name?: string }) => step.name === 'Unit tests');
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(setup).toBeLessThan(tests);
    expect(steps[setup].with['python-version']).toBe('3.12');
    expect(steps[setup].if).toBeUndefined();
  });

  it('uses known GitHub-hosted labels except for isolated retirement cleanup', () => {
    for (const file of readdirSync('.github/workflows').filter((name) => name.endsWith('.yml'))) {
      const jobs = read(`.github/workflows/${file}`).jobs;
      for (const [id, job] of Object.entries(jobs) as [string, { 'runs-on'?: string }][]) {
        const runner = job['runs-on'];
        // Retirement must stay available independently of the managed runner fleet.
        if (file === 'retire-obsolete-merge-runs.yml' && id === 'cleanup') {
          expect(runner, `${file}:${id}`).toBe('ubuntu-latest');
          continue;
        }
        if (runner && !runner.includes('${{'))
          expect(HOSTED.has(runner), `${file}:${id} uses ${runner}`).toBe(true);
      }
    }
  });

  it('selects only known GitHub-hosted labels in runner matrices', () => {
    const found = readdirSync('.github/workflows')
      .filter((name) => name.endsWith('.yml'))
      .flatMap((file) =>
        matrixRunners(readFileSync(`.github/workflows/${file}`, 'utf8')).map((runner) => ({
          file,
          runner,
        })),
      );
    expect(found.map(({ runner }) => runner)).toEqual(
      expect.arrayContaining(['gh-linux-8x', 'gh-linux-arm64-8x', 'macos-15-xlarge']),
    );
    for (const { file, runner } of found)
      expect(HOSTED.has(runner), `${file} matrix uses ${runner}`).toBe(true);
    expect(matrixRunners('          runner: depot-ubuntu-24.04-arm-8\n')).toEqual([
      'depot-ubuntu-24.04-arm-8',
    ]);
  });

  it('keeps signed desktop Mac builds off macos-26 images', () => {
    // electron-builder's keychain step fails there (SecKeychainUnlock); see cloudlands-fe#3500.
    for (const file of ['release-alpha.yml', 'manual-signed-build.yml']) {
      const macRows = [
        ...readFileSync(`.github/workflows/${file}`, 'utf8').matchAll(/"runner":"(macos-[^"]+)"/g),
      ];
      expect(macRows.length, file).toBeGreaterThan(0);
      for (const [, runner] of macRows) expect(runner, file).toBe('macos-15-xlarge');
    }
  });

  it('configures managed caching without Rust cache actions', () => {
    const result = spawnSync('python3', ['-B', 'scripts/test-setup-sccache.py'], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  });
});
