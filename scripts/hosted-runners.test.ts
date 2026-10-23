// @verify-changed-triggers: .github/workflows/*.yml, .github/actions/*/action.yml, scripts/setup-sccache.py
// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    const listStep = workflow.jobs.route.steps.find((s: { id?: string }) => s.id === 'slot-jobs');
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
        SLOT_JOBS: listStep.env.SLOT_JOBS,
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
    // A PR runs four Unit Tests shards on the pool; the queue-only jobs hold no slot.
    const r = await route({ event: 'pull_request' });
    expect(Object.keys(r.slots).sort()).toEqual([
      'build-web',
      'ct-1',
      'ct-2',
      'ct-3',
      'ct-4',
      'test-1',
      'test-2',
      'test-3',
      'test-4',
      'test-integration',
    ]);
    // The shards go in shard order; each shard has its own key.
    expect(onSlots(r.slots)).toEqual(['test-1', 'test-2']);
    for (const key of ['test-3', 'test-4', 'build-web', 'test-integration', 'ct-1', 'ct-4'])
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
    // In the merge queue the longest jobs (Component Tests shards) take free slots first.
    const one = await route({ jobs: [running()] });
    expect(onSlots(one.slots)).toEqual(['ct-1']);
    // Four free slots: every Unit Tests shard, including shard 4, takes one.
    const four = await route({
      event: 'pull_request',
      env: { THRESHOLD: '4' },
      runners: [slot, slot, slot, slot],
    });
    expect(onSlots(four.slots)).toEqual(['test-1', 'test-2', 'test-3', 'test-4']);
  });

  it('routes each Component Tests shard through its own slot in the merge queue', () => {
    const workflow = read('.github/workflows/intent-pr.yml');
    const listed = JSON.parse(
      workflow.jobs.route.steps.find((s: { id?: string }) => s.id === 'slot-jobs').env.SLOT_JOBS,
    ) as { key: string; label: string; shards?: number; events?: string[]; minutes?: number }[];
    expect(listed.find((j) => j.key === 'ct')).toEqual({
      key: 'ct',
      label: 'gh-linux-8x',
      minutes: 36,
      shards: 4,
      events: ['merge_group'],
    });
    expect(workflow.jobs['test-ct'].with.slots).toBe('${{ needs.route.outputs.slots }}');
    expect(workflow.jobs['test-ct'].with.cloud).toBe('${{ needs.route.outputs.cloud }}');
    const browser = read('.github/workflows/browser-tests.yml');
    expect(browser.on.workflow_call.inputs.slots).toMatchObject({
      type: 'string',
      required: false,
      default: '{}',
    });
    expect(browser.jobs['test-ct']['runs-on']).toBe(
      "${{ fromJSON(inputs.slots || '{}')[format('ct-{0}', matrix.shard)] || fromJSON(inputs.cloud || '{}')['gh-linux-8x'] || fromJSON('[\"gh-linux-8x\"]') }}",
    );
    // The other browser suites never take a slot: straight to the burst runner.
    expect(browser.jobs['test-playwright']['runs-on']).toBe(
      `\${{ fromJSON(inputs.cloud || '{}')['gh-linux-8x'] || fromJSON('["gh-linux-8x"]') }}`,
    );
  });

  it('gives no slot to Component Tests shards on a queue run that skips them', async () => {
    // Slots are granted before the jobs start, so a skipped CT run must not hold them.
    // The slot-jobs step filters the list; the shared probe script stays unchanged.
    const workflow = read('.github/workflows/intent-pr.yml');
    const listStep = workflow.jobs.route.steps.find((s: { id?: string }) => s.id === 'slot-jobs');
    const filtered = (skip: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'slot-jobs-'));
      const out = join(dir, 'out');
      const r = spawnSync('bash', ['-c', listStep.run], {
        env: {
          PATH: process.env.PATH,
          SKIP_SLOT_KEYS: skip,
          SLOT_JOBS: listStep.env.SLOT_JOBS,
          GITHUB_OUTPUT: out,
        },
        encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);
      const list = readFileSync(out, 'utf8')
        .trim()
        .replace(/^list=/, '');
      rmSync(dir, { recursive: true, force: true });
      return list;
    };
    const skipped = await route({
      env: { SLOT_JOBS: filtered('ct'), THRESHOLD: '4' },
      runners: [slot, slot, slot, slot],
    });
    expect(onSlots(skipped.slots)).toEqual(['test-1', 'test-2', 'test-3', 'test-4']);
    expect(Object.keys(skipped.slots)).not.toContain('ct-1');
    const required = await route({
      env: { SLOT_JOBS: filtered(''), THRESHOLD: '4' },
      runners: [slot, slot, slot, slot],
    });
    expect(onSlots(required.slots)).toEqual(['ct-1', 'ct-2', 'ct-3', 'ct-4']);
    // The route job waits for release-fast-path and skips ct unless CT will run.
    expect(workflow.jobs.route.needs).toEqual(['release-fast-path']);
    expect(listStep['continue-on-error']).toBe(true);
    expect(listStep.env.SKIP_SLOT_KEYS).toBe(
      "${{ (needs.release-fast-path.outputs.ct_required != 'true' || needs.release-fast-path.outputs.fast_path == 'true') && 'ct' || '' }}",
    );
    const decide = workflow.jobs.route.steps.find((s: { id?: string }) => s.id === 'decide');
    expect(decide.env.SLOT_JOBS).toBe('${{ steps.slot-jobs.outputs.list }}');
  });

  it('runs Type Check & Lint on the free standard runner, outside the slot list', () => {
    // Measured medium-sized (3.2 busy cores, 11.7 GiB peak): it fits a 4-vCPU / 16 GB
    // ubuntu-24.04 runner. It never reads the router, so it cannot land on the 1-CPU small pool.
    const workflow = read('.github/workflows/intent-pr.yml');
    const checks = workflow.jobs.checks;
    expect(checks.name).toBe('Type Check & Lint');
    expect(checks['runs-on']).toBe('ubuntu-24.04');
    const listed = JSON.parse(
      workflow.jobs.route.steps.find((s: { id?: string }) => s.id === 'slot-jobs').env.SLOT_JOBS,
    ) as { key: string }[];
    expect(listed.map((j) => j.key)).not.toContain('checks');
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
    expect(Object.keys(r.slots)).toHaveLength(10);
    for (const labels of Object.values(r.slots)) expect(labels).toEqual(['gh-linux-8x']);
  });

  it('lists every routed heavy job once, with its hosted fallback', () => {
    const workflow = read('.github/workflows/intent-pr.yml');
    const listed = JSON.parse(
      workflow.jobs.route.steps.find((s: { id?: string }) => s.id === 'slot-jobs').env.SLOT_JOBS,
    ) as { key: string; label: string; shards?: number; events?: string[] }[];
    const readers = Object.entries(workflow.jobs as Record<string, { 'runs-on'?: string }>)
      .filter(([, job]) => job['runs-on']?.includes('needs.route.outputs.slots'))
      .map(([id, job]) => [id, job['runs-on']] as const);
    // Component Tests read their slots through browser-tests.yml (tested separately).
    expect(readers.map(([id]) => id).sort()).toEqual(
      listed
        .map((j) => j.key)
        .filter((key) => key !== 'ct')
        .sort(),
    );
    for (const [id, runner] of readers) {
      const entry = listed.find((j) => j.key === id)!;
      const key = entry.shards ? `format('${id}-{0}', matrix.shard)` : `'${id}'`;
      expect(runner).toBe(
        `\${{ fromJSON(needs.route.outputs.slots || '{}')[${key}] || fromJSON('["${entry.label}"]') }}`,
      );
    }
    // Queue-only jobs must say so, or they would hold a slot on every PR.
    for (const id of ['build-web', 'test-integration', 'ct'])
      expect(listed.find((j) => j.key === id)!.events).toEqual(['merge_group']);
  });

  it('reads the heavy slot count from the CI_LINUX_HEAVY_SLOTS variable', async () => {
    // Raising the org or repo variable alone grows the pool: 14 slots take every listed job.
    const slots14 = Array.from({ length: 14 }, () => slot);
    const grown = await route({ runners: slots14, env: { THRESHOLD: '14' } });
    expect(onSlots(grown.slots)).toHaveLength(10);
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
        (s: { id?: string }) => s.id === 'slot-jobs',
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
    expect(onSlots(baseline.slots)).toEqual(['ct-1']);
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
    // A free slot still wins over WarpBuild; in the queue the longest job, a
    // Component Tests shard, takes it.
    const one = await route({ jobs: [running()], env: { WARPBUILD_DISABLED: '' } });
    expect(onSlots(one.slots)).toEqual(['ct-1']);
    expect(one.slots['ct-2']).toEqual(WARP);
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
  const steps = (id: string) => (store.runs.steps as Step[]).find((s) => s.id === id)!;

  // Runs the action's real backend step: WarpBuild's cache needs a WarpBuild runner and is not available on Windows.
  const backend = (env: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-backend-'));
    const output = join(dir, 'out');
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // The fake pnpm reports the store under the configured store-dir, like pnpm 10.
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\necho "$npm_config_store_dir/v10"\n', {
      mode: 0o755,
    });
    const result = spawnSync('bash', ['-c', steps('backend').run!], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_OUTPUT: output,
        GITHUB_ENV: join(dir, 'env'),
        RUNNER_OS: 'Linux',
        HOME: '/fixture-home',
        ...env,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const value = readFileSync(output, 'utf8').trim();
    // One store directory on every Linux/macOS runner, so the cache path (and version)
    // matches across jobs; Windows keeps pnpm's default.
    expect(readFileSync(join(dir, 'env'), 'utf8').trim().split('\n')).toEqual(
      env.RUNNER_OS === 'Windows'
        ? ['PNPM_STORE_PATH=/v10']
        : [
            'npm_config_store_dir=/fixture-home/.pnpm-store',
            'PNPM_STORE_PATH=/fixture-home/.pnpm-store/v10',
          ],
    );
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
    expect(steps('warpbuild').with!.key).toBe(
      "pnpm-store-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('pnpm-lock.yaml') }}",
    );
    expect(steps('warpbuild').with!['restore-keys'].trim()).toBe(
      'pnpm-store-${{ runner.os }}-${{ runner.arch }}-',
    );
  });

  it('gives the cache actions a path that still exists when they save after the job', () => {
    // A cache action re-reads `path` in its post step. Composite inputs and step outputs are
    // gone by then ("Input required and not supplied: path"), so the path is a job env var
    // and no local composite sits between the job and the cache actions.
    expect(steps('warpbuild').with!.path).toBe('${{ env.PNPM_STORE_PATH }}');
    expect(steps('github').with!.path).toBe('${{ env.PNPM_STORE_PATH }}');
    expect(JSON.stringify(store.runs.steps)).not.toMatch(/inputs\.|uses":"\.\//);
  });

  it('routes the pnpm store through the backend-selecting action', () => {
    for (const file of workflows) {
      const text = readFileSync(`.github/workflows/${file}`, 'utf8');
      expect(text, file).not.toMatch(/^\s+cache: '?pnpm'?\s*$/m);
      expect(text, file).not.toMatch(/uses: WarpBuilds\//);
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
