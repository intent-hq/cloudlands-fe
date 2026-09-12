#!/usr/bin/env node
/**
 * Resolve a minified production cloudlands-fe stack trace to source positions.
 *
 *   pnpm resolve-stack <tag> < stack.txt
 *   pnpm resolve-stack --tag v2.141.0 --stack trace.txt
 *   pnpm resolve-stack --dist path/to/.svelte-kit/output/client < stack.txt
 *
 * Release builds ship no sourcemaps (INTENT_DISABLE_SOURCEMAPS=1, see
 * .github/workflows/release-alpha.yml), so the script rebuilds the renderer at
 * the given tag with `hidden` sourcemaps in a scratch git worktree under
 * $TMPDIR/cloudlands-fe-resolve-stack/<tag>/ — `pnpm install --frozen-lockfile`
 * plus the tag's own `build:renderer` chain minus the sourcemap kill switch.
 * Hidden maps do not change chunk contents, so the local chunk hashes match the
 * release. The scratch worktree is kept and reused on the next run for the same
 * tag; `--rebuild` forces a fresh build and `--dist <dir>` points at any
 * existing build output that already contains `*.js.map` files. Maps are read
 * from `.svelte-kit/output/client` rather than the `dist/renderer` copy because
 * their `sources` are relative to where Vite emitted them.
 *
 * Input is one frame per line in V8 (`at fn (url:L:C)`), Gecko (`fn@url:L:C`) or
 * bare `file.js:L[:C]` form; every other line is echoed unchanged. Output per
 * frame is `source:line:col name    <- chunk:L:C (minifiedName)`; frames that
 * cannot be resolved are echoed with a trailing `# unresolved: <reason>`.
 *
 * Chunk hashes are content hashes, so a frame whose hash is not in the local
 * build cannot be mapped exactly. Route-node chunks (`nodes/<id>.<hash>.js`)
 * keep a stable id across builds, so such a frame is mapped through this
 * build's node of the same id and marked `# approximate`; treat those
 * positions as a hint (the #4550 workspace-page frames were one such case,
 * where a Linux rebuild of a macOS release differed in that one chunk).
 *
 * Related: intent-hq/intent#4561 (the #4550 investigation that motivated this).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pnpmInvocation } from './pnpm-launcher.mjs';
import {
  formatFrame,
  indexSourceMaps,
  planRendererBuild,
  resolveStack,
} from './resolve-stack-lib.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_RELATIVE = join('.svelte-kit', 'output', 'client');
const PREREQUISITE_SCRIPTS = ['generate:build-config', 'generate:ipc-channels', 'generate:i18n'];
// Sourcemap generation multiplies rollup's peak heap; mirror the release
// workflow's cap unless the caller pinned one (vite-build.mjs passes it through).
const DEFAULT_HEAP_FLAG = '--max-old-space-size=12288';

function usage(message) {
  if (message) console.error(`resolve-stack: ${message}\n`);
  console.error(
    'Usage: pnpm resolve-stack (<tag> | --tag <tag> | --dist <build-output-dir>) [--stack <file>] [--rebuild]',
  );
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const options = { tag: null, dist: null, stack: null, rebuild: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage();
    else if (arg === '--rebuild') options.rebuild = true;
    else if (arg === '--tag' || arg === '--dist' || arg === '--stack') {
      const value = argv[i + 1];
      if (value === undefined) usage(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith('-')) usage(`unknown option ${arg}`);
    else if (options.tag) usage(`unexpected argument ${arg}`);
    else options.tag = arg;
  }
  if (!options.tag && !options.dist) usage('a release tag or --dist directory is required');
  return options;
}

function run(command, args, { cwd, env = {} }) {
  const inv =
    command === 'pnpm' ? pnpmInvocation(args) : { executable: command, args, shell: false };
  if (command === 'node') inv.executable = process.execPath;
  console.error(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(inv.executable, inv.args, {
    cwd,
    stdio: 'inherit',
    shell: inv.shell,
    env: {
      ...process.env,
      ...env,
      PATH: [join(cwd, 'node_modules', '.bin'), process.env.PATH].filter(Boolean).join(delimiter),
    },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
  }
}

function git(args, options = {}) {
  const result = spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', ...options });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr ?? '').trim()}`);
  }
  return result;
}

function ensureWorktree(tag, dir) {
  if (existsSync(join(dir, '.git'))) return;
  if (
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { allowFailure: true }).status !==
    0
  ) {
    console.error(`Fetching tag ${tag} from origin…`);
    git(['fetch', '--no-tags', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]);
  }
  mkdirSync(dirname(dir), { recursive: true });
  git(['worktree', 'prune']);
  git(['worktree', 'add', '--detach', dir, `refs/tags/${tag}`], { stdio: 'inherit' });
}

function buildWithSourcemaps(dir) {
  const scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts ?? {};
  if (!scripts['build:renderer']) {
    throw new Error(`package.json at ${dir} has no build:renderer script; use --dist instead`);
  }
  const steps = planRendererBuild(scripts['build:renderer']);
  const nodeOptions = process.env.NODE_OPTIONS ?? '';
  const heap = /--max[-_]old[-_]space[-_]size/.test(nodeOptions)
    ? {}
    : { NODE_OPTIONS: [nodeOptions, DEFAULT_HEAP_FLAG].filter(Boolean).join(' ') };
  run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: dir });
  for (const name of PREREQUISITE_SCRIPTS) {
    if (!scripts[name]) continue;
    run('pnpm', ['run', name], {
      cwd: dir,
      env: { GIT_TERMINAL_PROMPT: '0', NODE_ENV: 'production' },
    });
  }
  for (const step of steps)
    run(step.command, step.args, { cwd: dir, env: { ...heap, ...step.env } });
}

function prepareDist({ tag, dist, rebuild }) {
  if (dist) return { distDir: resolve(dist), baseDir: REPO_ROOT };
  const dir = join(tmpdir(), 'cloudlands-fe-resolve-stack', tag.replace(/[^\w.-]/g, '_'));
  const distDir = join(dir, DIST_RELATIVE);
  if (rebuild) rmSync(distDir, { recursive: true, force: true });
  ensureWorktree(tag, dir);
  if (!existsSync(distDir) || indexSourceMaps(distDir).size === 0) {
    console.error(`Building ${tag} with hidden sourcemaps in ${dir} (reused on the next run)…`);
    buildWithSourcemaps(dir);
  } else console.error(`Reusing sourcemap build of ${tag} in ${dir} (pass --rebuild to redo it)`);
  return { distDir, baseDir: dir };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const stack = readFileSync(options.stack ?? 0, 'utf8').replace(/\n$/, '');
  const { distDir, baseDir } = prepareDist(options);
  const index = existsSync(distDir) ? indexSourceMaps(distDir) : new Map();
  if (index.size === 0) throw new Error(`no *.js.map files under ${distDir}`);
  let unresolved = 0;
  for (const entry of resolveStack(stack, { index, baseDir })) {
    if (entry.kind === 'frame' && !entry.resolved) unresolved += 1;
    console.log(formatFrame(entry));
  }
  if (unresolved) console.error(`resolve-stack: ${unresolved} frame(s) left unresolved`);
}

try {
  main();
} catch (error) {
  console.error(`resolve-stack: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
