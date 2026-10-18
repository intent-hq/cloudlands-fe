// Teardown restores model rows and user values through existing actions. Cache
// timestamps/check flags/epochs may advance; new cache keys are cleared on teardown.
import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';
import { mockInvoke, overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { setupModelPickerPreviewHandler } from '../../../../test/catalog-preview-ipc';
import {
  providerModelsLoaded,
  providerModelsCacheCleared,
} from '$store/renderer/slices/provider-models/provider-models-slice';
import {
  selectProviderModelsCacheMap,
  selectProviderModelsClearEpoch,
} from '$store/renderer/slices/provider-models/provider-models-selectors';
import {
  selectAvailableModels,
  selectAvailableModelsProviderId,
  selectModelPickerCollapsedGroups,
} from '$store/renderer/slices/model/model-selectors';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { modelReloadSaga } from '$store/renderer/slices/model/sagas/model-reload-saga';
import {
  hydrateDefaultProvider,
  setAvailableModels,
  setLoadingStateForProvider,
  setModelPickerGroupCollapsed,
} from '$store/renderer/slices/model/model-slice';
import { setupPreviewProviders } from '../../settings/provider-selector.preview';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { normalizeAgent } from '$lib/client/live/live-agents-client';
import { providerProfileSummaryStatusChanged } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { setProviderProfilesLabForPreview } from '../../../../test/provider-profiles-preview';
import ModelPickerPreview from './ModelPickerPreview.svelte';

const models = [
  {
    value: 'preview-balanced',
    label: 'Balanced',
    description: 'Balanced speed and capability',
    isDefault: true,
    effortLevels: ['low', 'medium', 'high'],
  },
  { value: 'preview-fast', label: 'Fast', description: 'Quick everyday tasks' },
  { value: 'preview-deep', label: 'Deep', description: 'Detailed analysis' },
];

const selectLoadingStates = appStore.createSelector((state) => state.model.loadingState);
let activeCleanup: (() => void) | undefined;

function setupModels(populated: boolean, degraded = false, diagnostic?: string) {
  return () => {
    activeCleanup?.();
    const previousLoading = selectLoadingStates.select(appStore.state);
    const previousCache = selectProviderModelsCacheMap.select(appStore.state);
    const previousModels = selectAvailableModels.select(appStore.state);
    const previousProvider = selectAvailableModelsProviderId.select(appStore.state);
    const previousDefault = selectEffectiveDefaultProviderId.select(appStore.state);
    const previousCollapsed = selectModelPickerCollapsedGroups.select(appStore.state);
    const restoreProviders = setupPreviewProviders();
    const bridge = typeof window === 'undefined' ? undefined : window.electronAPI;
    const originalInvoke = bridge?.invoke;
    if (bridge && originalInvoke) {
      // electronAPI.invoke takes precedence over the router in the UI-preview build.
      bridge.invoke = (channel, ...args) =>
        channel === 'codex:get-models' || channel === 'claude-code:get-models'
          ? mockInvoke(channel, ...args)
          : originalInvoke.call(bridge, channel, ...args);
    }
    appStore.dispatch(hydrateDefaultProvider('codex'));
    for (const group of previousCollapsed)
      appStore.dispatch(setModelPickerGroupCollapsed(group, false));
    const epoch = selectProviderModelsClearEpoch.select(appStore.state);
    const restoreModelHandlers: Array<() => void> = [];
    for (const providerId of ['codex', 'claude-code']) {
      const rows = populated
        ? models.map((model) => ({ ...model, value: `${providerId}-${model.value}` }))
        : [];
      restoreModelHandlers.push(setupModelPickerPreviewHandler(providerId, rows));
      appStore.dispatch(
        providerModelsLoaded(
          providerId,
          degraded || (diagnostic && providerId === 'codex')
            ? {
                models: [],
                warning: diagnostic ?? 'Temporary model catalog failure',
              }
            : { models: rows },
          epoch,
        ),
      );
      if (providerId === 'codex')
        appStore.dispatch(setAvailableModels(degraded ? [] : rows, providerId));
    }
    const cancelCatalog = appStore.runSaga(modelReloadSaga);
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      if (activeCleanup === cleanup) activeCleanup = undefined;
      cancelCatalog();
      if (bridge && originalInvoke) bridge.invoke = originalInvoke;
      for (const restoreHandler of restoreModelHandlers) restoreHandler();
      appStore.dispatch(providerModelsCacheCleared());
      const restoreEpoch = selectProviderModelsClearEpoch.select(appStore.state);
      for (const [providerId, entry] of Object.entries(previousCache))
        appStore.dispatch(providerModelsLoaded(providerId, entry, restoreEpoch));
      appStore.dispatch(setAvailableModels(previousModels, previousProvider));
      for (const group of selectModelPickerCollapsedGroups.select(appStore.state))
        appStore.dispatch(setModelPickerGroupCollapsed(group, false));
      for (const group of previousCollapsed)
        appStore.dispatch(setModelPickerGroupCollapsed(group, true));
      restoreProviders();
      appStore.dispatch(hydrateDefaultProvider(previousDefault));
      for (const providerId of ['codex', 'claude-code']) {
        appStore.dispatch(
          setLoadingStateForProvider({
            providerId,
            ...(previousLoading[providerId] ?? { status: 'success' }),
          }),
        );
      }
    };
    activeCleanup = cleanup;
    return cleanup;
  };
}

