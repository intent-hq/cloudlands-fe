/**
 * Preload generator drift tests.
 *
 * `src/preload/index.ts` is regenerated from `src/preload/index.template.ts` by
 * scripts/inline-ipc-channels.ts on every `npm run dev` and every `npm run
 * build`. Anything hand-written into index.ts is therefore deleted before
 * packaging — it works in whatever the developer was running at the time and is
 * absent from every shipped artifact.
 *
 * That trap ate the `getIpcListenerCounts` diagnostic bridge
 * (intent-hq/monorepo#2124), which left the renderer retention fingerprint
 * reporting `ipcBackendListeners: -1` in every real build. These tests keep the
 * generator's guard honest and keep the committed output in sync with the
 * template.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts/inline-ipc-channels.ts');

const realTemplatePath = join(repoRoot, 'src/preload/index.template.ts');
const realIndexPath = join(repoRoot, 'src/preload/index.ts');
const realTemplate = readFileSync(realTemplatePath, 'utf-8');
const realIndex = readFileSync(realIndexPath, 'utf-8');

const fixtureRoots: string[] = [];

afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

/**
 * A throwaway project root holding just the two preload files. The generator
 * still imports the real src/shared/ipc-registry (its import is relative to the
 * script, not to the root argument), so the fixture exercises the real
 * rendering path without writing into the repo.
 */
function makeFixture(template: string, index?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'preload-gen-'));
  fixtureRoots.push(root);
  mkdirSync(join(root, 'src/preload'), { recursive: true });
  writeFileSync(join(root, 'src/preload/index.template.ts'), template, 'utf-8');
  if (index !== undefined) writeFileSync(join(root, 'src/preload/index.ts'), index, 'utf-8');
  return root;
}

function runGenerator(root: string, ...flags: string[]) {
  // node --import tsx, not node_modules/.bin/tsx: on Windows that path is a
  // command shim that spawnSync cannot execute without a shell, so the child
  // would exit with status null and this suite would fail before it ever
  // reached the generator.
  const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath, root, ...flags], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // The guard reports on stderr, so both streams matter.
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function generatedIndex(root: string): string {
  return readFileSync(join(root, 'src/preload/index.ts'), 'utf-8');
}

// Stands in for the shape of monorepo#2124: a line added to the generated file
// and to nothing else.
const HAND_EDIT_MARKER = '  // hand-edit-that-only-exists-in-the-generated-file';

function withHandEdit(index: string): string {
  return index.replace(
    '  // IPC once (listen once)',
    `${HAND_EDIT_MARKER}\n  // IPC once (listen once)`,
  );
}

describe('preload generator drift guard', () => {
  it('regenerates a template-only tree and exits 0', () => {
    const root = makeFixture(realTemplate);
    const result = runGenerator(root);

    expect(result.status, result.output).toBe(0);
    expect(generatedIndex(root)).toContain('getIpcListenerCounts');
  });

  it('fails instead of silently deleting a hand edit made to the generated file', () => {
    const root = makeFixture(realTemplate, withHandEdit(realIndex));

    const result = runGenerator(root);

    expect(result.status, 'generator must refuse to discard hand-written lines').toBe(1);
    expect(result.output).toContain(HAND_EDIT_MARKER.trim());
    expect(result.output).toContain('index.template.ts');
    // The edit must survive the refusal — the whole point is to not lose work.
    expect(generatedIndex(root)).toContain(HAND_EDIT_MARKER);
  });

  it('catches a hand edit that only moves a line, with nothing added or removed', () => {
    // A multiset comparison calls this "unchanged" and overwrites it in
    // silence — the same silent-discard failure the guard exists to stop.
    const moved = '  // Remove all listeners for a channel';
    const index = realIndex
      .replace(`${moved}\n`, '')
      .replace('  // IPC once (listen once)', `${moved}\n  // IPC once (listen once)`);
    expect(index, 'fixture must actually move a line').not.toBe(realIndex);
    const root = makeFixture(realTemplate, index);

    const result = runGenerator(root);

    expect(result.status, 'a reordered line is still drift').toBe(1);
    expect(result.output).toContain('[moved]');
    // The content is in the template, so the message must not claim it is lost.
    expect(result.output).toContain('nothing is missing from the template');
  });

  it('does not fire when the template is ahead of a stale generated file', () => {
    // The normal workflow: edit the template, then regenerate. Nothing is lost,
    // so the guard must stay out of the way.
    const template = realTemplate.replace(
      '  // IPC once (listen once)',
      '  // brand-new-template-line\n  // IPC once (listen once)',
    );
    const root = makeFixture(template, realIndex);

    const result = runGenerator(root);

    expect(result.status, result.output).toBe(0);
    expect(generatedIndex(root)).toContain('brand-new-template-line');
  });

  it('discards hand edits only when --force is passed explicitly', () => {
    const root = makeFixture(realTemplate, withHandEdit(realIndex));

    const result = runGenerator(root, '--force');

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('--force');
    expect(generatedIndex(root)).not.toContain(HAND_EDIT_MARKER);
  });
});

describe('committed preload output is in sync with its template', () => {
  it('src/preload/index.ts matches a fresh regeneration byte for byte', () => {
    // Catches both directions of drift before it reaches main: a hand edit to
    // index.ts (which the next build deletes) and a template change that was
    // never regenerated (so reviewers read output that does not match the app).
    const root = makeFixture(realTemplate, realIndex);
    const result = runGenerator(root);

    expect(result.status, result.output).toBe(0);
    expect(
      generatedIndex(root),
      'src/preload/index.ts is stale or hand-edited — run `npm run generate:ipc-channels`',
    ).toBe(realIndex);
  });

  it('exposes getIpcListenerCounts from the template, not just the generated file', () => {
    // monorepo#2124: present only in index.ts meant `ipcBackendListeners` read
    // -1 in every packaged build.
    expect(
      realTemplate,
      'getIpcListenerCounts must live in the template or packaging strips it',
    ).toContain('getIpcListenerCounts');
  });
});
