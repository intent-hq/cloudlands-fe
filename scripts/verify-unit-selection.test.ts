// @vitest-environment node
// @verify-changed-triggers: scripts/verify-changed.mjs, scripts/verify-unit-selection.mjs
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, runCli, runVerificationPlan } from './verify-changed.mjs';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'resolved-unit-'));
  roots.push(root);
  vi.stubEnv('NODE_COMPILE_CACHE', join(root, 'compile-cache'));
  const write = (file: string, content: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'junction');
  write('package.json', '{"type":"module"}');
  write(
    'vitest.config.ts',
    `export default { resolve: { alias: { '@source': ${JSON.stringify(join(root, 'src'))} } }, test: { environment: 'node', exclude: ['**/node_modules/**', '**/excluded/**'], maxWorkers: 1 } };`,
  );
  write('src/source.ts', 'export const value = 1;');
  write('src/middle.ts', "export { value } from '@source/source';");
  for (const file of [
    'direct.test.ts',
    'related.test.ts',
    'declared.test.ts',
    'excluded/no.test.ts',
  ]) {
    write(
      file,
      `import { it, expect } from 'vitest';
import { appendFileSync } from 'node:fs';
appendFileSync('imports.jsonl', 'imported\\n');
${file === 'related.test.ts' ? "import { value } from './src/middle';" : 'const value = 1;'}
it('selected name', () => { appendFileSync('bodies.jsonl', JSON.stringify(${JSON.stringify(file)}) + '\\n'); expect(value).toBe(1); });`,
    );
  }
  const bodies = () =>
    existsSync(join(root, 'bodies.jsonl'))
      ? readFileSync(join(root, 'bodies.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
          .sort()
      : [];
  return { root, write, bodies };
}
function check(id: string, ...args: string[]) {
  return {
    id,
    label: id,
    executable: 'pnpm',
    args: ['exec', 'vitest', ...args, '--config', 'vitest.config.ts', '--maxWorkers=1'],
    lockKind: null,
  };
}
function plan(...checks: Array<ReturnType<typeof check> & { dependsOn?: string[] }>) {
  return { files: [], checks, prerequisites: [], fallbackReasons: [] };
}
const selection = () =>
  plan(
    check('vitest-direct', 'run', 'direct.test.ts', 'related.test.ts'),
    check('vitest-related', 'related', '--run', 'src/source.ts'),
    check('vitest-declared', 'run', 'declared.test.ts', 'direct.test.ts'),
  );
describe('resolved unit selections with installed Vitest', () => {
  it('resolves direct, transitive alias-related and declared paths without executing bodies, and counts their union', async () => {
    const { root, bodies } = fixture();
    const lines: string[] = [];
    await runVerificationPlan(selection(), root, {
      resolvedPlan: true,
      log: (line: string) => lines.push(line),
    });
    expect(bodies()).toEqual([]);
    expect(existsSync(join(root, 'imports.jsonl'))).toBe(false);
    expect(lines).toContain('verify:changed: resolved unit files: 3 unique');
    for (const file of ['direct.test.ts', 'related.test.ts', 'declared.test.ts'])
      expect(lines).toContain(`  - ${file}`);
    expect(lines).toContain('  vitest-related: 1 file(s)');
  });
  it('rejects an exceeded union budget before even an earlier check can run', async () => {
    const { root, bodies } = fixture();
    const p = selection();
    p.checks.unshift({
      ...check('earlier', 'run', 'direct.test.ts'),
      executable: process.execPath,
      args: ['-e', "require('fs').writeFileSync('earlier-ran','yes')"],
    });
    await expect(runVerificationPlan(p, root, { maxUnitFiles: 2, log() {} })).rejects.toThrow(
      /3.*--max-unit-files 2/,
    );
    expect(bodies()).toEqual([]);
    expect(existsSync(join(root, 'earlier-ran'))).toBe(false);
  });
  it.each([3, undefined])(
    'executes the entire resolved union with budget %s, preserving assertion failures and filters',
    async (maxUnitFiles) => {
      const { root, bodies, write } = fixture();
      await runVerificationPlan(selection(), root, { maxUnitFiles, log() {} });
      expect(bodies()).toEqual([
        'declared.test.ts',
        'direct.test.ts',
        'direct.test.ts',
        'related.test.ts',
        'related.test.ts',
      ]);
      write(
        'failure.test.ts',
        "import { it, expect } from 'vitest'; it('wanted', () => expect(1).toBe(2));",
      );
      await expect(
        runVerificationPlan(
          plan(check('vitest-direct', 'run', 'failure.test.ts', '-t', 'wanted')),
          root,
          { log() {} },
        ),
      ).rejects.toThrow(/exit code 1/);
    },
  );
  it('resolves full fallback and refuses missing direct selections or broken related discovery without bodies', async () => {
    const { root, bodies, write } = fixture();
    const lines: string[] = [];
    await runVerificationPlan(plan(check('vitest-full', 'run')), root, {
      resolvedPlan: true,
      log: (line: string) => lines.push(line),
    });
    expect(lines).toContain('verify:changed: resolved unit files: 3 unique');
    await expect(
      runVerificationPlan(plan(check('vitest-direct', 'run', 'absent.test.ts')), root, {
        log() {},
      }),
    ).rejects.toThrow(/resolve|selected no/i);
    write('src/middle.ts', 'export const = ;');
    await expect(runVerificationPlan(selection(), root, { log() {} })).rejects.toThrow(/resolve/i);
    expect(bodies()).toEqual([]);
  });

  it('fails before discovery when prerequisites fail, and before bodies on an invalid config', async () => {
    const { root, write, bodies } = fixture();
    const lines: string[] = [];
    const p = {
      ...plan({ ...check('vitest-direct', 'run', 'direct.test.ts'), dependsOn: ['fixture'] }),
      prerequisites: [
        {
          id: 'fixture',
          label: 'fixture',
          executable: process.execPath,
          args: ['-e', 'process.exit(1)'],
          lockKind: null,
        },
      ],
    };
    await expect(
      runVerificationPlan(p, root, { log: (line: string) => lines.push(line) }),
    ).rejects.toThrow(/fixture failed/);
    expect(lines).toEqual([]);
    expect(bodies()).toEqual([]);
    write('vitest.config.ts', 'throw new Error("broken config"); export default {};');
    await expect(runVerificationPlan(selection(), root, { log() {} })).rejects.toThrow(
      /broken config/,
    );
    expect(bodies()).toEqual([]);
  });

  it('includes UI invariant suites in the union and preserves marker validation', async () => {
    const { root, write, bodies } = fixture();
    write(
      'scripts/invariant.test.ts',
      `// @ui-invariant
import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
it('invariant', () => appendFileSync('bodies.jsonl', JSON.stringify('scripts/invariant.test.ts') + '\\n'));`,
    );
    const ui = { ...check('vitest-ui-invariants'), args: ['run', 'test:ui-invariants'] };
    const p = plan(check('vitest-direct', 'run', 'scripts/invariant.test.ts'), ui);
    const lines: string[] = [];
    await runVerificationPlan(p, root, {
      resolvedPlan: true,
      maxUnitFiles: 1,
      log: (line: string) => lines.push(line),
    });
    expect(lines).toContain('verify:changed: resolved unit files: 1 unique');
    expect(lines).toContain('  vitest-ui-invariants: 1 file(s)');
    expect(bodies()).toEqual([]);
    write('scripts/unmarked.test.ts', 'const inventory = buildUiComponentInventory();');
    await expect(runVerificationPlan(p, root, { resolvedPlan: true, log() {} })).rejects.toThrow(
      /marker/,
    );
    expect(bodies()).toEqual([]);
  });

  it('forwards resolved-plan and the budget through the CLI after environment checks', async () => {
    const { root, bodies } = fixture();
    const calls: string[] = [];
    const lines: string[] = [];
    const options = {
      checkNode: () => {
        calls.push('node');
        return { ok: true };
      },
      checkDeps: () => {
        calls.push('deps');
        return { ok: true };
      },
      ensureI18n: async () => {
        calls.push('i18n');
        return { ok: true };
      },
      log: (line: string) => lines.push(line),
    };
    await expect(
      runCli(['--resolved-plan', '--max-unit-files=1', 'direct.test.ts'], root, options),
    ).resolves.toBe(0);
    expect(calls).toEqual(['node', 'deps', 'i18n']);
    expect(lines).toContain('verify:changed: resolved unit files: 1 unique');
    await expect(runCli(['--max-unit-files=0', 'direct.test.ts'], root, options)).rejects.toThrow(
      /--max-unit-files 0/,
    );
    expect(bodies()).toEqual([]);
  });

  it('allows an empty related result at a zero budget and preserves name-filter arguments', async () => {
    const { root, write, bodies } = fixture();
    write('src/unreferenced.ts', 'export const value = 2;');
    await runVerificationPlan(
      plan(check('vitest-related', 'related', '--run', 'src/unreferenced.ts')),
      root,
      { maxUnitFiles: 0, log() {} },
    );
    expect(bodies()).toEqual([]);
    write(
      'filtered.test.ts',
      `import { it } from 'vitest'; import { writeFileSync } from 'node:fs';
it('name with spaces', () => writeFileSync('filtered-ran', 'yes'));
it('unselected', () => { throw new Error('name filter lost'); });`,
    );
    await runVerificationPlan(
      plan(check('vitest-direct', 'run', 'filtered.test.ts', '-t', 'name with spaces')),
      root,
      { maxUnitFiles: 1, log() {} },
    );
    expect(existsSync(join(root, 'filtered-ran'))).toBe(true);
  });

  it('accepts explicit planning and nonnegative integer budgets; rejects ambiguous or malformed limits', () => {
    expect(parseArgs(['--resolved-plan', '--max-unit-files', '0', 'src/source.ts'])).toMatchObject({
      resolvedPlan: true,
      maxUnitFiles: 0,
      paths: ['src/source.ts'],
    });
    expect(parseArgs(['--max-unit-files=3'])).toMatchObject({ maxUnitFiles: 3 });
    for (const args of [
      ['--max-unit-files'],
      ['--max-unit-files=-1'],
      ['--max-unit-files=1.5'],
      ['--max-unit-files=wat'],
      ['--dry-run', '--max-unit-files=1'],
    ])
      expect(() => parseArgs(args)).toThrow();
  });
});