// Named provider profiles (§5.54): two Codex profiles and one Claude Code
// profile, each with its own catalog under its provider reference.
const previewProfiles = [
  {
    id: 'pwork00000001',
    providerRef: 'codex@pwork00000001',
    baseProviderId: 'codex',
    name: 'Work',
  },
  {
    id: 'ppers00000001',
    providerRef: 'codex@ppers00000001',
    baseProviderId: 'codex',
    name: 'Personal',
  },
  {
    id: 'pclwk0000001',
    providerRef: 'claude-code@pclwk0000001',
    baseProviderId: 'claude-code',
    name: 'Client A',
  },
];
const PROFILE_AGENT_ID = 'preview-profile-agent';

function setupProfiles(
  agent?: Record<string, unknown>,
  signedOut: string[] = [],
  labsEnabled = true,
) {
  return () => {
    const cleanupModels = setupModels(true)();
    const restoreLab = setProviderProfilesLabForPreview(labsEnabled);
    const rows = selectProviderCatalogEntries.select(appStore.state);
    appStore.dispatch(
      providerCatalogLoaded({
        providers: rows.map((row) =>
          row.id === 'codex' || row.id === 'claude-code' ? { ...row, supportsProfiles: true } : row,
        ),
        profiles: previewProfiles,
      }),
    );
    const epoch = selectProviderModelsClearEpoch.select(appStore.state);
    const rowsFor = (providerId: string) => {
      const prefix = previewProfiles.find((p) => p.providerRef === providerId)?.id ?? providerId;
      return models.map((model) => ({ ...model, value: `${prefix}-${model.value}` }));
    };
    // Profiles are listed through their base provider's channel (`providerRef`).
    const restoreHandlers = ['codex', 'claude-code'].map((base) =>
      overrideMockIpcHandler(`${base}:get-models`, (data?: unknown) => ({
        success: true,
        data: rowsFor((data as { providerRef?: string } | undefined)?.providerRef ?? base),
      })),
    );
    for (const profile of previewProfiles) {
      appStore.dispatch(
        providerModelsLoaded(profile.providerRef, { models: rowsFor(profile.providerRef) }, epoch),
      );
    }
    for (const profileId of signedOut)
      appStore.dispatch(providerProfileSummaryStatusChanged(profileId, 'error'));
    if (agent) {
      appStore.dispatch(
        bulkUpsertSessions(
          [
            normalizeAgent({
              id: PROFILE_AGENT_ID,
              workspaceId: 'preview-workspace',
              name: 'Preview agent',
              status: 'idle',
              ...agent,
            }),
          ],
          { preserveExplicitRuntimeFlags: false },
        ),
      );
    }
    return () => {
      for (const profileId of signedOut)
        appStore.dispatch(providerProfileSummaryStatusChanged(profileId, 'configured'));
      if (agent) appStore.dispatch(removeSession(PROFILE_AGENT_ID));
      for (const restore of restoreHandlers) restore();
      restoreLab();
      cleanupModels();
    };
  };
}

