// @verify-changed-triggers: .github/workflows/intent-pr.yml, .github/workflows/manual-signed-build.yml, .github/actions/depot-rust-cache/action.yml
// @vitest-environment node
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const require = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load } = require('js-yaml');
const read = (path: string) => load(readFileSync(path, 'utf8'));

describe('Depot CI runners', () => {
  it('routes Linux jobs to Depot without querying the local fleet', async () => {
    const route = read('.github/workflows/intent-pr.yml').jobs.route;
    const values: Record<string, string> = {};
    const script = route.steps.find((step: { id?: string }) => step.id === 'decide').with.script;
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction('core', 'github', script)(
      {
        setOutput: (key: string, value: string) => {
          values[key] = value;
        },
      },
      new Proxy(
        {},
        {
          get() {
            throw new Error('Runner selection must not call GitHub');
          },
        },
      ),
    );
    expect(JSON.parse(values.linux_labels)).toEqual(['depot-ubuntu-24.04-8']);
    expect(values.linux_burst).toBe('true');
    expect(route.permissions).toEqual({ contents: 'read' });
  });

  it('uses Depot for every static job', () => {
    for (const file of readdirSync('.github/workflows').filter((name) => name.endsWith('.yml'))) {
      const jobs = read(`.github/workflows/${file}`).jobs;
      for (const job of Object.values(jobs) as { 'runs-on'?: string }[]) {
        const runner = job['runs-on'];
        if (runner && !runner.includes('${{')) expect(runner, file).toMatch(/^depot-/);
      }
    }
  });

  it('requires managed cache and never persists credentials', () => {
    const setup = read('.github/actions/depot-rust-cache/action.yml').runs.steps[0].run;
    const dir = mkdtempSync(join(tmpdir(), 'depot-env-'));
    try {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('SCCACHE_')),
      );
      const file = join(dir, 'env');
      const missing = spawnSync('bash', ['-eu', '-c', setup], {
        env: { ...env, GITHUB_ENV: file },
        encoding: 'utf8',
      });
      expect(missing.status).not.toBe(0);
      const configured = spawnSync('bash', ['-eu', '-c', setup], {
        env: {
          ...env,
          GITHUB_ENV: file,
          SCCACHE_WEBDAV_ENDPOINT: 'https://cache.depot.dev',
          SCCACHE_WEBDAV_TOKEN: 'secret-fixture',
        },
        encoding: 'utf8',
      });
      expect(configured.status, configured.stderr).toBe(0);
      const output = readFileSync(file, 'utf8');
      expect(output).toContain('RUSTC_WRAPPER=sccache');
      expect(output).toContain('CARGO_INCREMENTAL=0');
      expect(output).not.toContain('SCCACHE_DIR');
      expect(output + configured.stdout + configured.stderr).not.toContain('secret-fixture');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
