// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertBaselineOnlyShrinks,
  findBaselineGrowth,
  lintPatterns,
  lintRuleFromRepoConfig,
  parseRegisteredRules,
  readComparisonBaseline,
  ruleScopeOverrides,
} from './baseline-ratchet.js';
import { namedColorAllowlist } from '../design-system/common.js';
import { designSystemRules } from '../design-system/index.js';
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
          { files: ['b/**'], rules: { [ruleId]: ['warn', { x: 1, baseline: { f: 1 } }] } },
          { rules: { other: 'error' } },
        ],
        ruleId,
      ),
    ).toEqual([{ files: ['b/**'], rules: { [ruleId]: ['warn', { x: 1, baseline: {} }] } }]);
  });

  it('copies settings without a baseline option verbatim, so schema-less rules accept them', () => {
    // Eleven design-system rules declare `schema: []`; adding an options object to them
    // makes ESLint reject the config, so only a present `baseline` is ever rewritten.
    const ruleId = 'intent/no-dialog-root-outside-patterns';
    expect(ruleScopeOverrides(repoConfig, ruleId)[0].rules[ruleId]).toBe('error');
    expect(
      ruleScopeOverrides(
        [{ files: ['b/**'], rules: { [ruleId]: ['warn', { x: 1 }] } }, { rules: { [ruleId]: 2 } }],
        ruleId,
      ),
    ).toEqual([
      { files: ['b/**'], rules: { [ruleId]: ['warn', { x: 1 }] } },
      { rules: { [ruleId]: 2 } },
    ]);
  });

  it('is accepted by real ESLint for every design-system rule and re-enables baselined files', async () => {
    // DirectoryPickerModal is the one file `designSystemBaselineOverrides` turns
    // `no-dialog-root-outside-patterns` off for, so it must come back on and report.
    const cwd = path.resolve(import.meta.dirname, '../..');
    const ruleIds = Object.keys(designSystemRules).map((id) => `intent/${id}`);
    const file = 'src/features/onboarding/messages/DirectoryPickerModal.svelte';
    const ruleId = 'intent/no-dialog-root-outside-patterns';
    const eslint = new ESLint({
      cwd,
      overrideConfig: ruleScopeOverrides(repoConfig, ruleIds),
      ruleFilter: ({ ruleId: id }) => ruleIds.includes(id),
      cache: false,
    });
    const baseEslint = new ESLint({ cwd, cache: false });
    const tsFile = 'src/lib/motion/index.ts';
    const [config, baseConfig, tsConfig] = await Promise.all([
      eslint.calculateConfigForFile(path.join(cwd, file)),
      baseEslint.calculateConfigForFile(path.join(cwd, file)),
      eslint.calculateConfigForFile(path.join(cwd, tsFile)),
    ]);
    expect(baseConfig.rules[ruleId]).toEqual([0]);
    expect(config.rules[ruleId]).toEqual([2]);
    for (const resolved of [config, tsConfig]) {
      for (const id of ruleIds) expect(resolved.rules[id][0]).not.toBe(0);
      expect(resolved.rules['intent/no-arbitrary-motion-or-color']).toEqual([
        2,
        { allowlist: namedColorAllowlist, baseline: {} },
      ]);
    }

    const [result] = await eslint.lintFiles([file]);
    expect(result.messages.filter((m) => m.ruleId === ruleId).length).toBeGreaterThan(0);
  }, 120_000);
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
    expect(seen.options.errorOnUnmatchedPattern).toBe(false);
    expect(seen.options.overrideConfig).toEqual(ruleScopeOverrides(repoConfig, ruleIds));
    expect(seen.options.ruleFilter({ ruleId: 'intent/no-raw-controls' })).toBe(true);
    expect(seen.options.ruleFilter({ ruleId: 'intent/no-raw-typography' })).toBe(false);
    expect(seen.patterns).toEqual(lintPatterns(ruleScopeOverrides(repoConfig, ruleIds)));
    expect(seen.patterns).not.toEqual(['.']);
    expect(counts).toEqual({
      'intent/no-raw-controls': { 'src/a.svelte': 2 },
      'intent/no-native-dialogs': {},
    });
  });
});