export const preview = definePreview<ComponentProps<typeof ModelPickerPreview>>({
  id: 'model-picker',
  title: 'Model picker',
  defaultState: 'populated',
  states: {
    populated: {
      props: {
        selectedModel: null,
        defaultModelId: 'codex-preview-balanced',
        defaultOptionLabel: m.chat_modelPicker_providerDefault_label(),
        defaultOptionDescription: m.settings_backgroundAgent_providerDefault_description(),
        showDefaultOption: true,
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupModels(true),
    },
    open: {
      props: {
        initialOpen: true,
        selectedModel: null,
        defaultModelId: 'codex-preview-balanced',
        showDefaultOption: true,
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupModels(true),
    },
    reasoning: {
      props: {
        initialOpen: true,
        selectedModel: 'codex-preview-balanced',
        showReasoning: true,
        reasoningEffort: 'medium',
        onReasoningChange: () => true,
        updateGlobalStore: false,
        updateGlobalDefault: false,
      },
      setup: setupModels(true),
    },
    recovery: {
      props: {
        initialOpen: true,
        selectedModel: 'codex-preview-balanced',
        agentId: 'preview-recovery-agent',
        showReasoning: true,
        reasoningEffort: 'high',
        onReasoningChange: () => true,
        showDefaultOption: false,
        updateGlobalStore: false,
        updateGlobalDefault: false,
      },
      setup: setupModels(true, true),
    },
    'adapter-error': {
      props: {
        initialOpen: true,
        captureMenu: true,
        portal: false,
        collisionBoundary: 'body',
        providerId: 'codex',
        selectedModel: null,
        showDefaultOption: false,
        silentFallback: false,
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupModels(
        true,
        false,
        [
          'codex adapter exited before reporting models: exit status: 254',
          'npm error code ENOENT',
          'npm error syscall open',
          'npm error path /Users/clement/.npm/_npx/39d488c67d3fe4d0/package.json',
          `npm error enoent Could not read package.json: ${'/Users/clement/workspaces/very-long-project-path/'.repeat(12)}package.json`,
          'npm error enoent This is related to npm not being able to find a file.',
          'npm error A complete log of this run can be found in: /Users/clement/.npm/_logs/2026-10-04T23_21_43_314Z-debug-0.log',
        ].join('\n'),
      ),
    },
    'profiles-open': {
      props: {
        initialOpen: true,
        captureMenu: true,
        portal: false,
        collisionBoundary: 'body',
        selectedModel: 'pwork00000001-preview-balanced',
        providerId: 'codex@pwork00000001',
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupProfiles(),
    },
    // Settings → Labs → Provider profiles off: no profile tabs or groups, but
    // the selection that already uses the Work profile keeps its label.
    'profiles-labs-off-open': {
      props: {
        initialOpen: true,
        captureMenu: true,
        portal: false,
        collisionBoundary: 'body',
        selectedModel: 'pwork00000001-preview-balanced',
        providerId: 'codex@pwork00000001',
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupProfiles(undefined, [], false),
    },
    'profile-signed-out': {
      props: {
        initialOpen: true,
        captureMenu: true,
        portal: false,
        collisionBoundary: 'body',
        selectedModel: 'pwork00000001-preview-balanced',
        providerId: 'codex@pwork00000001',
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupProfiles(undefined, ['pwork00000001']),
    },
    'profile-selected': {
      props: {
        selectedModel: 'pwork00000001-preview-balanced',
        providerId: 'codex@pwork00000001',
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupProfiles(),
    },
    'profile-default-selected': {
      props: {
        selectedModel: 'codex-preview-balanced',
        providerId: 'codex',
        variant: 'outline',
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupProfiles(),
    },
    'profile-earlier-settings': {
      props: {
        initialOpen: true,
        captureMenu: true,
        portal: false,
        collisionBoundary: 'body',
        agentId: PROFILE_AGENT_ID,
        selectedModel: 'pwork00000001-preview-balanced',
        providerId: 'codex@pwork00000001',
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupProfiles({
        provider: 'codex@pwork00000001',
        model: 'pwork00000001-preview-balanced',
        usingEarlierProfileSettings: true,
      }),
    },
    'profile-replacement': {
      props: {
        initialOpen: true,
        captureMenu: true,
        portal: false,
        collisionBoundary: 'body',
        agentId: PROFILE_AGENT_ID,
        selectedModel: 'premoved00001-preview-balanced',
        providerId: 'codex@premoved00001',
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupProfiles({
        provider: 'codex@premoved00001',
        model: 'premoved00001-preview-balanced',
        providerReplacementRequired: {
          providerRef: 'codex@premoved00001',
          reason: 'profile-missing',
        },
      }),
    },
    // Open the “Default model” trigger to reveal the empty state and Retry button.
    // No search is needed: both available providers return an empty model catalog.
    empty: {
      props: {
        selectedModel: null,
        showDefaultOption: false,
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupModels(false),
    },
  },
});

export default ModelPickerPreview;
