// @verify-changed-triggers: src/**/*.ts, src/**/*.svelte
// File choosers must go through src/main/file-dialogs.ts (main) and in-document
// `<input type=file>` elements (renderer, see $lib/in-app-file-inputs), which
// switch to the in-app picker under INTENT_IN_APP_PICKER=1. A direct native
// call bypasses that switch and opens nothing on Intent OS.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const HELPER = 'src/main/file-dialogs.ts';

function sourceFiles(directory: string, pattern: RegExp): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '__snapshots__', '__tests__', 'paraglide'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, pattern);
    return pattern.test(entry.name) && !/\.(test|spec|ct\.spec)\./.test(entry.name) ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
}

it('routes every main-process open/save chooser through file-dialogs.ts', () => {
  const direct = /\b\w*[dD]ialog\s*\.\s*show(?:Open|Save)Dialog(?:Sync)?\b/;
  const violations = sourceFiles(SRC, /\.ts$/)
    .map((path) => relative(process.cwd(), path))
    .filter((path) => path !== HELPER)
    .filter((path) => direct.test(stripComments(readFileSync(path, 'utf8'))));
  expect(violations).toEqual([]);
});

it('keeps renderer file inputs in the document', () => {
  // in-app-file-inputs.ts swaps the native chooser for the in-app picker by
  // catching clicks on file inputs at the window. A detached input (built with
  // createElement and clicked without being attached) never reaches it.
  const detached = /\.type\s*=\s*['"]file['"]|showOpenFilePicker\s*\(/;
  const violations = sourceFiles(SRC, /\.(ts|svelte)$/)
    .map((path) => relative(process.cwd(), path))
    .filter((path) => detached.test(stripComments(readFileSync(path, 'utf8'))));
  expect(violations).toEqual([]);
});
