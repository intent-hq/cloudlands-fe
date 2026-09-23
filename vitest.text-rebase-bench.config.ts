/**
 * Vitest config of the text-rebase alignment bench: runs
 * `src/lib/notes/text-rebase-bench.runner.ts` (which `test:unit` never picks
 * up) under `vitest.config.ts`'s environment against ONE source tree and
 * writes the JSON document the bench orchestrator aggregates —
 * `{ tree, sha, rows: [{ shape, clock, phase, ms, deadlineHit }] }` — to the
 * file named by `TEXT_REBASE_BENCH_OUT`, else as the only thing on stdout.
 *
 *   TEXT_REBASE_BENCH_SRC=<abs path to a checkout's src/> \
 *     pnpm vitest run --config vitest.text-rebase-bench.config.ts
 *
 * Env: `TEXT_REBASE_BENCH_SRC` (default: this package's `src/`),
 * `TEXT_REBASE_BENCH_TREE` (`head` | `base`, default `head`),
 * `TEXT_REBASE_BENCH_SHA` (default: `git rev-parse HEAD` of the tree),
 * `TEXT_REBASE_BENCH_OUT`, and the runner's `TEXT_REBASE_BENCH_REPEATS` /
 * `TEXT_REBASE_BENCH_SHAPES`.
 *
 * The runner's `./text-rebase` import is redirected into the tree under test;
 * from there, `$lib`-style aliases (rewritten to this `src/` by the alias
 * plugin before reaching us) and relative imports stay inside it, a module it
 * lacks (gitignored generated output such as `src/shared/paraglide/`) falls
 * back to this tree, and bare packages resolve from this package's
 * `node_modules`. Tests time out never: a hang is the operator's to kill.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig, mergeConfig } from 'vitest/config';
import type { Reporter, TestModule } from 'vitest/node';
import type { SerializedError } from 'vitest';
import baseConfig from './vitest.config';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const currentSrc = path.join(packageDir, 'src');
const runnerFile = path.join(currentSrc, 'lib/notes/text-rebase-bench.runner.ts');
const benchSrc = path.resolve(process.env.TEXT_REBASE_BENCH_SRC || currentSrc);
const treeName = process.env.TEXT_REBASE_BENCH_TREE || 'head';
const outPath = process.env.TEXT_REBASE_BENCH_OUT;

if (!existsSync(path.join(benchSrc, 'lib/notes/text-rebase.ts'))) {
  throw new Error(`TEXT_REBASE_BENCH_SRC=${benchSrc} holds no lib/notes/text-rebase.ts`);
}
if (treeName !== 'head' && treeName !== 'base') {
  throw new Error(`TEXT_REBASE_BENCH_TREE must be head or base, got ${JSON.stringify(treeName)}`);
}

// Mirrors the alias table of vitest.config.ts for specifiers that reach the
// plugin before the alias plugin rewrote them.
const ALIASES: Array<[find: string, dir: string]> = [
  ['$lib', 'lib'],
  ['$store', 'store'],
  ['$features', 'features'],
  ['$shared', 'shared'],
  ['@', ''],
];

function benchTreePlugin(): Plugin {
  const under = (file: string, dir: string) => file === dir || file.startsWith(dir + path.sep);
  return {
    name: 'text-rebase-bench-tree',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const importerFile = importer.split('?')[0];
      const resolve = (id: string, from = importer) =>
        this.resolve(id, from, { ...options, skipSelf: true });
      if (importerFile === runnerFile) {
        return source === './text-rebase'
          ? resolve(path.join(benchSrc, 'lib/notes/text-rebase.ts'))
          : null;
      }
      if (!under(importerFile, benchSrc)) return null;
      let mirrored: string | undefined;
      if (under(source, currentSrc)) mirrored = source;
      else {
        const alias = ALIASES.find(([find]) => source === find || source.startsWith(find + '/'));
        if (alias) mirrored = path.join(currentSrc, alias[1], source.slice(alias[0].length));
      }
      if (mirrored !== undefined) {
        return (await resolve(benchSrc + mirrored.slice(currentSrc.length))) ?? resolve(mirrored);
      }
      if (source.startsWith('.') || source.startsWith('\0') || path.isAbsolute(source)) return null;
      return resolve(source, runnerFile);
    },
  };
}

class BenchReporter implements Reporter {
  onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
    reason: 'passed' | 'interrupted' | 'failed',
  ): void {
    const rows: unknown[] = [];
    const failures = unhandledErrors.map((error) => error.message);
    for (const testModule of testModules) {
      failures.push(...testModule.errors().map((error) => error.message));
      for (const test of testModule.children.allTests()) {
        const result = test.result();
        if (result.state === 'failed') {
          failures.push(
            `${test.fullName}: ${result.errors.map((error) => error.message).join('; ')}`,
          );
        }
        rows.push(...((test.meta() as { textRebaseBench?: unknown[] }).textRebaseBench ?? []));
      }
    }
    if (reason !== 'passed' || failures.length > 0 || rows.length === 0) {
      const detail = failures.length > 0 ? failures.join('\n') : `${rows.length} rows`;
      process.stderr.write(`text-rebase bench: run ${reason}, no document written\n${detail}\n`);
      return;
    }
    const sha =
      process.env.TEXT_REBASE_BENCH_SHA ||
      execFileSync('git', ['-C', path.dirname(benchSrc), 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
    const json = `${JSON.stringify({ tree: treeName, sha, rows })}\n`;
    if (outPath) writeFileSync(outPath, json);
    else process.stdout.write(json);
  }
}

export default defineConfig(async (env) =>
  mergeConfig(await baseConfig(env), {
    root: packageDir,
    // Keeps Svelte compile warnings off stdout, which carries the document when
    // TEXT_REBASE_BENCH_OUT is unset.
    logLevel: 'error',
    plugins: [benchTreePlugin()],
    test: {
      name: 'text-rebase-bench',
      include: [path.relative(packageDir, runnerFile)],
      testTimeout: 0,
      hookTimeout: 0,
      maxWorkers: 1,
      fileParallelism: false,
      reporters: outPath ? ['default', new BenchReporter()] : [new BenchReporter()],
    },
  }),
);
