import { describe, expect, it } from 'vitest';
import { ProviderCatalogResponseSchema } from '../provider-catalog';

const row = {
  id: 'provider',
  displayName: 'Provider',
  shortName: 'Provider',
  command: 'provider',
  canBeDisabled: true,
  visible: true,
};

describe('providers.catalog additive alias wire metadata', () => {
  it('preserves optional aliases while accepting an older daemon without them', () => {
    expect(
      ProviderCatalogResponseSchema.parse({ providers: [row] }).providers[0],
    ).not.toHaveProperty('legacyAliases');
    const updated = { ...row, legacyAliases: ['default', 'acp', 'augment'] };
    expect(ProviderCatalogResponseSchema.parse({ providers: [updated] }).providers[0]).toEqual(
      updated,
    );
  });
  it.each([null, 'acp', [null], [1], ['']])(
    'rejects malformed alias metadata %j',
    (legacyAliases) => {
      expect(
        ProviderCatalogResponseSchema.safeParse({ providers: [{ ...row, legacyAliases }] }).success,
      ).toBe(false);
    },
  );
});
