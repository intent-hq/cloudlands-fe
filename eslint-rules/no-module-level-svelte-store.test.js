// @vitest-environment node
// The ratchet lints every file in the rule's eslint.config.js scope.
// @verify-changed-triggers: src/**/*.{js,mjs,ts,svelte}, eslint.config.js,
//   eslint-rules/baselines/no-module-level-svelte-store/**
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ESLint, RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import {
  baselineCounts,
  findBaselineGrowth,
  lintRuleFromRepoConfig,
  loadBaseline,
  readComparisonBaseline,
} from './lib/baseline-ratchet.js';
import rule from './no-module-level-svelte-store.js';

const root = process.cwd();
const ruleName = 'no-module-level-svelte-store';
// `eslint-rules/baselines/no-module-level-svelte-store/<source file>.json`, each holding
// `{ "count": N }`; lower it as stores move to Redux and delete the file at zero.
const baselineTree = loadBaseline({ cwd: root, rules: [ruleName] });
const baseline = baselineCounts(baselineTree[ruleName]) ?? {};
const ruleId = `intent/${ruleName}`;

const sourceRelative = 'src/features/example/example-state.ts';
const filename = path.resolve(sourceRelative);
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
});

const svelteTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parser: svelteParser,
    parserOptions: { parser: tsParser },
  },
});
const componentFilename = path.resolve('src/lib/components/Example.svelte');

const error = (line) => ({ messageId: 'moduleLevelStore', line });

describe('no-module-level-svelte-store guidance', () => {
  it('points at Redux slices, the Migration Guide and the incident', () => {
    const message = rule.meta.messages.moduleLevelStore;
    expect(message).toContain('Redux slice');
    expect(message).toContain('src/store/renderer/docs/MIGRATION_GUIDE.md');
    expect(message).toContain('cloudlands-fe#5058');
  });

  it('declares the per-file count baseline in its schema', () => {
    expect(rule.meta.schema[0].properties.baseline).toEqual({
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 1 },
    });
  });
});

describe('no-module-level-svelte-store in the repo config', () => {
  const eslint = new ESLint({
    cwd: root,
    ruleFilter: ({ ruleId: id }) => id === ruleId,
    cache: false,
  });
  const store = `import { writable } from 'svelte/store';\nexport const dialogOpen = writable(false);\n`;
  const lint = async (file, code = store) => {
    const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
    return result.messages.filter((message) => message.ruleId === ruleId);
  };

  it('rejects a renderer module that exports a writable store', async () => {
    for (const file of [
      'src/features/agent/fixture-dialog-state.ts',
      'src/lib/components/fixture-dialog-state.svelte.ts',
      'src/store/renderer/fixture-dialog-state.ts',
      'src/routes/fixture-dialog-state.ts',
    ]) {
      expect(await lint(file), file).toHaveLength(1);
    }
  });

  it('rejects a store in a component <script module> but not its instance script', async () => {
    const component = `<script module>
  import { writable } from 'svelte/store';
  export const shared = writable(0);
</script>
<script lang="ts">
  const local = writable(0);
</script>
`;
    const messages = await lint('src/lib/components/FixtureDialog.svelte', component);
    expect(messages.map((message) => message.line)).toEqual([3]);
  });

  it('leaves tests, test helpers and main-process code alone', async () => {
    for (const file of [
      'src/features/agent/fixture-dialog-state.test.ts',
      'src/lib/components/__tests__/fixture-dialog-state.ts',
      'src/test/fixture-dialog-state.ts',
      'src/features/agent/main/fixture-dialog-state.ts',
      'src/main/fixture-dialog-state.ts',
    ]) {
      expect(await lint(file), file).toEqual([]);
    }
  });
});

