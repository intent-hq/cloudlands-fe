// @verify-changed-triggers: package.json, scripts/check-electron-test-paths.mjs, playwright/root-spec-pattern.mjs, test/workspace-tab-strip-status-geometry.spec.ts

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  applyAllowlist,
  checkRootSpecStubs,
  collectRootSpecs,
  isRootSpecStubInput,
} from './check-root-spec-stubs.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A throwaway package root holding `files` (repo-relative path → lines). */
function tree(files: Record<string, string | string[]>) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'root-spec-stubs-')));
  roots.push(root);
  const all: Record<string, string | string[]> = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        paths: { '$lib/*': ['./src/lib/*'], '$store/*': ['./src/store/*'] },
      },
    }),
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, Array.isArray(content) ? content.join('\n') : content);
  }
  return root;
}

const messages = (root: string) => checkRootSpecStubs(root).map((finding) => finding.message);

/**
 * A root spec that mounts `entry` in the page, replacing modules with `stubs` through a
 * Vite plugin whose `resolveId` runs `redirects` first.
 */
const spec = (
  stubs: Record<string, string>,
  entry = 'src/lib/Strip.svelte',
  redirects: string[] = [],
) => [
  "import { test } from '@playwright/test';",
  'const virtualModules: Record<string, string> = {',
  ...Object.entries(stubs).map(([id, code]) => `  ${JSON.stringify(id)}: \`${code}\`,`),
  '};',
  'const plugin = {',
  '  resolveId(source: string) {',
  ...redirects.map((line) => `    ${line}`),
  "    return source in virtualModules ? '\\0' + source : null;",
  '  },',
  '  load(id: string) {',
  '    return virtualModules[id.slice(1)] ?? null;',
  '  },',
  '};',
  "test('mounts', async ({ page }) => {",
  `  await page.evaluate(() => import('/${entry}'));`,
  '});',
];

const SLICE = '$store/tabs/tab-slice';

/** A Svelte component: `script` lines, then `markup`. */
const strip = (script: string[], markup = '<div></div>') => [
  '<script lang="ts">',
  ...script,
  '</script>',
  markup,
];

