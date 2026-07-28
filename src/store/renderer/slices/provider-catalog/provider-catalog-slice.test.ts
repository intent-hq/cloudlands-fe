/**
 * Provider Catalog reducer + selector tests.
 *
 * Pins the §5.38 ingest contract: rows stored verbatim (no healing), the
 * daemon's registry order preserved, lookups keyed by id, the
 * getProviderConfig-style default fallback, tier lookups without
 * cross-provider fallback, and enabled-state resolution against the
 * providerSettings persisted map.
 */
import { describe, expect, it } from 'vitest';
import type { ProviderCatalogResult } from '$shared/provider-catalog';
import type { StoreState } from '../../types';
import {
  selectAllCatalogProviderIds,
  selectCatalogDefaultProviderId,
  selectDefaultModelForProviderTier,
  selectProviderCatalogEntries,
  selectProviderCatalogEntry,
  selectProviderCatalogEntryOrDefault,
  selectProviderCatalogLoaded,
  selectProviderEnabledFromCatalog,
  selectProviderModelTiers,
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
      isDefault: true,
      canBeDisabled: true,
      loginCommandHint: 'auggie login',
      authErrorPatterns: ['authentication required', 'auggie login'],
      visible: true,
      modelTiers: { fast: 'haiku4.5', balanced: 'sonnet4.5', smart: 'opus4.7' },
    },
    {
      id: 'unsloth',
      displayName: 'Unsloth',
      shortName: 'Unsloth',
      command: 'opencode',
      isDefault: false,
      canBeDisabled: true,
      loginDocsUrl: 'https://docs.unsloth.ai',
      visible: true,
    },
    {
      id: 'pi',
      displayName: 'Pi',
      shortName: 'Pi',
      command: 'pi-acp',
      isDefault: false,
      canBeDisabled: true,
      loginDocsUrl: 'https://pi.dev/docs/latest/quickstart',
      visible: true,
    },
    {
      id: 'mock',
      displayName: 'Mock (E2E)',
      shortName: 'Mock',
      command: 'node',
      isDefault: false,
      canBeDisabled: true,
      requiresEnvVar: 'MOCK_AGENT_SCRIPT_PATH',
      visible: false,
    },
  ],
  defaultProviderId: 'auggie',
};

function storeWith(
  providerCatalog: ProviderCatalogState,
  enabledProviders: Record<string, boolean> = {},
): StoreState {
  return { providerCatalog, providerSettings: { enabledProviders } } as unknown as StoreState;
}

const hydrated = providerCatalogReducer(initialState, providerCatalogLoaded(CATALOG));

describe('providerCatalogReducer', () => {
  it('starts empty and not loaded', () => {
    const state = providerCatalogReducer(undefined, { type: '@@INIT' });
    expect(state.providers.ids).toEqual([]);
    expect(state.defaultProviderId).toBe('');
    expect(state.loaded).toBe(false);
  });

  it('providerCatalogLoaded stores rows verbatim in registry order and flips loaded', () => {
    expect(hydrated.loaded).toBe(true);
    expect(hydrated.defaultProviderId).toBe('auggie');
    // Registry order — unsloth precedes pi; NOT the old hardcoded array order.
    expect(hydrated.providers.ids).toEqual(['auggie', 'unsloth', 'pi', 'mock']);
    // Rows land exactly as sent — gated-off rows and optional fields included.
    expect(hydrated.providers.map['mock']).toEqual(CATALOG.providers[3]);
    expect(hydrated.providers.map['auggie']).toEqual(CATALOG.providers[0]);
  });

  it('a later providerCatalogLoaded replaces the whole catalog atomically', () => {
    const next: ProviderCatalogResult = {
      providers: [CATALOG.providers[1]],
      defaultProviderId: 'unsloth',
    };
    const state = providerCatalogReducer(hydrated, providerCatalogLoaded(next));
    expect(state.providers.ids).toEqual(['unsloth']);
    expect(state.defaultProviderId).toBe('unsloth');
    expect(state.providers.map['auggie']).toBeUndefined();
  });
});

describe('provider-catalog selectors', () => {
  it('exposes loaded / entries / ids / default id', () => {
    expect(selectProviderCatalogLoaded.select(storeWith(initialState))).toBe(false);
    expect(selectProviderCatalogLoaded.select(storeWith(hydrated))).toBe(true);
    expect(selectProviderCatalogEntries.select(storeWith(hydrated))).toEqual(CATALOG.providers);
    expect(selectAllCatalogProviderIds.select(storeWith(hydrated))).toEqual([
      'auggie',
      'unsloth',
      'pi',
      'mock',
    ]);
    expect(selectCatalogDefaultProviderId.select(storeWith(hydrated))).toBe('auggie');
  });

  it('selectProviderCatalogEntry keys by id, undefined for unknown ids', () => {
    expect(selectProviderCatalogEntry.select(storeWith(hydrated), 'pi')?.command).toBe('pi-acp');
    expect(selectProviderCatalogEntry.select(storeWith(hydrated), 'nope')).toBeUndefined();
  });

  it('selectProviderCatalogEntryOrDefault falls back to the default provider row', () => {
    expect(selectProviderCatalogEntryOrDefault.select(storeWith(hydrated), 'unsloth')?.id).toBe(
      'unsloth',
    );
    expect(selectProviderCatalogEntryOrDefault.select(storeWith(hydrated), 'nope')?.id).toBe(
      'auggie',
    );
    // Before hydration there is no default row to fall back to.
    expect(
      selectProviderCatalogEntryOrDefault.select(storeWith(initialState), 'auggie'),
    ).toBeUndefined();
  });

  it('tier lookups return the static table without cross-provider fallback', () => {
    expect(selectProviderModelTiers.select(storeWith(hydrated), 'auggie')).toEqual({
      fast: 'haiku4.5',
      balanced: 'sonnet4.5',
      smart: 'opus4.7',
    });
    // Dynamic-model provider (§5.38: modelTiers omitted) — no auggie fallback.
    expect(selectProviderModelTiers.select(storeWith(hydrated), 'unsloth')).toBeUndefined();
    expect(selectDefaultModelForProviderTier.select(storeWith(hydrated), 'auggie', 'smart')).toBe(
      'opus4.7',
    );
    expect(
      selectDefaultModelForProviderTier.select(storeWith(hydrated), 'pi', 'fast'),
    ).toBeUndefined();
  });

  it('selectProviderEnabledFromCatalog resolves enabled state like resolveProviderEnabled', () => {
    // Default provider is enabled when unset; others default to disabled.
    expect(selectProviderEnabledFromCatalog.select(storeWith(hydrated), 'auggie')).toBe(true);
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
        defaultProviderId: 'auggie',
      }),
    );
    expect(
      selectProviderEnabledFromCatalog.select(storeWith(withLocked, { auggie: false }), 'auggie'),
    ).toBe(true);
  });
});
