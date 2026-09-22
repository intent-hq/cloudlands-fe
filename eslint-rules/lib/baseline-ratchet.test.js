// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertBaselineOnlyShrinks,
  findBaselineGrowth,
  lintRuleFromRepoConfig,
  parseRegisteredRules,
  readComparisonBaseline,
  ruleScopeOverrides,
} from './baseline-ratchet.js';
import { namedColorAllowlist } from '../design-system/common.js';
import repoConfig from '../../eslint.config.js';

const original = {
  'no-raw-controls': [
    { owner: 'ui', reason: 'Legacy controls', files: ['src/A.svelte', 'src/B.svelte'] },
  ],
};

describe('baseline growth guard', () => {
  it('accepts removals', () => {
    const smaller = {
      'no-raw-controls': [{ owner: 'ui', reason: 'Legacy controls', files: ['src/B.svelte'] }],
    };
    expect(() => assertBaselineOnlyShrinks(original, smaller)).not.toThrow();
    expect(findBaselineGrowth(original, smaller)).toEqual({});
  });

  it('rejects additions per rule', () => {
    const larger = {
      'no-raw-controls': [
        {
          owner: 'ui',
          reason: 'Legacy controls',
          files: ['src/A.svelte', 'src/B.svelte', 'src/C.svelte'],
        },
      ],
    };
    expect(() => assertBaselineOnlyShrinks(original, larger)).toThrow(
      'Baseline entries and counts may only shrink',
    );
    expect(findBaselineGrowth(original, larger)).toEqual({
      'no-raw-controls': ['src/C.svelte'],
    });
  });

  it('allows a new rule to establish its initial baseline', () => {
    const withNewRule = {
      ...original,
      'no-native-dialogs': [
        { owner: 'dialogs', reason: 'Legacy dialog', files: ['src/Dialog.svelte'] },
      ],
    };

    expect(findBaselineGrowth(original, withNewRule, { newRules: ['no-native-dialogs'] })).toEqual(
      {},
    );
  });

  it('rejects a first exception for a rule that was already enforced at zero debt', () => {
    const withZeroDebtRule = {
      ...original,
      'no-native-dialogs': [
        { owner: 'dialogs', reason: 'Legacy dialog', files: ['src/Dialog.svelte'] },
      ],
    };

    expect(findBaselineGrowth(original, withZeroDebtRule)).toEqual({
      'no-native-dialogs': ['src/Dialog.svelte'],
    });
    expect(
      findBaselineGrowth(original, withZeroDebtRule, { newRules: ['no-raw-menu-row'] }),
    ).toEqual({ 'no-native-dialogs': ['src/Dialog.svelte'] });
    expect(() => assertBaselineOnlyShrinks(original, withZeroDebtRule, { newRules: [] })).toThrow(
      'Baseline entries and counts may only shrink',
    );
  });

  it('parses the registered rule names from the plugin index source', () => {
    const source = `import noRawControls from './no-raw-controls.js';
import noNativeDialogs from './no-native-dialogs.js';

export const designSystemRules = {
  'no-native-dialogs': noNativeDialogs,
  'no-raw-controls': noRawControls,
};
`;
    expect(parseRegisteredRules(source)).toEqual(['no-native-dialogs', 'no-raw-controls']);
  });

  it('rejects per-file count growth while accepting count reductions', () => {
    const counted = {
      'no-arbitrary-motion-or-color': [
        { owner: 'ui', reason: 'Legacy colors', counts: { 'src/A.svelte': 3 } },
      ],
    };
    const reduced = {
      'no-arbitrary-motion-or-color': [
        { owner: 'ui', reason: 'Legacy colors', counts: { 'src/A.svelte': 2 } },
      ],
    };
    const increased = {
      'no-arbitrary-motion-or-color': [
        {
          owner: 'ui',
          reason: 'Legacy colors',
          counts: { 'src/A.svelte': 4, 'src/B.svelte': 1 },
        },
      ],
    };

    expect(findBaselineGrowth(counted, reduced)).toEqual({});
    expect(findBaselineGrowth(counted, increased)).toEqual({
      'no-arbitrary-motion-or-color': [
        { file: 'src/A.svelte', previous: 3, current: 4 },
        { file: 'src/B.svelte', previous: 0, current: 1 },
      ],
    });
  });

  it('allows file exemptions to convert to counted violations for existing files only', () => {
    const fileExemptions = {
      'no-arbitrary-motion-or-color': [
        { owner: 'ui', reason: 'Legacy colors', files: ['src/A.svelte'] },
      ],
    };
    const counted = {
      'no-arbitrary-motion-or-color': [
        { owner: 'ui', reason: 'Legacy colors', counts: { 'src/A.svelte': 2 } },
      ],
    };
    const countedWithNewFile = {
      'no-arbitrary-motion-or-color': [
        {
          owner: 'ui',
          reason: 'Legacy colors',
          counts: { 'src/A.svelte': 2, 'src/B.svelte': 1 },
        },
      ],
    };
    expect(findBaselineGrowth(fileExemptions, counted)).toEqual({});
    expect(findBaselineGrowth(fileExemptions, countedWithNewFile)).toEqual({
      'no-arbitrary-motion-or-color': [{ file: 'src/B.svelte', previous: 0, current: 1 }],
    });
    expect(
      findBaselineGrowth(original, { 'no-raw-controls': counted['no-arbitrary-motion-or-color'] }),
    ).toEqual({});
  });

  it('rejects downgrading counted violations to uncounted file exemptions', () => {
    const counted = {
      'no-arbitrary-motion-or-color': [
        { owner: 'ui', reason: 'Legacy colors', counts: { 'src/A.svelte': 3 } },
      ],
    };
    const uncounted = {
      'no-arbitrary-motion-or-color': [
        { owner: 'ui', reason: 'Legacy colors', files: ['src/A.svelte'] },
      ],
    };
    expect(findBaselineGrowth(counted, uncounted)).toEqual({
      'no-arbitrary-motion-or-color': [{ file: 'src/A.svelte', previous: 3, current: 'uncounted' }],
    });
    expect(() => assertBaselineOnlyShrinks(counted, uncounted)).toThrow(
      'Baseline entries and counts may only shrink',
    );
  });

  it('rejects a per-file count-to-file downgrade while other counted files remain', () => {
    const rule = 'no-arbitrary-motion-or-color';
    const counted = {
      [rule]: [
        { owner: 'ui', reason: 'Legacy colors', counts: { 'src/A.svelte': 3, 'src/B.svelte': 1 } },
      ],
    };
    const mixedDowngrade = {
      [rule]: [
        { owner: 'ui', reason: 'Legacy colors', counts: { 'src/A.svelte': 3 } },
        { owner: 'ui', reason: 'Legacy colors', files: ['src/B.svelte'] },
      ],
    };
    const mixedNewFile = {
      [rule]: [
        { owner: 'ui', reason: 'Legacy colors', counts: { 'src/A.svelte': 3, 'src/B.svelte': 1 } },
        { owner: 'ui', reason: 'Legacy colors', files: ['src/C.svelte'] },
      ],
    };
    const mixedConverted = {
      [rule]: [
        { owner: 'ui', reason: 'Legacy colors', counts: { 'src/A.svelte': 3, 'src/B.svelte': 1 } },
      ],
    };

    expect(findBaselineGrowth(counted, mixedDowngrade)).toEqual({
      [rule]: [{ file: 'src/B.svelte', previous: 1, current: 'uncounted' }],
    });
    expect(() => assertBaselineOnlyShrinks(counted, mixedDowngrade)).toThrow(
      'Baseline entries and counts may only shrink',
    );
    expect(findBaselineGrowth(counted, mixedNewFile)).toEqual({
      [rule]: [{ file: 'src/C.svelte', previous: 0, current: 'uncounted' }],
    });
    expect(findBaselineGrowth(mixedDowngrade, mixedConverted)).toEqual({});
  });
});

