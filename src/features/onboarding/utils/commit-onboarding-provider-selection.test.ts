import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerSettingsSaga } from '$store/renderer/slices/provider-settings/sagas/provider-settings-saga';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});
const stops: (() => void)[] = [];
let dispose: (() => void) | undefined;
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  dispose?.();
  vi.resetAllMocks();
});
import { backendRequest } from '$lib/client/live/backend-transport';
import type { AppSettingChange } from '$lib/client/app-client';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { store } from '$store/renderer/store';
import {
  checkSingleProviderRequested,
  checkSingleProviderSuccess,
} from '$store/renderer/slices/agent-availability/agent-availability-slice';
import { reloadModelsForProvider } from '$store/renderer/slices/model/model-slice';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import {
  setActiveProvider,
  setProviderEnabled,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
  selectIsProviderEnabled,
} from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';
import { commitOnboardingProviderSelection } from './commit-onboarding-provider-selection';
import { resolveOnboardingSelectedProvider } from './resolve-onboarding-selected-provider';

describe('commitOnboardingProviderSelection', () => {
  it('does not commit a detected-only Antigravity provider, but commits its card click', () => {
    const dispatch = vi.fn();
    const selectedProviderId = resolveOnboardingSelectedProvider({
      activeProviderId: '',
      defaultProviderId: '',
      readyProviderIds: ['antigravity'],
    });
    expect(
      commitOnboardingProviderSelection({ selectedProviderId, activeProviderId: '', dispatch }),
    ).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
    expect(
      commitOnboardingProviderSelection({
        selectedProviderId: 'antigravity',
        activeProviderId: '',
        recommitActive: true,
        dispatch,
      }),
    ).toBe('antigravity');
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setProviderEnabled({ providerId: 'antigravity', enabled: true }),
      setActiveProvider('antigravity'),
      reloadModelsForProvider(),
    ]);
  });
  it('dispatches the card-click sequence when the selection is not active', () => {
    const dispatch = vi.fn();
    const committed = commitOnboardingProviderSelection({
      selectedProviderId: 'claude-code',
      activeProviderId: '',
      dispatch,
    });
    expect(committed).toBe('claude-code');
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setProviderEnabled({ providerId: 'claude-code', enabled: true }),
      setActiveProvider('claude-code'),
      reloadModelsForProvider(),
    ]);
  });

  it('dispatches nothing when no provider is ready', () => {
    const dispatch = vi.fn();
    expect(
      commitOnboardingProviderSelection({
        selectedProviderId: undefined,
        activeProviderId: '',
        dispatch,
      }),
    ).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not double-dispatch when the selection is already the active provider', () => {
    const dispatch = vi.fn();
    expect(
      commitOnboardingProviderSelection({
        selectedProviderId: 'claude-code',
        activeProviderId: 'claude-code',
        dispatch,
      }),
    ).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('re-commits an already-active selection when recommitActive is set (card-click path)', () => {
    const dispatch = vi.fn();
    const committed = commitOnboardingProviderSelection({
      selectedProviderId: 'claude-code',
      activeProviderId: 'claude-code',
      recommitActive: true,
      dispatch,
    });
    expect(committed).toBe('claude-code');
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setProviderEnabled({ providerId: 'claude-code', enabled: true }),
      setActiveProvider('claude-code'),
      reloadModelsForProvider(),
    ]);
  });
});

