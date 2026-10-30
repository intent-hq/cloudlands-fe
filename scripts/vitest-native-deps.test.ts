import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as messages from '$shared/paraglide/messages.js';
import { repoParaglidePaths } from './paraglide-inputs-hash.mjs';
import { NATIVE_LOADED_GENERATED_MODULES } from './vitest-native-deps.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toId = (file: string) => file.split(path.sep).join('/');
const isNativeLoaded = (id: string) => NATIVE_LOADED_GENERATED_MODULES.some((re) => re.test(id));

describe('generated paraglide modules load natively in unit tests', () => {
  it('covers every generated paraglide output file', () => {
    const outdir = toId(repoParaglidePaths(rootDir).outdir);
    for (const file of ['messages.js', 'runtime.js', 'messages/_index.js', 'messages/en.js']) {
      expect(isNativeLoaded(`${outdir}/${file}`), file).toBe(true);
    }
  });

  it('leaves hand-written neighbours to Vitest', () => {
    for (const file of [
      'src/shared/errors/localization.ts',
      'src/shared/paraglide-helpers.ts',
      'src/lib/i18n/paraglide.ts',
    ]) {
      expect(isNativeLoaded(toId(path.join(rootDir, file))), file).toBe(false);
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