describe('root spec stub export check', () => {
  it('scans the root Playwright specs only', () => {
    const root = tree({
      'test/a.spec.ts': '',
      'test/nested/b.spec.ts': '',
      'test/helper.ts': '',
      'test/electron-browser-lifetime.spec.ts': '',
      'src/lib/x.spec.ts': '',
    });
    expect(collectRootSpecs(root)).toEqual(['test/a.spec.ts', 'test/nested/b.spec.ts']);
  });

  it('runs from lint:architecture', () => {
    const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
    expect(scripts['lint:architecture']).toContain('pnpm-run.mjs lint:root-spec-stubs');
    expect(scripts['lint:root-spec-stubs']).toBe('node scripts/check-root-spec-stubs.mjs');
  });

  it('ships with no allowlisted exceptions', () => {
    expect(ALLOWLIST).toEqual({});
  });

  it('passes on the repository', () => {
    const { hits, stale } = applyAllowlist(checkRootSpecStubs(process.cwd()));
    expect(hits).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('flags a name the component graph imports but the stub lacks (intent#9311)', () => {
    const files = {
      'src/store/tabs/tab-slice.ts': [
        'export const openTab = () => {};',
        'export const moveGroup = () => {};',
        'export const groupByProject = () => {};',
      ],
      'src/lib/controller.ts': [
        `import { openTab, groupByProject } from '${SLICE}';`,
        'export const open = () => [openTab(), groupByProject()];',
      ],
      'src/lib/Strip.svelte': strip([
        "  import { open } from './controller';",
        `  import { moveGroup } from '${SLICE}';`,
        '  open(); moveGroup();',
      ]),
    };
    const stale = tree({
      ...files,
      'test/strip.spec.ts': spec({ [SLICE]: 'export const openTab = () => {};' }),
    });
    expect(checkRootSpecStubs(stale)).toEqual([
      {
        key: `test/strip.spec.ts: ${SLICE} <- src/lib/Strip.svelte`,
        file: 'test/strip.spec.ts',
        line: 3,
        message: `stub '${SLICE}' does not export moveGroup, which src/lib/Strip.svelte:3 imports`,
      },
      {
        key: `test/strip.spec.ts: ${SLICE} <- src/lib/controller.ts`,
        file: 'test/strip.spec.ts',
        line: 3,
        message: `stub '${SLICE}' does not export groupByProject, which src/lib/controller.ts:1 imports`,
      },
    ]);
    const fixed = tree({
      ...files,
      'test/strip.spec.ts': spec({
        [SLICE]: [
          'export const openTab = () => {};',
          'export const moveGroup = () => {};',
          'export function groupByProject() {}',
          'export const unrelatedExtra = 1;',
        ].join('\n'),
      }),
    });
    expect(messages(fixed)).toEqual([]);
  });

  it('ignores type-only imports, and value imports used only as types in TypeScript', () => {
    const root = tree({
      'src/store/tabs/tab-slice.ts': 'export const openTab = () => {}; export type Tab = {};',
      'src/lib/tabs.ts': [
        `import { openTab, TabState } from '${SLICE}';`,
        'export const open = (state: TabState) => openTab();',
      ],
      'src/lib/Strip.svelte': strip([
        `  import type { Tab } from '${SLICE}';`,
        `  import { type TabGroup } from '${SLICE}';`,
        "  import { open } from './tabs';",
        '  let tab: Tab | TabGroup;',
        '  open();',
      ]),
      'test/strip.spec.ts': spec({ [SLICE]: 'export const openTab = () => {};' }),
    });
    expect(messages(root)).toEqual([]);
  });

  it('counts every value-spelled import of a Svelte component, used or not', () => {
    const root = tree({
      'src/store/tabs/tab-slice.ts': 'export const openTab = () => {};',
      'src/lib/Strip.svelte': strip([
        `  import { openTab, TabState, MAX_TABS } from '${SLICE}';`,
        '  let tab: TabState;',
        '  openTab();',
      ]),
      'test/strip.spec.ts': spec({ [SLICE]: 'export const openTab = () => {};' }),
    });
    expect(messages(root)).toEqual([
      `stub '${SLICE}' does not export TabState, MAX_TABS, which src/lib/Strip.svelte:2 imports`,
    ]);
  });

  it('reads a script tag whose attributes contain >', () => {
    const root = tree({
      'src/store/tabs/tab-slice.ts': 'export const openTab = () => {};',
      'src/lib/Strip.svelte': [
        '<script lang="ts" generics="T extends Record<string, Array<number>>">',
        `  import { openTab, closeTab } from '${SLICE}';`,
        '  openTab(); closeTab();',
        '</script>',
      ],
      'test/strip.spec.ts': spec({ [SLICE]: 'export const openTab = () => {};' }),
    });
    expect(messages(root)).toEqual([
      `stub '${SLICE}' does not export closeTab, which src/lib/Strip.svelte:2 imports`,
    ]);
  });

  it('checks names requested through an export-star barrel of a stub', () => {
    const files = {
      'src/lib/mod.ts': 'export const real = 1; export const extra = 2;',
      'src/lib/other.ts': 'export const fromOther = 3;',
      'src/lib/barrel/index.ts': [
        "export * from '$lib/mod';",
        "export * from '../other';",
        'export const own = 4;',
      ],
      'src/lib/outer.ts': "export * from './barrel';",
      'src/lib/Strip.svelte': strip([
        "  import { real, extra, own, fromOther } from './outer';",
        '  real; extra; own; fromOther;',
      ]),
    };
    const stale = tree({
      ...files,
      'test/strip.spec.ts': spec({ '$lib/mod': 'export const real = 1;' }),
    });
    expect(messages(stale)).toEqual([
      "stub '$lib/mod' does not export extra, which src/lib/barrel/index.ts:1 re-exports with export *",
    ]);
    const fixed = tree({
      ...files,
      'test/strip.spec.ts': spec({ '$lib/mod': 'export const real = 1; export const extra = 2;' }),
    });
    expect(messages(fixed)).toEqual([]);
  });

  it('follows resolveId redirects and flags the stubs they shadow', () => {
    const root = tree({
      'src/lib/Card.svelte': strip(["  import { gone } from '$lib/gone';", '  gone();']),
      'src/lib/gone.ts': 'export const gone = 1;',
      'src/lib/mocks/MockCard.svelte': strip([
        "  import { toast } from '$lib/toast';",
        '  toast();',
      ]),
      'src/lib/toast.ts': 'export const toast = 1;',
      'src/lib/Strip.svelte': strip(["  import Card from '$lib/Card.svelte';"], '<Card />'),
      'test/strip.spec.ts': spec(
        {
          '$lib/Card.svelte': "export { default } from '/src/lib/mocks/MockCard.svelte';",
          '$lib/toast': 'export const unrelated = 1;',
        },
        'src/lib/Strip.svelte',
        [
          "if (source === '$lib/Card.svelte' || source === resolve(process.cwd(), 'src/lib/Card.svelte'))",
          "  return resolve(process.cwd(), 'src/lib/mocks/MockCard.svelte');",
        ],
      ),
    });
    expect(messages(root)).toEqual([
      "stub '$lib/Card.svelte' replaces no import reachable from src/lib/Strip.svelte",
      "stub '$lib/toast' does not export toast, which src/lib/mocks/MockCard.svelte:2 imports",
    ]);
  });

  it('flags a stub that replaces nothing the spec mounts', () => {
    const root = tree({
      'src/store/presence.ts': 'export const selectPeople = () => [];',
      'src/lib/Strip.svelte': strip(["  import { helper } from './helper';", '  helper();']),
      'src/lib/helper.ts': 'export const helper = () => {};',
      'test/strip.spec.ts': spec({ '$store/presence': 'export const selectPeople = () => [];' }),
    });
    expect(checkRootSpecStubs(root)).toEqual([
      expect.objectContaining({
        key: 'test/strip.spec.ts: $store/presence',
        message: "stub '$store/presence' replaces no import reachable from src/lib/Strip.svelte",
      }),
    ]);
  });

  it('does not walk into the module a stub replaces', () => {
    const root = tree({
      'src/store/tabs/tab-slice.ts': [
        "import { deep } from '$store/deep';",
        'export const openTab = () => deep();',
      ],
      'src/store/deep.ts': 'export const deep = () => {}; export const other = 1;',
      'src/lib/Strip.svelte': strip([`  import { openTab } from '${SLICE}';`, '  openTab();']),
      'test/strip.spec.ts': spec({
        [SLICE]: 'export const openTab = () => {};',
        '$store/deep': 'export const other = 1;',
      }),
    });
    expect(messages(root)).toEqual([
      "stub '$store/deep' replaces no import reachable from src/lib/Strip.svelte",
    ]);
  });

  it('does not mount a module the spec names only to replace it', () => {
    const root = tree({
      'src/lib/Card.svelte': strip([
        "  import { gone } from '$store/tabs/tab-slice';",
        '  gone();',
      ]),
      'src/store/tabs/tab-slice.ts': 'export const gone = 1;',
      'src/lib/Strip.svelte': strip(["  import Card from '$lib/Card.svelte';"], '<Card />'),
      'test/strip.spec.ts': [
        ...spec({ '$lib/Card.svelte': "export { default } from '/src/lib/Strip.svelte';" }),
        "const redirect = (id: string) => id === resolve('src/lib/Card.svelte');",
      ],
    });
    expect(messages(root)).toEqual([]);
  });

  it('matches an aliased import, not a relative one the alias stub cannot intercept', () => {
    const root = tree({
      'src/store/tabs/tab-slice.ts': 'export const openTab = () => {}; export const other = 1;',
      'src/store/tabs/selectors.ts': [
        "import { other } from './tab-slice';",
        'export const select = () => other;',
      ],
      'src/lib/Strip.svelte': strip([
        `  import { openTab } from '${SLICE}';`,
        "  import { select } from '$store/tabs/selectors';",
        '  openTab(); select();',
      ]),
      'test/strip.spec.ts': spec({ [SLICE]: 'export const openTab = () => {};' }),
    });
    expect(messages(root)).toEqual([]);
  });

  it('checks default imports, re-exports and imports made by other stubs', () => {
    const root = tree({
      'src/lib/Card.svelte': '<div></div>',
      'src/lib/mocks/MockTooltip.svelte': strip([
        "  import { toast } from '$lib/toast';",
        '  toast();',
      ]),
      'src/lib/toast.ts': 'export const toast = () => {};',
      'src/lib/barrel.ts': "export { toast, dismiss } from '$lib/toast';",
      'src/lib/Strip.svelte': strip(
        [
          "  import Card from '$lib/Card.svelte';",
          "  import { Tooltip } from '$lib/tooltip';",
          "  import { dismiss } from './barrel';",
          '  dismiss();',
        ],
        '<Card /><Tooltip />',
      ),
      'test/strip.spec.ts': spec({
        '$lib/Card.svelte': 'export const notDefault = 1;',
        '$lib/tooltip': [
          "import Tooltip from '/src/lib/mocks/MockTooltip.svelte';",
          'export { Tooltip };',
        ].join('\n'),
        '$lib/toast': 'export const unrelated = 1;',
      }),
    });
    expect(messages(root)).toEqual([
      "stub '$lib/Card.svelte' does not export default, which src/lib/Strip.svelte:2 imports",
      "stub '$lib/toast' does not export toast, dismiss, which src/lib/barrel.ts:1 imports",
      "stub '$lib/toast' does not export toast, which src/lib/mocks/MockTooltip.svelte:2 imports",
    ]);
  });

  it('accepts namespace and dynamic imports without checking names', () => {
    const root = tree({
      'src/store/tabs/tab-slice.ts': 'export const openTab = () => {};',
      'src/lib/Strip.svelte': strip([
        `  import * as slice from '${SLICE}';`,
        `  const later = () => import('${SLICE}');`,
        '  slice.openTab(); later();',
      ]),
      'test/strip.spec.ts': spec({ [SLICE]: 'export const unrelated = 1;' }),
    });
    expect(messages(root)).toEqual([]);
  });

  it('asks for an entry when a stub map has none to check against', () => {
    const root = tree({
      'test/strip.spec.ts': [
        'const virtualModules: Record<string, string> = {',
        "  '$lib/a': 'export const a = 1;',",
        '};',
        'export const plugin = { load: (id: string) => virtualModules[id] };',
      ],
    });
    expect(checkRootSpecStubs(root)).toEqual([
      expect.objectContaining({ key: 'test/strip.spec.ts: entries', line: 1 }),
    ]);
  });

  it('ignores specs and object literals that define no module stubs', () => {
    const root = tree({
      'src/lib/Strip.svelte': '<div></div>',
      'test/plain.spec.ts': [
        "const labels: Record<string, string> = { '$lib/a': 'Exported label', b: 'x' };",
        "const files: Record<string, string> = { 'src/lib/a.ts': 'export const a = 1;' };",
        'const plugin = { load: (id: string) => labels[id] };',
        "test('x', async ({ page }) => page.evaluate(() => import('/src/lib/Strip.svelte')));",
      ],
    });
    expect(messages(root)).toEqual([]);
  });

  it('reports stale allowlist entries', () => {
    const findings = [{ key: 'k', file: 'f', line: 1, message: 'm' }];
    expect(applyAllowlist(findings, { k: 'why', gone: 'why' })).toEqual({
      hits: [],
      stale: ['gone'],
    });
  });

  it('selects the architecture lane only for root specs that define stubs', () => {
    const root = tree({
      'test/strip.spec.ts': spec({ [SLICE]: 'export const openTab = () => {};' }),
      'test/plain.spec.ts': "import { test } from '@playwright/test';",
    });
    expect(isRootSpecStubInput('test/strip.spec.ts', root)).toBe(true);
    expect(isRootSpecStubInput('test/plain.spec.ts', root)).toBe(false);
    expect(isRootSpecStubInput('test/deleted.spec.ts', root)).toBe(false);
    expect(isRootSpecStubInput('src/lib/Strip.svelte', root)).toBe(false);
    expect(isRootSpecStubInput('tsconfig.json', root)).toBe(true);
    expect(isRootSpecStubInput('playwright/root-spec-pattern.mjs', root)).toBe(true);
  });
});