describe('no-click welcome-step advance regression (empty enabled set on step 4)', () => {
  // Fresh install: empty enabledProviders, no activeProviderId, exactly one
  // ready provider. The user never clicks a card and advances via the
  // button / ⌘↵ — the commit must leave the resolved provider enabled +
  // active so ModelPicker's availability gate sees a non-empty set.
  it('enables and activates the resolved provider on an explicit advance', async () => {
    dispose = store.init();
    store.dispatch(providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
    store.dispatch(checkSingleProviderRequested('claude-code'));
    store.dispatch(
      checkSingleProviderSuccess('claude-code', { available: true, authenticated: true }, 1),
    );
    const persisted: Record<string, AppSettingChange['value']> = {
      'model.defaultProvider': null,
      'model.providerDefaults': {},
      'model.defaultReasoningEffort': null,
      'providers.enabled': {},
      'quickActions.defaultModel': null,
      'quickActions.typeOverrides': {},
      'quickActions.defaultReasoningEffort': null,
      'quickActions.typeReasoningEffortOverrides': {},
      'quickActions.providerSettings': {},
    };
    let revision = 1;
    const request = vi.mocked(backendRequest);
    request.mockImplementation(async (method, params) => {
      if (method === 'settings.list') {
        expect(params).toBeUndefined();
        return {
          settings: Object.entries(persisted).map(([path, value]) => ({
            path,
            value: structuredClone(value),
          })),
          revision,
        };
      }
      expect(method).toBe('settings.update');
      const { changes } = params as { changes: AppSettingChange[] };
      expect(params).toEqual({ changes });
      for (const { path, value } of changes) persisted[path] = structuredClone(value);
      return { applied: structuredClone(changes), revision: ++revision };
    });
    const buildState = () => store.state;

    // Precondition: fresh install — nothing active, nothing enabled.
    let state = buildState();
    expect(selectActiveProviderId.select(state)).toBe('');
    expect(selectAvailableEnabledProviderIds.select(state)).toEqual([]);

    // The grid's resolved selection for a single ready provider.
    const selectedProviderId = resolveOnboardingSelectedProvider({
      activeProviderId: selectActiveProviderId.select(state),
      defaultProviderId: selectEffectiveDefaultProviderId.select(state),
      readyProviderIds: ['claude-code'],
    });
    expect(selectedProviderId).toBe('claude-code');

    // Advance (button or ⌘↵ — both call the same commit path).
    const apply = (action: { type: string }) => store.dispatch(action);
    stops.push(store.runSaga(providerSettingsSaga));
    const committed = commitOnboardingProviderSelection({
      selectedProviderId,
      activeProviderId: selectActiveProviderId.select(state),
      dispatch: apply,
    });
    expect(committed).toBe('claude-code');
    expect(selectActiveProviderId.select(buildState())).toBe('');

    await vi.waitFor(() => expect(persisted['model.defaultProvider']).toBe('claude-code'));
    expect(request.mock.calls).toEqual([
      [
        'settings.update',
        { changes: [{ path: 'providers.enabled', value: { 'claude-code': true } }] },
      ],
      ['settings.list'],
      [
        'settings.update',
        {
          changes: [
            { path: 'model.defaultProvider', value: 'claude-code' },
            { path: 'quickActions.defaultModel', value: '' },
            {
              path: 'quickActions.typeOverrides',
              value: { commit: '', pr: '', review: '', fast: '' },
            },
            { path: 'quickActions.defaultReasoningEffort', value: '' },
            { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
            { path: 'quickActions.providerSettings', value: {} },
          ],
        },
      ],
    ]);
    expect(selectActiveProviderId.select(buildState())).toBe('');

    // Only the independent daemon receipt, not the write acknowledgement, activates it.
    applySettingsChanges(
      Object.entries(persisted).map(([path, value]) => ({ path, value })),
      revision,
    );

    state = buildState();
    expect(selectActiveProviderId.select(state)).toBe('claude-code');
    expect(selectIsProviderEnabled.select(state, 'claude-code')).toBe(true);
    expect(selectAvailableEnabledProviderIds.select(state)).toContain('claude-code');

    // A second advance (or a card click already committed) is a no-op: the
    // selection now resolves to the active provider.
    const secondCommit = commitOnboardingProviderSelection({
      selectedProviderId: resolveOnboardingSelectedProvider({
        activeProviderId: selectActiveProviderId.select(state),
        defaultProviderId: selectEffectiveDefaultProviderId.select(state),
        readyProviderIds: ['claude-code'],
      }),
      activeProviderId: selectActiveProviderId.select(state),
      dispatch: apply,
    });
    expect(secondCommit).toBeUndefined();
    expect(selectActiveProviderId.select(buildState())).toBe('claude-code');
  });
});
