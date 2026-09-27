// @vitest-environment node
// @verify-changed-triggers: scripts/check-dead-code.mjs, scripts/knip.config.js, scripts/knip-svelte.mjs, knip.jsonc
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { svelteImports } from './knip-svelte.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = path.join(repoRoot, 'scripts/check-dead-code.mjs');

describe('Svelte import extraction', () => {
  it('preserves template imports, type queries and nested dynamic imports as valid TypeScript', () => {
    const extracted = svelteImports(
      `
      <script lang="ts">
        import type { Value } from './value';
        type Nested = import('./nested').Value;
        async function load() { return import('./dynamic', { with: { type: 'json' } }); }
      </script>
      {#await import('./Template.svelte') then component}
        <component.default />
      {/await}
    `,
      'Example.svelte',
    );
    expect(extracted).toContain("import type { Value } from './value'");
    expect(extracted).toContain("import('./nested');");
    expect(extracted).toContain("import('./dynamic', { with: { type: 'json' } })");
    expect(extracted).toContain("import('./Template.svelte')");
    const parsed = ts.createSourceFile('extracted.ts', extracted, ts.ScriptTarget.Latest);
    expect(
      (parsed as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics,
    ).toEqual([]);
  });

  it('ignores import lookalikes in script strings, comments and markup', () => {
    expect(
      svelteImports(
        `
      <!-- <script>import Ghost from './ghost';</script> -->
      <script>
        const text = "import './string'";
        const important = { import: 'default' };
        /* import './comment'; */
        import './real';
      </script>
      <p>import './markup'</p>
    `,
        'Example.svelte',
      ),
    ).toBe("import './real';");
  });

  it('handles components without scripts and fails clearly on invalid script syntax', () => {
    expect(svelteImports('<span>Plain component</span>', 'Plain.svelte')).toBe('');
    expect(() => svelteImports('<script>import {</script>', 'Invalid.svelte')).toThrow();
  });
});

describe('Svelte imports in the real dead-code gate', () => {
  it.each(['module', 'context="module"'])(
    'preserves both scripts with %s syntax',
    (moduleAttribute) => {
      const root = mkdtempSync(path.join(tmpdir(), 'knip-svelte-'));
      const write = (file: string, source: string) => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), source);
      };
      try {
        // Knip registers import.meta.glob handling through its Vite plugin, as in this repo.
        write(
          'package.json',
          JSON.stringify({ type: 'module', dependencies: { svelte: '*', vite: '*' } }),
        );
        write(
          'knip.jsonc',
          JSON.stringify({
            entry: ['src/main.ts'],
            project: ['src/**/*.{ts,svelte}'],
            include: ['files', 'exports', 'types', 'unresolved'],
          }),
        );
        symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
        write('src/main.ts', "import App from './App.svelte'; console.log(App);");
        write(
          'src/App.svelte',
          `
        <script ${moduleAttribute} lang="ts">
          const previews = import.meta.glob<{ default: string }>('./recordings/*.ts', {
            eager: true,
            import: 'default',
          });
          import { moduleValue } from './module-value';
          import type { ModuleType } from './module-type';
          import './module-side-effect';
          const moduleDynamic = () => import('./module-dynamic');
          const moduleTyped: ModuleType = moduleValue;
        </script>
        <script lang="ts">
          const assets = import.meta.glob('./assets/*.ts', { import: 'default' });
          import Child from './Child.svelte';
          import { instanceValue, type InstanceType } from './instance-value';
          import type { Assessment } from './assessment';
          import './instance-side-effect';
          const instanceDynamic = () => import('./instance-dynamic');
          const assessment: Assessment = { value: instanceValue };
          const instanceTyped: InstanceType = instanceValue;
          const text = "import './unused-in-string'";
          // import './unused-in-comment';
        </script>
        <Child />
      `,
        );
        write('src/Child.svelte', '<span>Child</span>');
        write('src/module-value.ts', 'export const moduleValue = 1;');
        write('src/module-type.ts', 'export type ModuleType = number;');
        write('src/module-side-effect.ts', 'console.log("module");');
        write('src/module-dynamic.ts', 'export const loaded = true;');
        write(
          'src/instance-value.ts',
          'export const instanceValue = 2; export type InstanceType = number;',
        );
        write('src/assessment.ts', 'export interface Assessment { value: number }');
        write('src/instance-side-effect.ts', 'console.log("instance");');
        write('src/instance-dynamic.ts', 'export const loaded = true;');
        write('src/recordings/one.ts', "export default 'recording';");
        write('src/assets/one.ts', "export default 'asset';");
        const unused = ['unused-in-string.ts', 'unused-in-comment.ts', 'Unused.svelte'];
        for (const name of unused) {
          write(
            `src/${name}`,
            name.endsWith('.svelte') ? '<span>Unused</span>' : 'export const unused = true;',
          );
        }
        const scan = () =>
          spawnSync(process.execPath, [gate], {
            cwd: root,
            env: { ...process.env, CHECK_DEAD_CODE_ROOT: root },
            encoding: 'utf8',
            timeout: 20_000,
          });

        const withUnused = scan();
        expect(withUnused.error).toBeUndefined();
        expect(withUnused.status, withUnused.stderr).toBe(1);
        expect(withUnused.stdout).toContain('Unused files (3)');
        for (const name of unused) expect(withUnused.stdout).toContain(`src/${name}`);
        expect(withUnused.stdout).toContain('3 error-level issue');
        expect(withUnused.stderr).not.toContain('canary');

        for (const name of unused) rmSync(path.join(root, 'src', name));
        const withoutUnused = scan();
        expect(withoutUnused.error).toBeUndefined();
        expect(withoutUnused.status, withoutUnused.stdout + withoutUnused.stderr).toBe(0);
        expect(withoutUnused.stdout).toContain('no unused files');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
