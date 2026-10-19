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
  'macos-15-xlarge',
]);
// Runners chosen through a matrix: `runner: <label>` rows and JSON `"runner":"<label>"` targets.
const matrixRunners = (text: string) => [
  ...[...text.matchAll(/^\s+runner: ([\w.-]+)\s*$/gm)].map((m) => m[1]),
  ...[...text.matchAll(/"runner":"([^"]+)"/g)].map((m) => m[1]),
];

describe('GitHub-hosted CI runners', () => {
  it.each(['healthy', 'offline', 'busy', 'error'])('routes the %s fleet safely', async (state) => {
    const route = read('.github/workflows/intent-pr.yml').jobs.route;
    const values: Record<string, string> = {};
    const script = route.steps.find((step: { id?: string }) => step.id === 'decide').with.script;
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const actions = {
      listSelfHostedRunnersForOrg: () => {},
      listSelfHostedRunnersForRepo: () => {},
      listWorkflowRunsForRepo: async () => ({ data: { workflow_runs: [{ id: 2 }] } }),
      listJobsForWorkflowRun: async () => ({
        data: {
          jobs:
            state === 'busy'
              ? Array.from({ length: 10 }, () => ({
                  status: 'in_progress',
                  labels: ['self-hosted', 'Linux'],
                }))
              : [],
        },
      }),
    };
    await new AsyncFunction('core', 'github', 'context', script)(
      {
        setOutput: (key: string, value: string) => {
          values[key] = value;
        },
        info: () => {},
      },
      {
        rest: { actions },
        paginate: async () => {
          if (state === 'error') throw new Error('fixture failure');
          return state === 'offline'
            ? []
            : [
                {
                  status: 'online',
                  labels: ['self-hosted', 'Linux', 'X64'].map((name) => ({ name })),
                },
              ];
        },
      },
      { repo: { owner: 'intent-hq', repo: 'cloudlands-fe' }, runId: 1 },
    );
    expect(JSON.parse(values.linux_labels)).toEqual(
      state === 'healthy' ? ['self-hosted', 'Linux', 'X64'] : ['gh-linux-8x'],
    );
    expect(values.linux_burst).toBe(state === 'healthy' ? 'false' : 'true');
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

  it('configures managed caching without Rust cache actions', () => {
    const result = spawnSync('python3', ['-B', 'scripts/test-setup-sccache.py'], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  });
});
