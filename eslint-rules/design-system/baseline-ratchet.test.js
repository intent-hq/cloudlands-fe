import { describe, expect, it } from 'vitest';
import { assertBaselineOnlyShrinks, findBaselineGrowth } from './baseline-ratchet.js';

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

    expect(findBaselineGrowth(original, withNewRule)).toEqual({});
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

  it('allows the one-time migration from file exemptions to counted violations', () => {
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
    expect(findBaselineGrowth(fileExemptions, counted)).toEqual({});
    expect(
      findBaselineGrowth(original, { 'no-raw-controls': counted['no-arbitrary-motion-or-color'] }),
    ).toEqual({
      'no-raw-controls': [{ file: 'src/A.svelte', previous: 0, current: 2 }],
    });
  });
});