describe('no-module-level-svelte-store baseline ratchet', () => {
  it('maps existing package-relative source files to counted entries only', () => {
    for (const exception of baselineTree[ruleName] ?? []) {
      expect(exception.files, 'every entry must carry a count').toBeUndefined();
    }
    for (const file of Object.keys(baseline)) {
      expect(file, `${file} should be a package-relative source file`).toMatch(
        /^src\/[^\\]*\.(js|mjs|ts|svelte)$/,
      );
      expect(fs.existsSync(path.join(root, file)), `${file} no longer exists`).toBe(true);
    }
  });

  it('never grows a count against the comparison revision', () => {
    const comparison = readComparisonBaseline({ cwd: root, rules: [ruleName] });
    // A revision whose eslint.config.js does not enable the rule enforced nothing, so
    // the initial baseline may be established against it; afterwards counts only shrink.
    const comparisonConfig = execFileSync('git', ['show', `${comparison.ref}:eslint.config.js`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const newRules = comparisonConfig.includes(`'${ruleId}'`) ? [] : [ruleName];
    expect(
      findBaselineGrowth(comparison.baseline, baselineTree, { newRules }),
      `per-file counts may only shrink relative to ${comparison.ref}`,
    ).toEqual({});
  });

  // Lints every file the real `eslint.config.js` lints (same rule entry, same global
  // ignores), so this ratchet and `pnpm lint` cannot disagree on scope.
  it('matches today’s stores exactly: no stale count, no new store', async () => {
    const { [ruleId]: current } = await lintRuleFromRepoConfig({ cwd: root, ruleIds: ruleId });

    const stale = Object.fromEntries(
      Object.entries(baseline)
        .filter(([file, count]) => (current[file] ?? 0) < count)
        .map(([file, count]) => [file, { baseline: count, current: current[file] ?? 0 }]),
    );
    expect(stale, 'lower or remove these baseline counts; the stores were removed').toEqual({});
    const grown = Object.fromEntries(
      Object.entries(current)
        .filter(([file, count]) => count > (baseline[file] ?? 0))
        .map(([file, count]) => [file, { baseline: baseline[file] ?? 0, current: count }]),
    );
    expect(
      grown,
      'new module-level Svelte stores; put shared state in a Redux slice instead of raising the baseline',
    ).toEqual({});
  }, 240_000);
});

tester.run('no-module-level-svelte-store', rule, {
  valid: [
    {
      name: 'a store created inside a function',
      filename,
      code: `
import { writable, derived } from 'svelte/store';
export function createPickerState(models) {
  const open = writable(false);
  return { open, count: derived(open, ($open) => ($open ? models.length : 0)) };
}`,
    },
    {
      name: 'a store created inside an arrow function, a method or an instance field',
      filename,
      code: `
import { readable, writable } from 'svelte/store';
export const makeClock = () => readable(0);
export class Controller {
  open = writable(false);
  reset() {
    this.open = writable(false);
  }
}`,
    },
    {
      name: 'toStore inside a function, and fromStore or readonly at module scope',
      filename,
      code: `
import { fromStore, readonly, toStore } from 'svelte/store';
import { existing } from './existing';
export function bindReview(getDemand) {
  return toStore(() => getDemand());
}
export const view = fromStore(existing);
export const exposed = readonly(existing);`,
    },
    {
      name: 'reading a store with get() at module scope',
      filename,
      code: `
import { get } from 'svelte/store';
import { existing } from './existing';
export const initial = get(existing);`,
    },
    {
      name: 'a writable from another module',
      filename,
      code: `
import { writable } from './local-cell';
export const cell = writable(0);`,
    },
    {
      name: 'a type-only import',
      filename,
      code: `
import type { Writable } from 'svelte/store';
export type Cell = Writable<number>;`,
    },
    {
      name: 'a re-export does not create a store',
      filename,
      code: `export { writable } from 'svelte/store';`,
    },
    {
      name: 'a factory, a class and an instance method that nothing runs at load time',
      filename,
      code: `
import { writable } from 'svelte/store';
export function createDialogState() {
  return writable(false);
}
export class Session {
  open = writable(false);
}
class Tracker {
  reset() {
    this.counter = writable(0);
  }
}
export const tracker = new Tracker();
export const onOpen = () => createDialogState();`,
    },
    {
      name: 'a store in a callback passed at load time',
      filename,
      code: `
import { writable } from 'svelte/store';
const cells = new Map();
export const cellFor = (id) => cells.get(id) ?? cells.set(id, writable(0)).get(id);
document.addEventListener('ready', () => {
  cells.set('ready', writable(true));
});`,
    },
    {
      name: 'a same-name function in another scope does not mark the lazy factory as loaded',
      filename,
      code: `
import { writable } from 'svelte/store';
export function createState() {
  return writable(false);
}
export const initial = (() => {
  const createState = () => false;
  return createState();
})();`,
    },
    {
      name: 'a local binding that shadows the import',
      filename,
      code: `
import { writable } from 'svelte/store';
export const cell = (() => {
  const writable = (value) => ({ value });
  return writable(0);
})();`,
    },
    {
      name: 'a reasoned disable does not use up the allowance',
      filename,
      options: [{ baseline: { [sourceRelative]: 1 } }],
      code: `
import { writable } from 'svelte/store';
// eslint-disable-next-line rule-to-test/no-module-level-svelte-store -- bridge for a legacy consumer
export const open = writable(false);
export const label = writable('');`,
    },
    {
      name: 'baselined stores up to the count',
      filename,
      options: [{ baseline: { [sourceRelative]: 2 } }],
      code: `
import { writable, derived } from 'svelte/store';
export const open = writable(false);
export const label = derived(open, ($open) => ($open ? 'Open' : 'Closed'));`,
    },
  ],
  invalid: [
    {
      name: 'an exported module-level writable (cloudlands-fe#5058)',
      filename,
      code: `
import { writable } from 'svelte/store';
export const switchAllDialog = writable({ open: false });`,
      errors: [error(3)],
    },
    {
      name: 'module-level readable and derived, exported or not',
      filename,
      code: `
import { derived, readable } from 'svelte/store';
const now = readable(Date.now());
export const seconds = derived(now, ($now) => Math.floor($now / 1000));`,
      errors: [error(3), error(4)],
    },
    {
      name: 'an aliased import',
      filename,
      code: `
import { writable as cell } from 'svelte/store';
export const open = cell(false);`,
      errors: [error(3)],
    },
    {
      name: 'a namespace import',
      filename,
      code: `
import * as stores from 'svelte/store';
export const open = stores.writable(false);`,
      errors: [error(3)],
    },
    {
      name: 'a module-level toStore, directly or through a namespace import',
      filename,
      code: `
import * as stores from 'svelte/store';
import { toStore } from 'svelte/store';
let open = false;
export const openStore = toStore(() => open, (value) => (open = value));
export const label = stores.toStore(() => (open ? 'Open' : 'Closed'));`,
      errors: [error(5), error(6)],
    },
    {
      name: 'a store inside a module-level object literal',
      filename,
      code: `
import { writable } from 'svelte/store';
export const state = { open: writable(false) };`,
      errors: [error(3)],
    },
    {
      name: 'a store inside an immediately invoked function',
      filename,
      code: `
import { writable } from 'svelte/store';
export const state = (() => {
  const open = writable(false);
  return { open };
})();`,
      errors: [error(4)],
    },
    {
      name: 'imports placed after the calls (named, aliased and namespace)',
      filename,
      code: `
export const open = writable(false);
export const label = cell('');
export const count = stores.readable(0);
import { writable, writable as cell } from 'svelte/store';
import * as stores from 'svelte/store';`,
      errors: [error(2), error(3), error(4)],
    },
    {
      name: 'a store inside a function invoked with .call or .apply',
      filename,
      code: `
import { writable } from 'svelte/store';
export const a = function () {
  return writable(0);
}.call(this);
export const b = (function () {
  return writable(0);
}).apply(this, []);`,
      errors: [error(4), error(7)],
    },
    {
      name: 'a custom store factory called at load time (declaration and const arrow)',
      filename,
      code: `
import { writable } from 'svelte/store';
function createCount() {
  const { subscribe, set } = writable(0);
  return { subscribe, reset: () => set(0) };
}
const createFlag = () => writable(false);
export const count = createCount();
export const flag = createFlag();`,
      errors: [error(4), error(7)],
    },
    {
      name: 'a factory reached through another local function',
      filename,
      code: `
import { writable } from 'svelte/store';
function createCell() {
  return writable(0);
}
function createState() {
  return { cell: createCell() };
}
export const state = createState();`,
      errors: [error(4)],
    },
    {
      name: 'a singleton whose static getInstance creates the instance',
      filename,
      code: `
import { writable } from 'svelte/store';
class Tracker {
  static instance;
  counter = writable(0);
  static getInstance() {
    if (!Tracker.instance) Tracker.instance = new Tracker();
    return Tracker.instance;
  }
}
class Bus {
  constructor() {
    this.events = writable([]);
  }
  static create() {
    return new this();
  }
}
export const tracker = Tracker.getInstance();
export const bus = Bus.create();`,
      errors: [error(5), error(13)],
    },
    {
      name: 'a class instantiated at load time',
      filename,
      code: `
import { writable } from 'svelte/store';
const Registry = class {
  entries = writable([]);
};
export const registry = new Registry();`,
      errors: [error(4)],
    },
    {
      name: 'a static class field or static block',
      filename,
      code: `
import { writable } from 'svelte/store';
export class Registry {
  static open = writable(false);
  static {
    Registry.label = writable('');
  }
}`,
      errors: [error(4), error(6)],
    },
    {
      name: 'a store at module scope in a .svelte.ts module',
      filename: path.resolve('src/lib/components/example-state.svelte.ts'),
      code: `
import { writable } from 'svelte/store';
export const draft = writable('');`,
      errors: [error(3)],
    },
    {
      name: 'stores beyond the baselined count, in source order',
      filename,
      options: [{ baseline: { [sourceRelative]: 1 } }],
      code: `
import { writable } from 'svelte/store';
export const open = writable(false);
export const label = writable('');`,
      errors: [error(4)],
    },
    {
      name: 'a baseline for another file does not apply',
      filename,
      options: [{ baseline: { 'src/features/other/other-state.ts': 3 } }],
      code: `
import { writable } from 'svelte/store';
export const open = writable(false);`,
      errors: [error(3)],
    },
  ],
});

svelteTester.run('no-module-level-svelte-store (components)', rule, {
  valid: [
    {
      name: 'a store in the instance script',
      filename: componentFilename,
      code: `<script lang="ts">
  import { derived, writable } from 'svelte/store';
  const open = writable(false);
  const label = derived(open, ($open) => ($open ? 'Open' : 'Closed'));
</script>
<p>{$label}</p>`,
    },
  ],
  invalid: [
    {
      name: 'a store at the top level of <script module>',
      filename: componentFilename,
      code: `<script module lang="ts">
  import { writable } from 'svelte/store';
  export const shared = writable(0);
  export function make() {
    return writable(0);
  }
</script>
<script lang="ts">
  const local = writable(0);
</script>`,
      errors: [error(3)],
    },
    {
      name: 'a store in a <script context="module"> block',
      filename: componentFilename,
      code: `<script context="module">
  import { writable } from 'svelte/store';
  export const shared = writable(0);
</script>`,
      errors: [error(3)],
    },
  ],
});