describe('readComparisonBaseline base ref', () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  // A throwaway repo whose two commits differ in the baseline file, so which ref the
  // env selects is observable through the parsed contents.
  function makeRepo() {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-ratchet-'));
    tmpDirs.push(cwd);
    const git = (...args) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const file = 'baseline.json';
    const write = (value) => fs.writeFileSync(path.join(cwd, file), JSON.stringify(value));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'ratchet@example.com');
    git('config', 'user.name', 'ratchet');
    write({ ref: 'base' });
    git('add', file);
    git('commit', '-q', '-m', 'base');
    git('branch', 'base');
    write({ ref: 'head' });
    git('commit', '-q', '-am', 'head');
    return { cwd, file };
  }

  it('reads LINT_BASELINE_BASE_REF, falling back to HEAD when unset', () => {
    const { cwd, file } = makeRepo();
    expect(readComparisonBaseline({ cwd, file, env: {} })).toMatchObject({
      ref: 'HEAD',
      baseline: { ref: 'head' },
    });
    expect(
      readComparisonBaseline({ cwd, file, env: { LINT_BASELINE_BASE_REF: 'base' } }),
    ).toMatchObject({ ref: 'base', baseline: { ref: 'base' } });
  });

  it('honors the pre-rename DESIGN_SYSTEM_BASELINE_BASE_REF, with the new name winning', () => {
    const { cwd, file } = makeRepo();
    expect(
      readComparisonBaseline({ cwd, file, env: { DESIGN_SYSTEM_BASELINE_BASE_REF: 'base' } }),
    ).toMatchObject({ ref: 'base', baseline: { ref: 'base' } });
    expect(
      readComparisonBaseline({
        cwd,
        file,
        env: { LINT_BASELINE_BASE_REF: 'HEAD', DESIGN_SYSTEM_BASELINE_BASE_REF: 'base' },
      }),
    ).toMatchObject({ ref: 'HEAD', baseline: { ref: 'head' } });
  });
});

