// Resolve with the installed runner, not a second approximation of its import graph.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUiInvariantSuites } from './ui-invariant-suites.mjs';

const self = fileURLToPath(import.meta.url);
const unitIds = new Set([
  'vitest-direct',
  'vitest-related',
  'vitest-declared',
  'vitest-full',
  'vitest-ui-invariants',
]);

export async function resolveUnitSelections(plan, root) {
  const selections = [];
  for (const check of plan.checks.filter((check) => unitIds.has(check.id))) {
    const directory = mkdtempSync(join(tmpdir(), 'verify-unit-selection-'));
    const output = join(directory, 'files.json');
    try {
      let args = check.args.slice(2);
      if (check.id === 'vitest-ui-invariants') {
        const inventory = listUiInvariantSuites(root);
        if (inventory.violations.length || !inventory.suites.length) {
          throw new Error(inventory.violations.join('\n') || 'No UI invariant suites found');
        }
        args = ['run', '--config', 'vitest.config.ts', ...inventory.suites];
      }
      await new Promise((done, reject) => {
        const child = spawn(process.execPath, [self, output, ...args], {
          cwd: root,
          stdio: ['ignore', 'inherit', 'pipe'],
        });
        let diagnostic = '';
        child.stderr.on('data', (chunk) => {
          diagnostic += chunk;
        });
        child.on('error', reject);
        child.on('close', (code, signal) =>
          code === 0
            ? done()
            : reject(new Error(diagnostic.trim() || `exit ${code}, signal ${signal}`)),
        );
      });
      const files = JSON.parse(readFileSync(output, 'utf8'));
      if (!Array.isArray(files) || files.some((file) => typeof file !== 'string'))
        throw new Error('Invalid Vitest file discovery result');
      selections.push({ id: check.id, files: [...new Set(files)].sort() });
    } catch (error) {
      // Keep already resolved lanes visible if a later lane cannot be discovered.
      error.message = `Cannot resolve ${check.id}: ${error.message}`;
      error.selections = selections;
      throw error;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  return selections;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(self)) {
  let vitest;
  try {
    const { createVitest, parseCLI } = await import('vitest/node');
    // Match prepareVitest's CLI defaults before evaluating user configuration.
    process.env.TEST = 'true';
    process.env.VITEST = 'true';
    process.env.NODE_ENV ??= 'test';
    const [output, ...argv] = process.argv.slice(2);
    const { filter, options } = parseCLI(['vitest', ...argv]);
    // Match the CLI normalization; discovery never collects/imports test bodies.
    if (options.exclude) {
      options.cliExclude = options.exclude;
      delete options.exclude;
    }
    if (filter.some((file) => file.includes(':'))) options.includeTaskLocation ??= true;
    vitest = await createVitest('test', {
      ...options,
      root: options.root ?? process.cwd(),
      watch: false,
      run: true,
    });
    let specifications = await vitest.getRelevantTestSpecifications(filter);
    if (vitest.config.experimental.preParse) {
      // The runner can discard statically skipped files before sharding. Its
      // parser reads syntax only; it does not import suites or execute bodies.
      await vitest.experimental_parseSpecifications(specifications);
      specifications = specifications.filter(
        (spec) => !spec.testModule || spec.testModule.task.mode !== 'skip',
      );
    }
    if (!specifications.length && !vitest.config.passWithNoTests)
      throw new Error('Vitest selected no test files');
    // Discovery is pre-shard. Use the configured runner sequencer, including
    // custom implementations, so the file budget describes the actual shard.
    if (specifications.length && vitest.config.shard) {
      const { index, count } = vitest.config.shard;
      if (!vitest.config.passWithNoTests && count > specifications.length) {
        throw new Error(
          `Resolved ${specifications.length} test files for --shard=${index}/${count}; shard count exceeds test file count`,
        );
      }
      await vitest.cache.stats.populateStats(vitest.config.root, specifications);
      const sequencer = new vitest.config.sequence.sequencer(vitest);
      specifications = await sequencer.shard([...specifications]);
    }

    writeFileSync(
      output,
      JSON.stringify(
        specifications.map((spec) => relative(process.cwd(), spec.moduleId).split(sep).join('/')),
      ),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await vitest?.close();
  }
}
