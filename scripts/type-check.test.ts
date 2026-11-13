// @verify-changed-triggers: scripts/type-check.ts, package.json, .github/workflows/intent-pr.yml
// @vitest-environment node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve('tsx/cli');
const { load } = require('js-yaml') as { load: (source: string) => unknown };
const SKIP_RENDERER = 'TYPE_CHECK_SKIP_RENDERER';
const temporaryPaths: string[] = [];

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function tsconfig(files: string[]) {
  return JSON.stringify({
    compilerOptions: { strict: true, skipLibCheck: true, target: 'ES2022', types: [] },
    files,
  });
}

/**
 * The three app programs in miniature. The main and preload programs include a file that
 * only their generator creates, so a check that skips generation fails with TS6053.
 */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'type-check-test-'));
  temporaryPaths.push(root);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(resolve('scripts/type-check.ts'), join(root, 'scripts/type-check.ts'));
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'junction');
  write(root, 'package.json', JSON.stringify({ type: 'module' }));
  write(
    root,
    'scripts/generate-build-config.cjs',
    "require('fs').writeFileSync('src/main/build-config.generated.ts', 'export const BUILD_CONFIG = {};\\n');\n",
  );
  write(root, 'scripts/paraglide-inputs-hash.mjs', '');
  write(
    root,
    'scripts/inline-ipc-channels.ts',
    "import { writeFileSync } from 'fs';\nwriteFileSync('src/preload/index.ts', 'export const channels: string[] = [];\\n');\n",
  );
  write(root, 'tsconfig.json', tsconfig(['src/renderer/app.ts']));
  write(
    root,
    'tsconfig.main.json',
    tsconfig(['src/main/index.ts', 'src/main/build-config.generated.ts']),
  );
  write(root, 'tsconfig.preload.json', tsconfig(['src/preload/bridge.ts', 'src/preload/index.ts']));
  write(root, 'src/renderer/app.ts', 'export const app = 1;\n');
  write(root, 'src/main/index.ts', 'export const main = 1;\n');
  write(root, 'src/preload/bridge.ts', 'export const bridge = 1;\n');
  return root;
}

function typeCheckWith(env: NodeJS.ProcessEnv, root: string, ...args: string[]) {
  const base = { ...process.env };
  delete base[SKIP_RENDERER];
  delete base.GITHUB_ACTIONS;
  return spawnSync(process.execPath, [TSX_CLI, 'scripts/type-check.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...base, NODE_COMPILE_CACHE: join(root, 'node-compile-cache'), ...env },
  });
}

