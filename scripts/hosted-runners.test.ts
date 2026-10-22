// @verify-changed-triggers: .github/workflows/*.yml, .github/actions/*/action.yml, scripts/setup-sccache.py
// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  };
  // Runs the route job's actual script: the shared probe, identical to runner-route.yml.
  async function route({
    runners = [slot, slot],
    jobs = [],
    error = false,
    env = {},
    event = 'merge_group',
    unreadable,
  }: Fixture) {
    const workflow = read('.github/workflows/intent-pr.yml');
    const step = workflow.jobs.route.steps.find((s: { id?: string }) => s.id === 'decide');
    const values: Record<string, string> = {};
    const messages: string[] = [];
    const queried: string[] = [];
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const actions = {
      listSelfHostedRunnersForOrg: 'org',
      listSelfHostedRunnersForRepo: 'repo',
      listWorkflowRunsForRepo: 'runs',
      listJobsForWorkflowRun: 'jobs',
    };
    const paginate = async (method: string, params: { repo: string; status: string }) => {
      if (error) throw new Error('fixture failure');
      if (method === 'org' || method === 'repo')
        return runners.map((r) => ({ ...r, labels: r.labels.map((name) => ({ name })) }));
      if (method === 'runs') {
        queried.push(params.repo);
        if (params.repo === unreadable) throw new Error('403 fixture');
        // Fixture jobs belong to one queued run so each is counted once.
        return params.repo === 'cloudlands-fe' && params.status === 'queued' ? [{ id: 2 }] : [];
      }
      return jobs;
    };
    const processEnv = {
      env: {
        // Actions resolves `vars.CI_LINUX_HEAVY_SLOTS || '2'`; with the variable unset that is the default.
        THRESHOLD: heavySlotsDefault(workflow.env.LINUX_BURST_THRESHOLD),
        SLOT_JOBS: step.env.SLOT_JOBS,
        // Most cases check the GitHub fallback; the WarpBuild cases turn WarpBuild on.
        WARPBUILD_DISABLED: 'true',
        ...env,
      },
    };
    const payload = { pull_request: { head: { repo: { full_name: 'intent-hq/cloudlands-fe' } } } };
    await new AsyncFunction('core', 'github', 'context', 'process', step.with.script)(
      {
        setOutput: (key: string, value: string) => {
          values[key] = value;
        },
        info: (message: string) => messages.push(message),
      },
      { rest: { actions }, paginate },
      { repo: { owner: 'intent-hq', repo: 'cloudlands-fe' }, runId: 1, eventName: event, payload },
      processEnv,
    );
    return {
      labels: JSON.parse(values.linux_labels),
      burst: values.linux_burst,
      slots: JSON.parse(values.slots) as Record<string, string[]>,
      cloud: JSON.parse(values.cloud) as Record<string, string[]>,
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
  ])('bursts to GitHub-hosted runners (WarpBuild off) when %s', async (_name, fixture: Fixture) => {
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
    // The longest job first, then shards in order; each shard has its own key.
    expect(onSlots(r.slots)).toEqual(['checks', 'test-1']);
    for (const key of ['test-2', 'test-3', 'test-4', 'build-web', 'test-integration'])
      expect(r.slots[key]).toEqual(['gh-linux-8x']);
    expect(r.burst).toBe('true');
    expect(r.messages.some((m) => m.includes('free=2 granted=2'))).toBe(true);
    // The four shards alone on two free slots: exactly two self-hosted, two hosted.
    const shards = await route({
      env: { SLOT_JOBS: JSON.stringify([{ key: 'test', label: 'gh-linux-8x', shards: 4 }]) },
    });
    expect(onSlots(shards.slots)).toEqual(['test-1', 'test-2']);
    expect(Object.values(shards.slots).filter((l) => l[0] === 'gh-linux-8x')).toHaveLength(2);
    // One busy slot elsewhere leaves one for this run.
    const one = await route({ jobs: [running()] });
    expect(onSlots(one.slots)).toEqual(['checks']);
  });

  it.each([
    ['0 free slots', { jobs: [running(), running()] }],
    ['kill switch', { env: { LINUX_RUNNER_DISABLED: 'true' } }],
    ['probe failure', { error: true }],
    ['offline fleet', { runners: [] }],
    // intentd's jobs may hold both slots, so unknown demand is not zero demand.
    ['an unreadable intentd queue', { unreadable: 'intentd' }],
    ['an unreadable intent queue', { unreadable: 'intent' }],
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
      .filter(([, job]) => job['runs-on']?.includes('needs.route.outputs.slots'))
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
    expect(xlOnly.messages).toContain('linux routing: burst=true (no available compatible runner)');
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
    expect(onSlots(baseline.slots)).toEqual(['checks']);
  });

  it('bursts heavy jobs to WarpBuild when no slot is free', async () => {
    const WARP = ['warp-ubuntu-2404-x64-8x'];
    for (const fixture of [
      { jobs: [running(), running()] },
      { runners: [] },
      { error: true },
      { env: { LINUX_RUNNER_DISABLED: 'true' } },
    ] as Fixture[]) {
      const r = await route({ ...fixture, env: { ...fixture.env, WARPBUILD_DISABLED: '' } });
      expect(r.labels).toEqual(WARP);
      expect(r.burst).toBe('true');
      for (const labels of Object.values(r.slots)) expect(labels).toEqual(WARP);
    }
    // A free slot still wins over WarpBuild.
    const one = await route({ jobs: [running()], env: { WARPBUILD_DISABLED: '' } });
    expect(onSlots(one.slots)).toEqual(['checks']);
    expect(one.slots['test-1']).toEqual(WARP);
    const decide = read('.github/workflows/intent-pr.yml').jobs.route.steps.find(
      (s: { id?: string }) => s.id === 'decide',
    );
    expect(decide.env.WARPBUILD_DISABLED).toBe('${{ vars.CI_WARPBUILD_DISABLED }}');
  });

  it('runs the portable fixtures straight on the burst Mac, never a self-hosted one', async () => {
    const job = read('.github/workflows/intent-pr.yml').jobs['test-portable-fixtures'];
    expect(job.needs).toContain('route');
    expect(job['runs-on']).toBe(
      `\${{ fromJSON(needs.route.outputs.cloud || '{}')['macos-26-xlarge'] || fromJSON('["macos-26-xlarge"]') }}`,
    );
    expect(read('.github/workflows/intent-pr.yml').jobs.route.outputs.cloud).toBe(
      '${{ steps.decide.outputs.cloud }}',
    );
    const on = await route({ env: { WARPBUILD_DISABLED: '' } });
    expect(on.cloud['macos-26-xlarge']).toEqual(['warp-macos-26-arm64-6x']);
    const off = await route({});
    expect(off.cloud['macos-26-xlarge']).toEqual(['macos-26-xlarge']);
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

describe('WarpBuild cache', () => {
  const action = read('.github/actions/cache/action.yml');
  const store = read('.github/actions/pnpm-store-cache/action.yml');
  const workflows = readdirSync('.github/workflows').filter((name) => name.endsWith('.yml'));
  type Step = {
    name?: string;
    id?: string;
    uses?: string;
    run?: string;
    if?: string;
    with?: Record<string, string>;
  };
  const steps = (id: string) => (action.runs.steps as Step[]).find((s) => s.id === id)!;

  // Runs the action's real backend step: WarpBuild's cache needs a WarpBuild runner and is not available on Windows.
  const backend = (env: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-backend-'));
    const output = join(dir, 'out');
    const result = spawnSync('bash', ['-c', steps('backend').run!], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, RUNNER_OS: 'Linux', ...env },
    });
    expect(result.status, result.stderr).toBe(0);
    const value = readFileSync(output, 'utf8').trim();
    rmSync(dir, { recursive: true, force: true });
    return value;
  };

  it('uses WarpBuild cache only on WarpBuild Linux and macOS runners', () => {
    const token = { WARPBUILD_RUNNER_VERIFICATION_TOKEN: 'fixture' };
    expect(backend(token)).toBe('backend=warpbuild');
    expect(backend({ ...token, RUNNER_OS: 'macOS' })).toBe('backend=warpbuild');
    expect(backend({ ...token, RUNNER_OS: 'Windows' })).toBe('backend=github');
    expect(backend({})).toBe('backend=github');
    expect(backend({ WARPBUILD_RUNNER_VERIFICATION_TOKEN: '' })).toBe('backend=github');
    // The token is only tested for presence, never printed.
    expect(steps('backend').run).not.toMatch(/echo[^\n]*WARPBUILD_RUNNER_VERIFICATION_TOKEN/);
  });

  it('pins the WarpBuild action and gives both backends the same inputs', () => {
    expect(steps('warpbuild').uses).toMatch(/^WarpBuilds\/cache@[0-9a-f]{40}$/);
    expect(steps('warpbuild').if).toBe("steps.backend.outputs.backend == 'warpbuild'");
    expect(steps('github').uses).toBe('actions/cache@v6');
    expect(steps('github').if).toBe("steps.backend.outputs.backend == 'github'");
    expect(steps('warpbuild').with).toEqual(steps('github').with);
    expect(steps('warpbuild').with).toEqual({
      path: '${{ inputs.path }}',
      key: '${{ inputs.key }}',
      'restore-keys': '${{ inputs.restore-keys }}',
    });
  });

  it('keys the pnpm store on the platform and lockfile', () => {
    const cache = (store.runs.steps as Step[]).find((s) => s.uses === './.github/actions/cache')!;
    expect(cache.with!.key).toBe(
      "pnpm-store-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('pnpm-lock.yaml') }}",
    );
    expect(cache.with!['restore-keys'].trim()).toBe(
      'pnpm-store-${{ runner.os }}-${{ runner.arch }}-',
    );
  });

  it('routes every workflow cache through the backend-selecting action', () => {
    for (const file of workflows) {
      const text = readFileSync(`.github/workflows/${file}`, 'utf8');
      expect(text, file).not.toMatch(/^\s+cache: '?pnpm'?\s*$/m);
      expect(text, file).not.toMatch(/uses: WarpBuilds\//);
      // Only the retirement cursor (run state on a GitHub-hosted control job) uses actions/cache directly.
      const direct = [...text.matchAll(/uses: actions\/cache(\/\w+)?@/g)];
      if (file === 'retire-obsolete-merge-runs.yml') expect(direct.length).toBe(2);
      else expect(direct, file).toEqual([]);
    }
  });

  it('restores the pnpm store after pnpm and Node are set up and before installing', () => {
    let jobsWithStore = 0;
    for (const file of workflows) {
      const jobs = read(`.github/workflows/${file}`).jobs as Record<string, { steps?: Step[] }>;
      for (const [id, job] of Object.entries(jobs)) {
        const list = job.steps ?? [];
        const at = list.findIndex((s) => s.uses === './.github/actions/pnpm-store-cache');
        if (at === -1) continue;
        jobsWithStore += 1;
        const pnpm = list.findIndex((s) => s.uses?.startsWith('pnpm/action-setup@'));
        const node = list.findIndex((s) => s.uses?.startsWith('actions/setup-node@'));
        const install = list.findIndex((s) => /pnpm install/.test(s.run ?? ''));
        expect(pnpm, `${file}:${id}`).toBeGreaterThanOrEqual(0);
        expect(pnpm, `${file}:${id}`).toBeLessThan(at);
        expect(node, `${file}:${id}`).toBeLessThan(at);
        expect(at, `${file}:${id}`).toBeLessThan(install);
      }
    }
    expect(jobsWithStore).toBeGreaterThanOrEqual(9);
  });
});
