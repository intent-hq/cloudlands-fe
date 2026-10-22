#!/usr/bin/env node
// Runs an explicit, already-resolved list of Vitest files for a resumed
// `verify:changed` lane. The list is read from a file, so no command-line
// length limit applies. Usage: verify-changed-run-files.mjs <list.json> [vitest options]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [listPath, ...argv] = process.argv.slice(2);
try {
  const files = JSON.parse(readFileSync(listPath, 'utf8'));
  if (!Array.isArray(files) || !files.length || files.some((file) => typeof file !== 'string'))
    throw new Error(`invalid file list: ${listPath}`);
  const { parseCLI, startVitest } = await import('vitest/node');
  // Match the Vitest CLI environment before user configuration is evaluated.
  process.env.TEST = 'true';
  process.env.VITEST = 'true';
  process.env.NODE_ENV ??= 'test';
  const { options } = parseCLI(['vitest', 'run', ...argv]);
  if (options.exclude) {
    options.cliExclude = options.exclude;
    delete options.exclude;
  }
  // Absolute filters keep each selection to its intended file.
  const filters = files.map((file) => resolve(process.cwd(), file));
  const ctx = await startVitest('test', filters, { ...options, watch: false, run: true });
  if (!ctx.shouldKeepServer()) await ctx.exit();
} catch (error) {
  console.error(error);
  if (process.exitCode == null || process.exitCode === 0) process.exitCode = 1;
}