describe('ruleScopeOverrides', () => {
  it('derives the source-literal rule scope from its config entry with the baseline reset', () => {
    expect(ruleScopeOverrides(repoConfig, 'intent/no-source-literal-assertions-in-tests')).toEqual([
      {
        files: ['**/*.{test,spec}.{js,ts}'],
        rules: { 'intent/no-source-literal-assertions-in-tests': ['error', { baseline: {} }] },
      },
    ]);
  });

  it('keeps the allowlist option while resetting the motion/color baseline', () => {
    const ruleId = 'intent/no-arbitrary-motion-or-color';
    const overrides = ruleScopeOverrides(repoConfig, [ruleId]);
    expect(overrides).toHaveLength(1);
    const [entry] = overrides;
    expect(entry.files).toEqual(['src/**/*.{js,mjs,ts,tsx,svelte}']);
    expect(entry.ignores).toEqual(expect.arrayContaining(['**/*.test.{js,jsx,ts,tsx,svelte}']));
    expect(entry.rules[ruleId]).toEqual([
      'error',
      { allowlist: namedColorAllowlist, baseline: {} },
    ]);
    expect(Object.keys(entry)).toEqual(['files', 'ignores', 'rules']);
  });

  it('skips entries that disable the rule, so per-file off overrides never widen the scope', () => {
    // A rule whose baseline lists `files`, so the repo config carries a per-file 'off' entry.
    const ruleId = 'intent/no-dialog-root-outside-patterns';
    const disabling = repoConfig.filter((entry) => entry.rules?.[ruleId] === 'off');
    expect(disabling.length).toBeGreaterThan(0);
    const overrides = ruleScopeOverrides(repoConfig, ruleId);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].files).toEqual(['src/**/*.{js,mjs,ts,tsx,svelte}']);
    expect(
      ruleScopeOverrides(
        [
          { files: ['a/**'], rules: { [ruleId]: 0 } },
          { files: ['b/**'], rules: { [ruleId]: ['warn', { x: 1 }] } },
          { rules: { other: 'error' } },
        ],
        ruleId,
      ),
    ).toEqual([{ files: ['b/**'], rules: { [ruleId]: ['warn', { x: 1, baseline: {} }] } }]);
  });
});

describe('lintRuleFromRepoConfig', () => {
  it('builds ESLint on the repo config (no overrideConfigFile), filtered to the ratcheted rules', async () => {
    const ruleIds = ['intent/no-raw-controls', 'intent/no-native-dialogs'];
    const seen = {};
    class FakeESLint {
      constructor(options) {
        seen.options = options;
      }
      async lintFiles(patterns) {
        seen.patterns = patterns;
        return [
          {
            filePath: path.join(process.cwd(), 'src', 'a.svelte'),
            messages: [
              { ruleId: 'intent/no-raw-controls' },
              { ruleId: 'intent/no-raw-controls' },
              { ruleId: 'intent/no-raw-typography' },
            ],
          },
          { filePath: path.join(process.cwd(), 'src', 'b.svelte'), messages: [] },
        ];
      }
    }

    const counts = await lintRuleFromRepoConfig({
      cwd: process.cwd(),
      ruleIds,
      eslintClass: FakeESLint,
    });

    expect(seen.options).not.toHaveProperty('overrideConfigFile');
    expect(seen.options.cwd).toBe(process.cwd());
    expect(seen.options.overrideConfig).toEqual(ruleScopeOverrides(repoConfig, ruleIds));
    expect(seen.options.ruleFilter({ ruleId: 'intent/no-raw-controls' })).toBe(true);
    expect(seen.options.ruleFilter({ ruleId: 'intent/no-raw-typography' })).toBe(false);
    expect(seen.patterns).toEqual(['.']);
    expect(counts).toEqual({
      'intent/no-raw-controls': { 'src/a.svelte': 2 },
      'intent/no-native-dialogs': {},
    });
  });
});