describe('lintRuleFromRepoConfig with ignored or unmatched config-derived globs', () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const ruleId = 'no-unused-vars';
  const offender = 'const unused = 1;\n';

  // A throwaway package whose flat config enables a core rule through `entries` and
  // globally ignores `ignores`; real ESLint resolves the resulting patterns from disk.
  function makePackage({ ignores, entries, files }) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-ratchet-scope-'));
    tmpDirs.push(cwd);
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"type":"module"}\n');
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      fs.writeFileSync(path.join(cwd, file), offender);
    }
    const config = [
      { ignores },
      ...entries.map((glob) => ({ files: [glob], rules: { [ruleId]: 'error' } })),
    ];
    fs.writeFileSync(
      path.join(cwd, 'eslint.config.js'),
      `export default ${JSON.stringify(config, null, 2)};\n`,
    );
    return cwd;
  }

  it('counts only the populated glob when a sibling glob is fully covered by a global ignore', async () => {
    const seen = {};
    class RecordingESLint extends ESLint {
      constructor(options) {
        super(options);
        seen.options = options;
      }
    }
    const entries = ['src/**/*.js', 'ignored/**/*.js'];
    const cwd = makePackage({
      ignores: ['ignored/**'],
      entries,
      files: ['src/a.js', 'ignored/b.js'],
    });
    // Control: ESLint's default rejects this pattern union outright.
    await expect(new ESLint({ cwd, cache: false }).lintFiles(entries)).rejects.toThrow(
      "All files matched by 'ignored/**/*.js' are ignored",
    );

    await expect(
      lintRuleFromRepoConfig({ cwd, ruleIds: ruleId, eslintClass: RecordingESLint }),
    ).resolves.toEqual({ [ruleId]: { 'src/a.js': 1 } });
    expect(seen.options.errorOnUnmatchedPattern).toBe(false);
  }, 30_000);

  it('returns empty counts when every config-derived glob is fully ignored', async () => {
    const cwd = makePackage({
      ignores: ['src/**'],
      entries: ['src/**/*.js'],
      files: ['src/a.js'],
    });
    await expect(lintRuleFromRepoConfig({ cwd, ruleIds: ruleId })).resolves.toEqual({
      [ruleId]: {},
    });
  }, 30_000);

  it('returns empty counts for a glob that matches no file at all', async () => {
    const cwd = makePackage({ ignores: [], entries: ['src/**/*.js'], files: [] });
    await expect(lintRuleFromRepoConfig({ cwd, ruleIds: ruleId })).resolves.toEqual({
      [ruleId]: {},
    });
  }, 30_000);
});

describe('lintPatterns', () => {
  it('narrows the source-literal ratchet to the test-file glob of its config entry', () => {
    expect(
      lintPatterns(ruleScopeOverrides(repoConfig, 'intent/no-source-literal-assertions-in-tests')),
    ).toEqual(['**/*.{test,spec}.{js,ts}']);
  });

  it('unions the globs of every entry enabling the design-system rules, without duplicates', () => {
    const ruleIds = Object.keys(designSystemRules).map((id) => `intent/${id}`);
    const overrides = ruleScopeOverrides(repoConfig, ruleIds);
    const expected = [...new Set(overrides.flatMap((entry) => entry.files))];
    expect(overrides.length).toBeGreaterThan(1);
    expect(lintPatterns(overrides)).toEqual(expected);
    expect(lintPatterns(overrides)).toEqual(
      expect.arrayContaining(['src/**/*.{js,mjs,ts,tsx,svelte}', 'src/**/*.css']),
    );
    expect(lintPatterns(overrides)).not.toContain('.');
  });

  it('falls back to the whole tree for an unscoped entry or a nested AND-glob', () => {
    const rules = { 'intent/x': 'error' };
    expect(lintPatterns([{ files: ['src/**/*.ts'], rules }, { rules }])).toEqual(['.']);
    expect(
      lintPatterns([
        { files: ['src/**/*.ts'], rules },
        { files: [['src/**', '*.ts']], rules },
      ]),
    ).toEqual(['.']);
    expect(lintPatterns([])).toEqual(['.']);
  });
});