const typeCheck = (root: string, ...args: string[]) => typeCheckWith({}, root, ...args);

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('type-check', { timeout: 60_000 }, () => {
  it('generates inputs and passes a clean tree silently in quiet mode', () => {
    const result = typeCheck(fixtureRoot(), '--quiet');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toBe('');
  });

  it.each([
    ['renderer', 'src/renderer/app.ts'],
    ['main', 'src/main/index.ts'],
    ['preload', 'src/preload/bridge.ts'],
  ])('fails on a %s type error and prints it in quiet mode', (name, file) => {
    const root = fixtureRoot();
    write(root, file, "export const broken: number = 'text';\n");
    const result = typeCheck(root, '--quiet');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain('TS2322');
    expect(result.stderr).toContain(`Type check failed: ${name}`);
  });

  it('checks only the selected program with --project', () => {
    const root = fixtureRoot();
    write(root, 'src/main/index.ts', "export const broken: number = 'text';\n");
    const result = typeCheck(root, '--project=renderer');
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('skips only the renderer under GitHub Actions when TYPE_CHECK_SKIP_RENDERER=1', () => {
    const root = fixtureRoot();
    write(root, 'src/renderer/app.ts', "export const broken: number = 'text';\n");
    const ci = { [SKIP_RENDERER]: '1', GITHUB_ACTIONS: 'true' };

    const rendererOnly = typeCheckWith(ci, root, '--project=renderer');
    expect(rendererOnly.status, rendererOnly.stdout + rendererOnly.stderr).toBe(0);
    expect(rendererOnly.stdout).toContain('Renderer type check skipped');

    const all = typeCheckWith(ci, root);
    expect(all.status, all.stdout + all.stderr).toBe(0);
    expect(all.stdout).toContain('Type checking main, preload...');

    write(root, 'src/main/index.ts', "export const broken: number = 'text';\n");
    const mainBroken = typeCheckWith(ci, root);
    expect(mainBroken.status).toBe(1);
    expect(mainBroken.stderr).toContain('Type check failed: main');
  });

  it.each([[{ [SKIP_RENDERER]: '1' }], [{ [SKIP_RENDERER]: 'true', GITHUB_ACTIONS: 'true' }]])(
    'still checks the renderer with %o',
    (env) => {
      const root = fixtureRoot();
      write(root, 'src/renderer/app.ts', "export const broken: number = 'text';\n");
      const result = typeCheckWith(env, root, '--project=renderer');
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Type check failed: renderer');
    },
  );

  it.each([['--project=web'], ['--project'], ['validate']])('rejects %s', (arg) => {
    const result = typeCheck(fixtureRoot(), arg);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage:');
  });
});

type Env = Record<string, unknown>;
type Step = { name?: string; run?: string; env?: Env; if?: unknown; 'continue-on-error'?: unknown };
type Job = { name?: string; env?: Env; steps: Step[] };

/** Every command a workflow `run:` reaches through the package.json scripts graph. */
function expandCommands(
  scripts: Record<string, string>,
  command: string,
  seen = new Set<string>(),
) {
  const commands = command
    .split(/&&|\|\||;|\n/)
    .map((part) => part.trim().replace(/^(?:\w+=\S*\s+)+/, ''));
  for (const part of [...commands]) {
    const target = /^(?:pnpm(?:\s+run)?|node scripts\/pnpm-run\.mjs)(?:\s+-\S+)*\s+([\w:.-]+)/.exec(
      part,
    )?.[1];
    if (!target || !(target in scripts) || seen.has(target)) continue;
    seen.add(target);
    commands.push(...expandCommands(scripts, scripts[target], seen));
  }
  return commands;
}

/** Commands that type-check the renderer program; `env` is the step's effective env. */
function rendererTypeChecks(scripts: Record<string, string>, run: string, env: Env = {}) {
  const skipped = String(env[SKIP_RENDERER] ?? '') === '1';
  return expandCommands(scripts, run).filter((command) => {
    if (/(?:^|[\s/])tsc\b/.test(command)) {
      const project = /(?:-p|--project)[=\s]+(\S+)/.exec(command)?.[1];
      return !project || /^(?:\.\/)?tsconfig\.json$/.test(project);
    }
    if (!/scripts\/type-check\.ts\b/.test(command) || skipped) return false;
    const projects = [...command.matchAll(/--project[= ](\w+)/g)].map(([, name]) => name);
    return projects.length === 0 || projects.includes('renderer');
  });
}

describe('PR workflow "Type Check & Lint" job', () => {
  const scripts: Record<string, string> = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  const workflow = load(readFileSync('.github/workflows/intent-pr.yml', 'utf8')) as {
    env?: Env;
    jobs: Record<string, Job>;
  };
  const job = Object.values(workflow.jobs).find(({ name }) => name === 'Type Check & Lint')!;

  it.each([
    ['pnpm run validate:architecture', {}, 1],
    ['pnpm run validate:architecture', { [SKIP_RENDERER]: '1' }, 0],
    ['FOO=1 pnpm run --silent validate:architecture', {}, 1],
    ['pnpm -s type-check', {}, 1],
    ['pnpm exec tsc --noEmit -p tsconfig.preload.json', {}, 0],
    ['pnpm exec tsc --noEmit -p tsconfig.json', { [SKIP_RENDERER]: '1' }, 1],
    ['pnpm exec tsc --noEmit --project ./tsconfig.json', {}, 1],
    ['npx tsc --noEmit', {}, 1],
  ])('counts %s with env %o as %i renderer check(s)', (run, env, count) => {
    expect(rendererTypeChecks(scripts, run, env)).toHaveLength(count);
  });

  it('type-checks the renderer exactly once, in its own step', () => {
    const runs = job.steps.flatMap((step) =>
      rendererTypeChecks(scripts, step.run ?? '', {
        ...workflow.env,
        ...job.env,
        ...step.env,
      }).map(() => step.name),
    );
    expect(runs).toEqual(['Type check (renderer)']);
  });

  it('lets a renderer type error fail the job before the step that skips it', () => {
    const step = job.steps.find(({ name }) => name === 'Type check (renderer)')!;
    expect(step.if).toBeUndefined();
    expect(step['continue-on-error']).toBeUndefined();
  });
});
