import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureConsumers = [
  'src/lib/components/chat/input/ModelPicker.transfer-selection-contract.test.ts',
  'scripts/transfer-selection-fixtures.test.ts',
  'scripts/run-unit-tests.test.ts',
  'scripts/verify-changed.test.ts',
];

// Only options whose arity and effect on file selection we understand may bypass
// the prerequisite. Unknown options (including config/root/related selection)
// require it: their values must never accidentally become unrelated file filters.
const valueOptions = new Set([
  '-t',
  '--testNamePattern',
  '--maxWorkers',
  '--minWorkers',
  '--reporter',
  '--testTimeout',
  '--hookTimeout',
  '--teardownTimeout',
  '--bail',
  '--retry',
  '--pool',
  '--mode',
  '--shard',
  '--exclude',
  '--outputFile',
  '--environment',
]);
const booleanOptions = new Set([
  '--run',
  '--watch',
  '-w',
  '--coverage',
  '--globals',
  '--isolate',
  '--fileParallelism',
  '--passWithNoTests',
  '--hideSkippedTests',
  '--disableConsoleIntercept',
  '--color',
  '--no-color',
]);

// Shared by launcher and changed-test planning. This is a conservative selection
// check, not a second CLI parser: forward the original args unchanged to Vitest.
export function requiresTransferSelectionFixtures(args, { root = repo } = {}) {
  const filters = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') return true;
    if (!arg.startsWith('-')) {
      if (['run', 'watch', 'related', 'list', 'bench', 'typecheck'].includes(arg)) return true;
      filters.push(arg);
      continue;
    }
    const option = arg.split('=', 1)[0];
    const equalsValue = arg.includes('=') ? arg.slice(option.length + 1) : undefined;
    // Vitest can consume the next token after an empty equals value.
    if (equalsValue === '') return true;
    if (valueOptions.has(option)) {
      if (!arg.includes('=')) {
        if (++index >= args.length) return true;
      }
    } else if (option === '--silent') {
      // Unlike the boolean flags, silent accepts an optional string (passed-only).
      if (!arg.includes('=') && args[index + 1] && !args[index + 1].startsWith('-')) index++;
    } else if (booleanOptions.has(option)) {
      // Non-boolean equals values can become positional file filters in Vitest.
      if (equalsValue !== undefined && !['true', 'false'].includes(equalsValue)) return true;
      if (!arg.includes('=') && ['true', 'false'].includes(args[index + 1])) index++;
    } else {
      return true;
    }
  }
  if (!filters.length) return true;
  return filters.some((filter) => {
    // Glob/line-range syntax is ambiguous; it must not suppress validation.
    if (/[*?{}[\]]/.test(filter)) return true;
    const file = filter.replaceAll('\\', '/').replace(/:\d+(?:-\d+)?$/, '');
    const normalized = relative(root, resolve(root, file)).replaceAll('\\', '/');
    // Vitest accepts case-insensitive substrings and relative/absolute prefixes,
    // not just exact test filenames. Name filters never narrow collection.
    return fixtureConsumers.some(
      (consumer) =>
        consumer.toLocaleLowerCase().includes(file.toLocaleLowerCase()) ||
        consumer.toLocaleLowerCase().includes(normalized.toLocaleLowerCase()) ||
        (isAbsolute(file) && resolve(root, consumer).startsWith(resolve(file))),
    );
  });
}
