/**
 * Provider Catalog reducer + selector tests.
 *
 * Pins the §5.38 ingest contract: rows stored verbatim (no healing), the
 * daemon's registry order preserved, lookups keyed by id, the
 * getProviderConfig-style effective-default fallback, and enabled-state
 * resolution against the providerSettings persisted map. No row carries a
 * default designation — the effective default provider is settings-derived
 * (`selectEffectiveDefaultProviderId`).
 */
import { describe, expect, it } from 'vitest';
import type { ProviderCatalogResult } from '$shared/provider-catalog';
import type { StoreState } from '../../types';
import {
  selectAllCatalogProviderIds,
  selectEffectiveDefaultProviderId,
  selectProviderCatalogEntries,
  selectProviderCatalogEntry,
  selectProviderCatalogEntryOrDefault,
  selectProviderCatalogLoaded,
  selectProviderEnabledFromCatalog,
} from './provider-catalog-selectors';
import {
  initialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from './provider-catalog-slice';
import type { ProviderCatalogState } from './provider-catalog-types';

/** PROTOCOL §5.38-shaped catalog. `unsloth` before `pi` pins registry order. */
const CATALOG: ProviderCatalogResult = {
  providers: [
    {
      id: 'auggie',
      displayName: 'Augment Auggie',
      shortName: 'Auggie',
      command: 'auggie',
      canBeDisabled: true,
      loginCommandHint: 'auggie login',
      authErrorPatterns: ['authentication required', 'auggie login'],
      visible: true,
    },
    {
      id: 'unsloth',
      displayName: 'Unsloth',
      shortName: 'Unsloth',
      command: 'opencode',
      canBeDisabled: true,
      loginDocsUrl: 'https://docs.unsloth.ai',
      visible: true,
    },
    {
      id: 'pi',
      displayName: 'Pi',
      shortName: 'Pi',
      command: 'pi-acp',
      canBeDisabled: true,
      loginDocsUrl: 'https://pi.dev/docs/latest/quickstart',
      visible: true,
    },
    {
      id: 'mock',
      displayName: 'Mock (E2E)',
      shortName: 'Mock',
      command: 'node',
      canBeDisabled: true,
      requiresEnvVar: 'MOCK_AGENT_SCRIPT_PATH',
      visible: false,
    },
  ],
};

function storeWith(
  providerCatalog: ProviderCatalogState,
  enabledProviders: Record<string, boolean> = {},
  extra: { activeProviderId?: string; providerModels?: Record<string, string> } = {},
): StoreState {
  return {
    providerCatalog,
    providerSettings: { enabledProviders, activeProviderId: extra.activeProviderId ?? '' },
    model: { providerModels: extra.providerModels ?? {} },
  } as unknown as StoreState;
}

const hydrated = providerCatalogReducer(initialState, providerCatalogLoaded(CATALOG));

describe('providerCatalogReducer', () => {
  it('starts empty and not loaded', () => {
    const state = providerCatalogReducer(undefined, { type: '@@INIT' });
    expect(state.providers.ids).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it('providerCatalogLoaded stores rows verbatim in registry order and flips loaded', () => {
    expect(hydrated.loaded).toBe(true);
    // Registry order — unsloth precedes pi; NOT the old hardcoded array order.
    expect(hydrated.providers.ids).toEqual(['auggie', 'unsloth', 'pi', 'mock']);
    // Rows land exactly as sent — gated-off rows and optional fields included.
    expect(hydrated.providers.map['mock']).toEqual(CATALOG.providers[3]);
    expect(hydrated.providers.map['auggie']).toEqual(CATALOG.providers[0]);
  });

  it('a later providerCatalogLoaded replaces the whole catalog atomically', () => {
    const next: ProviderCatalogResult = {
      providers: [CATALOG.providers[1]],
    };
    const state = providerCatalogReducer(hydrated, providerCatalogLoaded(next));
    expect(state.providers.ids).toEqual(['unsloth']);
    expect(state.providers.map['auggie']).toBeUndefined();
  });
});

describe('provider-catalog selectors', () => {
  it('exposes loaded / entries / ids', () => {
    expect(selectProviderCatalogLoaded.select(storeWith(initialState))).toBe(false);
    expect(selectProviderCatalogLoaded.select(storeWith(hydrated))).toBe(true);
    expect(selectProviderCatalogEntries.select(storeWith(hydrated))).toEqual(CATALOG.providers);
    expect(selectAllCatalogProviderIds.select(storeWith(hydrated))).toEqual([
      'auggie',
      'unsloth',
      'pi',
      'mock',
    ]);
  });

  it('selectEffectiveDefaultProviderId derives the default from user settings', () => {
    // Compound global default model wins: its provider prefix (a known
    // catalog row) is the default.
    expect(
      selectEffectiveDefaultProviderId.select(
        storeWith(hydrated, {}, {
          activeProviderId: 'pi',
          providerModels: { pi: 'unsloth:some-model' },
        }),
      ),
    ).toBe('unsloth');
    // Bare global model → the active provider.
    expect(
      selectEffectiveDefaultProviderId.select(
        storeWith(hydrated, {}, { activeProviderId: 'pi', providerModels: { pi: 'sonnet4.5' } }),
      ),
    ).toBe('pi');
    // No global model → the active provider.
    expect(
      selectEffectiveDefaultProviderId.select(storeWith(hydrated, {}, { activeProviderId: 'pi' })),
    ).toBe('pi');
    // Nothing configured → the first catalog row (neutral positional rule).
    expect(selectEffectiveDefaultProviderId.select(storeWith(hydrated))).toBe('auggie');
    // Before hydration with nothing configured → ''.
    expect(selectEffectiveDefaultProviderId.select(storeWith(initialState))).toBe('');
  });

  it('selectEffectiveDefaultProviderId ignores compound prefixes unknown to the catalog', () => {
    // Malformed/legacy compound id: the prefix is not a catalog provider id
    // once the catalog is hydrated → fall through to the active provider.
    expect(
      selectEffectiveDefaultProviderId.select(
        storeWith(hydrated, {}, {
          activeProviderId: 'pi',
          providerModels: { pi: 'legacy-removed-provider:some-model' },
        }),
      ),
    ).toBe('pi');
    // Empty-prefix malformed id (':model') also falls through.
    expect(
      selectEffectiveDefaultProviderId.select(
        storeWith(hydrated, {}, { activeProviderId: 'pi', providerModels: { pi: ':model' } }),
      ),
    ).toBe('pi');
    // Before hydration there is no catalog to validate against — the prefix
    // is trusted verbatim (re-validated once the catalog lands).
    expect(
      selectEffectiveDefaultProviderId.select(
        storeWith(initialState, {}, {
          activeProviderId: 'pi',
          providerModels: { pi: 'opencode:some-model' },
        }),
      ),
    ).toBe('opencode');
  });

  it('selectProviderCatalogEntry keys by id, undefined for unknown ids', () => {
    expect(selectProviderCatalogEntry.select(storeWith(hydrated), 'pi')?.command).toBe('pi-acp');
    expect(selectProviderCatalogEntry.select(storeWith(hydrated), 'nope')).toBeUndefined();
  });

  it('selectProviderCatalogEntryOrDefault falls back to the effective default row', () => {
    expect(selectProviderCatalogEntryOrDefault.select(storeWith(hydrated), 'unsloth')?.id).toBe(
      'unsloth',
    );
    // Nothing configured → the first catalog row is the effective default.
    expect(selectProviderCatalogEntryOrDefault.select(storeWith(hydrated), 'nope')?.id).toBe(
      'auggie',
    );
    // A configured active provider redirects the fallback row.
    expect(
      selectProviderCatalogEntryOrDefault.select(
        storeWith(hydrated, {}, { activeProviderId: 'pi' }),
        'nope',
      )?.id,
    ).toBe('pi');
    // Before hydration there is no default row to fall back to.
    expect(
      selectProviderCatalogEntryOrDefault.select(storeWith(initialState), 'auggie'),
    ).toBeUndefined();
  });

  it('selectProviderEnabledFromCatalog resolves enabled state like resolveProviderEnabled', () => {
    // Providers default to disabled when unset — no default-provider exception.
    expect(selectProviderEnabledFromCatalog.select(storeWith(hydrated), 'auggie')).toBe(false);
    expect(selectProviderEnabledFromCatalog.select(storeWith(hydrated), 'pi')).toBe(false);
    // An explicit persisted entry always wins.
    expect(
      selectProviderEnabledFromCatalog.select(storeWith(hydrated, { pi: true }), 'pi'),
    ).toBe(true);
    expect(
      selectProviderEnabledFromCatalog.select(storeWith(hydrated, { auggie: false }), 'auggie'),
    ).toBe(false);
    // canBeDisabled:false rows are always enabled regardless of the map.
    const withLocked = providerCatalogReducer(
      initialState,
      providerCatalogLoaded({
        providers: [{ ...CATALOG.providers[0], canBeDisabled: false }],
      }),
    );
    expect(
      selectProviderEnabledFromCatalog.select(storeWith(withLocked, { auggie: false }), 'auggie'),
    ).toBe(true);
    // An UNKNOWN id must not inherit another row's canBeDisabled:false —
    // it resolves through the persisted map instead.
    expect(selectProviderEnabledFromCatalog.select(storeWith(withLocked), 'nope')).toBe(false);
  });
});
