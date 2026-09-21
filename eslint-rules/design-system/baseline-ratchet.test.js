import { describe, expect, it } from 'vitest';
import {
  assertBaselineOnlyShrinks,
  findBaselineGrowth,
  parseRegisteredRules,
} from './baseline-ratchet.js';

const original = {
  'no-raw-controls': [
    { owner: 'ui', reason: 'Legacy controls', files: ['src/A.svelte', 'src/B.svelte'] },
  ],
};

describe('design-system baseline growth guard', () => {
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
      'Design-system baseline entries and counts may only shrink',
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
      'Design-system baseline entries and counts may only shrink',
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
      'Design-system baseline entries and counts may only shrink',
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
      'Design-system baseline entries and counts may only shrink',
    );
    expect(findBaselineGrowth(counted, mixedNewFile)).toEqual({
      [rule]: [{ file: 'src/C.svelte', previous: 0, current: 'uncounted' }],
    });
    expect(findBaselineGrowth(mixedDowngrade, mixedConverted)).toEqual({});
  });
});
