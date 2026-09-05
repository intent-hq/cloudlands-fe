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
      'no-native-dialogs': [
        { owner: 'dialogs', reason: 'Legacy dialog', files: ['src/Dialog.svelte'] },
      ],
    };
    expect(() => assertBaselineOnlyShrinks(original, larger)).toThrow(
      'Design-system baseline entries may only be removed',
    );
    expect(findBaselineGrowth(original, larger)).toEqual({
      'no-native-dialogs': ['src/Dialog.svelte'],
      'no-raw-controls': ['src/C.svelte'],
    });
  });
});
