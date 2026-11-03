// @vitest-environment node
// @verify-changed-triggers: scripts/i18n-used-message-keys.mjs, scripts/build-i18n-bundle.mjs

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAst } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectUsedMessageKeys,
  compileToJavaScript,
  messageReferencesInProgram,
} from './i18n-used-message-keys.mjs';

const MESSAGES = '$shared/paraglide/messages.js';

function analyze(code: string) {
  const result = messageReferencesInProgram(parseAst(code));
  return { keys: result.keys, problems: result.problems.map((problem) => problem.reason) };
}

describe('messageReferencesInProgram', () => {
  it('finds m.<key> calls, including one a formatter split across lines', () => {
    expect(
      analyze(`import { m } from '${MESSAGES}';
        m.greeting_label();
        const parts = m
          .farewell_description({ path: SLOT })
          .split(SLOT);`),
    ).toEqual({ keys: ['farewell_description', 'greeting_label'], problems: [] });
  });

  it('follows destructuring, which has no m.<key> text for a regex to match', () => {
    expect(
      analyze(`import { m } from '${MESSAGES}';
        const { greeting_label, farewell_description: farewell = fallback } = m;
        const { ['quoted_label']: quoted } = m;`),
    ).toEqual({ keys: ['farewell_description', 'greeting_label', 'quoted_label'], problems: [] });
  });

  it('follows aliased, namespace and per-message imports and local aliases', () => {
    expect(
      analyze(`import { m as msg, single_label } from '${MESSAGES}';
        import * as messages from '${MESSAGES}';
        const t = msg;
        t.alias_label();
        messages.namespace_label();
        messages.m.nested_label();
        msg?.optional_label?.();
        msg['literal_label']();`),
    ).toEqual({
      keys: [
        'alias_label',
        'literal_label',
        'namespace_label',
        'nested_label',
        'optional_label',
        'single_label',
      ],
      problems: [],
    });
  });

  it('follows dynamic imports through await, Promise.all, then and saga call effects', () => {
    expect(
      analyze(`
        async function a() {
          const { m } = await import('${MESSAGES}');
          m.await_label();
          (await import('${MESSAGES}')).m.inline_label();
          const [{ notify }, { m: msg }] = await Promise.all([
            import('$lib/notify'),
            import('${MESSAGES}'),
          ]);
          msg.all_label();
          import('${MESSAGES}').then(({ m: then }) => then.then_label());
        }
        function* saga() {
          const [{ notify }, { m }] = yield* call(() =>
            Promise.all([import('$lib/notify'), import('${MESSAGES}')]),
          );
          m.saga_label();
        }`),
    ).toEqual({
      keys: ['all_label', 'await_label', 'inline_label', 'saga_label', 'then_label'],
      problems: [],
    });
  });

  it("follows dynamic imports through Vite's production __vitePreload wrappers", () => {
    expect(
      analyze(`
        async function a() {
          const [{ notify }, { m }] = await Promise.all([
            __vitePreload(() => import('$lib/notify'), deps),
            __vitePreload(() => import('${MESSAGES}'), deps),
          ]);
          m.all_label();
          const { m: msg } = await __vitePreload(async () => {
            const { m: msg } = await import('${MESSAGES}');
            return { m: msg };
          }, deps);
          msg.treeshaken_label();
        }`),
    ).toEqual({ keys: ['all_label', 'treeshaken_label'], problems: [] });
  });

  it('ignores shadowing bindings and type-only reads', () => {
    expect(
      analyze(`import { m } from '${MESSAGES}';
        rows.map((m) => m.not_a_message);
        rows.forEach((m) => send(m));
        if (typeof m === 'object') m.real_label();`),
    ).toEqual({ keys: ['real_label'], problems: [] });
  });

  it('reports uses whose keys cannot be known statically', () => {
    expect(
      analyze(`import { m } from '${MESSAGES}';
        m[key]();
        const { greeting_label, ...rest } = m;
        render(m);
        export { m as messages };`).problems,
    ).toEqual([
      'computed message lookup',
      'rest pattern over messages hides which keys are used',
      'messages object escapes as a value',
      'messages object escapes as a value',
    ]);
    expect(analyze(`export * from '${MESSAGES}';`).problems).toEqual([
      're-exporting messages hides which keys are used',
    ]);
  });

  it('ignores modules that do not import messages', () => {
    expect(analyze('const m = /x/.exec(s); m.greeting_label;')).toEqual({ keys: [], problems: [] });
  });
});

describe('compileToJavaScript', () => {
  it('analyses Svelte template expressions after compilation', async () => {
    const component = `<script lang="ts">
  import { m } from '${MESSAGES}';
  const { farewell_description }: typeof m = m;
</script>

<p title={m
  .greeting_label()}>{farewell_description()}</p>

<style lang="postcss">p { @apply text-sm; }</style>`;
    const code = await compileToJavaScript(component, 'Fixture.svelte');
    expect(messageReferencesInProgram(parseAst(code)).keys).toEqual([
      'farewell_description',
      'greeting_label',
    ]);
  });
});

describe('collectUsedMessageKeys', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  const catalog = new Set(['greeting_label', 'farewell_description', 'unused_label', 'test_label']);

  it('collects catalog keys from source files and skips tests', async () => {
    root = mkdtempSync(join(tmpdir(), 'i18n-keys-'));
    mkdirSync(join(root, 'feature'));
    writeFileSync(
      join(root, 'feature/labels.ts'),
      `import { m } from '${MESSAGES}';\nexport const { greeting_label: label } = m;\nm.not_in_catalog?.();\n`,
    );
    writeFileSync(
      join(root, 'feature/View.svelte'),
      `<script lang="ts">import * as messages from '${MESSAGES}';</script>\n{messages.farewell_description()}\n`,
    );
    writeFileSync(
      join(root, 'feature/labels.test.ts'),
      `import { m } from '${MESSAGES}';\nm.test_label();\n`,
    );
    expect(await collectUsedMessageKeys(root, catalog)).toEqual([
      'farewell_description',
      'greeting_label',
    ]);
  });

  it('fails instead of shipping a bundle with an unknowable gap', async () => {
    root = mkdtempSync(join(tmpdir(), 'i18n-keys-'));
    writeFileSync(
      join(root, 'dynamic.ts'),
      `import { m } from '${MESSAGES}';\nexport const label = (key: string) => m[key]();\n`,
    );
    await expect(collectUsedMessageKeys(root, catalog)).rejects.toThrow(
      /dynamic\.ts: computed message lookup — `m\[key\]`/,
    );
  });

  it('ships every message the profile remove dialog renders in this repository', async () => {
    const repositoryRoot = process.cwd();
    const repositoryCatalog = JSON.parse(
      readFileSync(join(repositoryRoot, 'messages/en.json'), 'utf8'),
    );
    const used = await collectUsedMessageKeys(
      join(repositoryRoot, 'src'),
      new Set(Object.keys(repositoryCatalog)),
    );
    expect(used).toContain('settings_providerProfileKinds_removeFolder_description');
    expect(used).toContain('layout_daemonStatus_updateRequested_toast');
  }, 120_000);
});
