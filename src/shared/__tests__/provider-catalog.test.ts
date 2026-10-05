import { describe, expect, it } from 'vitest';
import { ProviderCatalogResponseSchema, ProviderCatalogRequestSchema } from '../provider-catalog';

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

describe('providers.catalog Fast mode capability', () => {
  it('accepts older rows and preserves explicit supported and unsupported values', () => {
    expect(
      ProviderCatalogResponseSchema.parse({ providers: [row] }).providers[0].supportsFastMode,
    ).toBeUndefined();
    for (const supportsFastMode of [true, false]) {
      expect(
        ProviderCatalogResponseSchema.parse({ providers: [{ ...row, supportsFastMode }] })
          .providers[0].supportsFastMode,
      ).toBe(supportsFastMode);
    }
  });
  it.each([null, 'true', 1])('rejects malformed Fast mode capability %j', (supportsFastMode) => {
    expect(
      ProviderCatalogResponseSchema.safeParse({ providers: [{ ...row, supportsFastMode }] })
        .success,
    ).toBe(false);
  });
});

describe('providers.catalog routing request', () => {
  it('accepts direct and workspace calls while retaining strict validation', () => {
    expect(ProviderCatalogRequestSchema.parse({})).toEqual({});
    expect(ProviderCatalogRequestSchema.parse({ workspaceId: 'A' })).toEqual({ workspaceId: 'A' });
    for (const params of [
      { workspaceId: '' },
      { workspaceId: null },
      { workspaceId: 'A', providerId: 'extra' },
    ]) {
      expect(ProviderCatalogRequestSchema.safeParse(params).success).toBe(false);
    }
  });
});
