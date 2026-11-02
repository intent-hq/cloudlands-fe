// @verify-changed-triggers: vitest.config.ts, scripts/vitest-native-deps.mjs, scripts/paraglide-inputs-hash.mjs, messages/**, project.inlang/**
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as messages from '$shared/paraglide/messages.js';
import { repoParaglidePaths } from './paraglide-inputs-hash.mjs';
import { nativeLoadedGeneratedModules } from './vitest-native-deps.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = repoParaglidePaths(rootDir).outdir;
const toId = (file: string) => file.split(path.sep).join('/');
const patterns = nativeLoadedGeneratedModules(rootDir);
const isNativeLoaded = (id: string) => patterns.some((re) => re.test(id));

describe('generated paraglide modules load natively in unit tests', () => {
  it('covers every generated paraglide .js file', () => {
    const generated = readdirSync(outdir, { recursive: true, encoding: 'utf8' }).filter((file) =>
      file.endsWith('.js'),
    );
    expect(generated).toEqual(expect.arrayContaining(['messages.js', 'runtime.js']));
    expect(generated.length).toBeGreaterThan(9);
    for (const file of generated) {
      expect(isNativeLoaded(toId(path.join(outdir, file))), file).toBe(true);
    }
  });

  it('leaves hand-written neighbours, query imports and other trees to Vitest', () => {
    const id = (file: string) => toId(path.join(rootDir, file));
    for (const candidate of [
      id('src/lib/i18n/locale.ts'),
      id('src/shared/i18n/formatters.ts'),
      id('src/main/main-locale.ts'),
      `${toId(outdir)}/runtime.js?raw`,
      `${toId(outdir)}/messages.js?url`,
      `${toId(outdir)}/README.md`,
      id('node_modules/some-pkg/src/shared/paraglide/messages.js'),
      `/elsewhere${toId(outdir)}/messages.js`,
    ]) {
      expect(isNativeLoaded(candidate), candidate).toBe(false);
    }
  });

  // Fails if vitest.config.ts stops applying the patterns: a Vitest-processed
  // bundle is re-evaluated after a reset, which yields new function objects
  // (and, in a fresh fork, the cold multi-second load of cloudlands-fe#3859).
  it('keeps the bundle loaded across vi.resetModules()', async () => {
    vi.resetModules();
    const reloaded = await import('$shared/paraglide/messages.js');
    expect(reloaded.acceptChanges_backgroundGit_commitFailed_error).toBe(
      messages.acceptChanges_backgroundGit_commitFailed_error,
    );
  });

  it('still renders real translations', () => {
    expect(messages.m.acceptChanges_backgroundGit_commitFailed_error()).toBe('Failed to commit');
  });
});
