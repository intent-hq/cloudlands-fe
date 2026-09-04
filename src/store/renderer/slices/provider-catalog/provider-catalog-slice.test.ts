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
  selectProviderAuthFailureGuidance,
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
    providerSettings: { enabledProviders },
    model: {
      defaultProviderId: extra.activeProviderId ?? '',
      providerModels: extra.providerModels ?? {},
    },
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

  it('selectEffectiveDefaultProviderId reads the settings-mirrored default provider', () => {
    // The default provider is the explicit `model.defaultProvider` mirror —
    // model-id prefixes never influence it (ids in the store are bare).
    expect(
      selectEffectiveDefaultProviderId.select(storeWith(hydrated, {}, { activeProviderId: 'pi' })),
    ).toBe('pi');
    // A stray legacy compound value in providerModels is inert here.
    expect(
      selectEffectiveDefaultProviderId.select(
        storeWith(
          hydrated,
          {},
          {
            activeProviderId: 'pi',
            providerModels: { pi: 'unsloth:some-model' },
          },
        ),
      ),
    ).toBe('pi');
    // Nothing configured → '' (honestly unresolved). The catalog never
    // fabricates a default: falling through to the first row would silently
    // reinstate the removed hardcoded auggie default.
    expect(selectEffectiveDefaultProviderId.select(storeWith(hydrated))).toBe('');
    // Before hydration with nothing configured → ''.
    expect(selectEffectiveDefaultProviderId.select(storeWith(initialState))).toBe('');
  });

  it('selectProviderCatalogEntry keys by id, undefined for unknown ids', () => {
    expect(selectProviderCatalogEntry.select(storeWith(hydrated), 'pi')?.command).toBe('pi-acp');
    expect(selectProviderCatalogEntry.select(storeWith(hydrated), 'nope')).toBeUndefined();
  });

  it('selectProviderCatalogEntryOrDefault falls back to the effective default row', () => {
    expect(selectProviderCatalogEntryOrDefault.select(storeWith(hydrated), 'unsloth')?.id).toBe(
      'unsloth',
    );
    // Nothing configured → no default row to fall back to (unresolved '').
    expect(selectProviderCatalogEntryOrDefault.select(storeWith(hydrated), 'nope')).toBeUndefined();
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

  it('selectProviderAuthFailureGuidance treats the legacy acp provider value as unset', () => {
    // 'acp' is the protocol name, not a provider id (mirrors getAgentProvider):
    // resolution must fall through to the compound-model prefix instead of
    // healing 'acp' to the default provider's row.
    const state = storeWith(hydrated, {}, { activeProviderId: 'auggie' });
    const viaModelPrefix = selectProviderAuthFailureGuidance.select(
      state,
      'acp',
      'pi:some-model',
      'authentication required',
    );
    // pi's row has no authErrorPatterns → no match; the default (auggie) row
    // WOULD match, so guidance must be null, not auggie's login command.
    expect(viaModelPrefix).toBeNull();
    // With no model either, 'acp' resolves like an unset provider (default row).
    expect(
      selectProviderAuthFailureGuidance.select(state, 'acp', null, 'authentication required'),
    ).toEqual({
      providerId: 'auggie',
      loginCommandHint: 'auggie login',
      showClaudeDesktopNote: false,
    });
    // An explicit real provider id still wins.
    expect(
      selectProviderAuthFailureGuidance.select(state, 'auggie', null, 'auggie login'),
    ).toMatchObject({ providerId: 'auggie' });
  });

  it('selectProviderEnabledFromCatalog resolves enabled state like resolveProviderEnabled', () => {
    // Providers default to disabled when unset — no default-provider exception.
    expect(selectProviderEnabledFromCatalog.select(storeWith(hydrated), 'auggie')).toBe(false);
    expect(selectProviderEnabledFromCatalog.select(storeWith(hydrated), 'pi')).toBe(false);
    // An explicit persisted entry always wins.
    expect(selectProviderEnabledFromCatalog.select(storeWith(hydrated, { pi: true }), 'pi')).toBe(
      true,
    );
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
