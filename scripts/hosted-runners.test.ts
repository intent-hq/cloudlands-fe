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
  };
  async function route({ runners = [slot, slot], jobs = [], error = false, env = {} }: Fixture) {
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
        // Fixture jobs belong to one queued run so each is counted once.
        return {
          data: {
            workflow_runs: repo === 'cloudlands-fe' && status === 'queued' ? [{ id: 2 }] : [],
          },
        };
      },
      listJobsForWorkflowRun: async () => ({ data: { jobs } }),
    };
    const processEnv = {
      env: { THRESHOLD: String(workflow.env.LINUX_BURST_THRESHOLD), ...env },
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
      { repo: { owner: 'intent-hq', repo: 'cloudlands-fe' }, runId: 1 },
      processEnv,
    );
    return {
      labels: JSON.parse(values.linux_labels),
      burst: values.linux_burst,
      messages,
      queried,
    };
  }
  const running = (labels = CACHE) => ({ status: 'in_progress', labels });

  it('routes the heavy jobs to an idle intent-cache slot', async () => {
    const r = await route({});
    expect(r.labels).toEqual(CACHE);
    expect(r.burst).toBe('false');
    expect([...new Set(r.queried)].sort()).toEqual(['cloudlands-fe', 'intent', 'intentd']);
    expect(read('.github/workflows/intent-pr.yml').env.LINUX_BURST_THRESHOLD).toBe(2);
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
      jobs: [
        running(),
        ...Array.from({ length: 5 }, () => running(['self-hosted', 'Linux', 'X64'])),
      ],
    });
    expect(r.labels).toEqual(CACHE);
    expect(r.messages.some((m) => m.includes('queue depth=1 threshold=2 online=2'))).toBe(true);
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
    const r = await route({ runners: [slot, slot, small], jobs: fastJobs });
    expect(r.labels).toEqual(CACHE);
    expect(r.messages.some((m) => m.includes('queue depth=0 threshold=2 online=2'))).toBe(true);
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
