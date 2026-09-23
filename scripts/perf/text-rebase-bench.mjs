// pnpm perf:text-rebase --base <ref> [--head <ref>] [--runs N] [--repeats N] [--shapes a,b] [--json <file>]
//
// Paired head-vs-base bench of the text-rebase alignment. Each tree named by
// a ref is checked out as a detached `git worktree` under this package
// (`.wt-bench-<tree>-<sha>-<pid>/`, gitignored by `.wt-*/`) so its bare
// imports resolve to THIS package's node_modules; `--head` omitted benches the
// working tree. For i in 1..runs it spawns one fresh runner process for head,
// then one for base (`vitest.text-rebase-bench.config.ts` with
// TEXT_REBASE_BENCH_SRC pointing into the tree), aggregates the documents per
// shape x clock x phase and prints one table. Worktrees are removed on exit,
// failure and Ctrl-C. Exit 0 on success, 1 on runtime failure, 2 on usage.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  USAGE,
  aggregate,
  formatHeader,
  formatTable,
  mapperModeOf,
  parseArgs,
} from './text-rebase-bench-lib.mjs';

class UsageError extends Error {}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const benchConfig = path.join(packageDir, 'vitest.text-rebase-bench.config.ts');
const require = createRequire(import.meta.url);
const vitestBin = path.join(
  path.dirname(require.resolve('vitest/package.json')),
  require('vitest/package.json').bin.vitest,
);

const git = (...args) => execFileSync('git', args, { cwd: packageDir, encoding: 'utf8' }).trim();

function resolveRef(flag, ref) {
  try {
    return git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    throw new UsageError(`${flag} ${ref} is not a commit in ${packageDir}.`);
  }
}

const worktrees = new Set();
let child = null;
let interrupted = false;

function removeWorktrees() {
  for (const dir of worktrees) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', dir], {
        cwd: packageDir,
        stdio: 'ignore',
      });
    } catch {
      // Already gone or half-created: prune drops the stale registration.
    }
    worktrees.delete(dir);
  }
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: packageDir, stdio: 'ignore' });
  } catch {
    // Nothing to prune.
  }
}

function addWorktree(tree, sha) {
  const dir = path.join(packageDir, `.wt-bench-${tree}-${sha.slice(0, 12)}-${process.pid}`);
  worktrees.add(dir);
  git('worktree', 'add', '--detach', '--quiet', dir, sha);
  return dir;
}

function onSignal(signal) {
  interrupted = true;
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // The runner already exited.
    }
  }
  removeWorktrees();
  process.exit(signal === 'SIGINT' ? 130 : 143);
}
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
process.on('exit', removeWorktrees);

function runBench({ tree, src, sha, repeats, shapes }) {
  const env = {
    ...process.env,
    TEXT_REBASE_BENCH_SRC: src,
    TEXT_REBASE_BENCH_TREE: tree,
    TEXT_REBASE_BENCH_SHA: sha,
    TEXT_REBASE_BENCH_REPEATS: String(repeats),
  };
  delete env.TEXT_REBASE_BENCH_OUT;
  if (shapes) env.TEXT_REBASE_BENCH_SHAPES = shapes.join(',');
  else delete env.TEXT_REBASE_BENCH_SHAPES;
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [vitestBin, 'run', '--config', benchConfig], {
      cwd: packageDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      child = null;
      if (interrupted) return reject(new Error('interrupted'));
      if (code !== 0) {
        const detail = stderr.trim().split('\n').slice(-20).join('\n');
        const failure = new Error(`${tree} runner exited with ${signal ?? code}\n${detail}`);
        return reject(
          detail.includes('TEXT_REBASE_BENCH_SHAPES') ? new UsageError(failure.message) : failure,
        );
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(
          new Error(
            `${tree} runner wrote no JSON document\n${stderr.trim().split('\n').slice(-20).join('\n')}`,
          ),
        );
      }
    });
  });
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    throw new UsageError(`${error.message}\n${USAGE}`);
  }
  if (!existsSync(benchConfig)) throw new Error(`${benchConfig} is missing`);
  const baseSha = resolveRef('--base', options.base);
  const headSha = options.head ? resolveRef('--head', options.head) : git('rev-parse', 'HEAD');
  const trees = {
    base: {
      sha: baseSha,
      src: path.join(addWorktree('base', baseSha), 'src'),
      label: `${options.base} (${baseSha.slice(0, 12)})`,
    },
    head: options.head
      ? {
          sha: headSha,
          src: path.join(addWorktree('head', headSha), 'src'),
          label: `${options.head} (${headSha.slice(0, 12)})`,
        }
      : {
          sha: headSha,
          src: path.join(packageDir, 'src'),
          label: `working tree (${headSha.slice(0, 12)}${git('status', '--porcelain', '--untracked-files=no') ? ', dirty' : ''})`,
        },
  };
  const documents = { head: [], base: [] };
  const startedAt = Date.now();
  for (let run = 1; run <= options.runs; run += 1) {
    for (const tree of ['head', 'base']) {
      const runStart = Date.now();
      process.stderr.write(`run ${run}/${options.runs} ${tree} ${trees[tree].label} ... `);
      documents[tree].push(
        await runBench({ tree, ...trees[tree], repeats: options.repeats, shapes: options.shapes }),
      );
      process.stderr.write(`${((Date.now() - runStart) / 1000).toFixed(1)} s\n`);
    }
  }
  const summary = aggregate(documents.head, documents.base);
  const meta = {
    head: trees.head.label,
    headMode: mapperModeOf('head', documents.head),
    base: trees.base.label,
    baseMode: mapperModeOf('base', documents.base),
    runs: options.runs,
    repeats: options.repeats,
    shapes: options.shapes?.join(','),
    node: process.version,
  };
  process.stdout.write(`${formatHeader(meta)}\n\n${formatTable(summary)}\n`);
  if (options.json) {
    const out = path.resolve(options.json);
    const payload = {
      ...meta,
      headSha,
      baseSha,
      elapsedMs: Date.now() - startedAt,
      summary,
      documents,
    };
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`);
    process.stderr.write(`wrote ${out}\n`);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`perf:text-rebase: ${error instanceof Error ? error.message : error}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
} finally {
  removeWorktrees();
}
