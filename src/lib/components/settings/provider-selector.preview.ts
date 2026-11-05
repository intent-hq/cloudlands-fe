// Success actions restore visible values; loaded/check flags and epochs may remain.
// Newly introduced availability keys settle to unavailable because no remove action exists.
import { setupProviderFastModePreview } from '../../../test/provider-fast-mode-preview';
import { setupProviderProfilesPreview } from '../../../test/provider-profiles-preview';
import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { store as appStore } from '$store/renderer/store';
import { setupProviderSelectorPreviewHandlers } from '../../../test/catalog-preview-ipc';
import type {
  ProviderAvailabilityResult,
  ProviderStatus,
} from '$shared/types/provider-availability';
import { m } from '$shared/paraglide/messages.js';
import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
import {
  selectEffectiveDefaultProviderId,
  selectProviderCatalogEntries,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import {
  selectProviderStatusMap,
  selectProviderLoadingMap,
} from '$store/renderer/slices/agent-availability/agent-availability-selectors';
import {
  checkSingleProviderSuccess,
  checkAllProvidersComplete,
  setAllProvidersLoading,
} from '$store/renderer/slices/agent-availability/agent-availability-slice';
import { selectEnabledProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { loadEnabledProvidersFromStorage } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import ProviderSelector from './ProviderSelector.svelte';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { setFileSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
import { setLabsCursorProviderEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { MOCK_CURSOR_PROVIDER } from '../../../test/fixtures/provider-catalog.fixture';

export const previewProviders = [
  {
    id: 'codex',
    supportsFastMode: true,
    displayName: 'Codex',
    shortName: 'Codex',
    command: 'codex',
    canBeDisabled: true,
    visible: true,
  },
  {
    id: 'claude-code',
    supportsFastMode: true,
    displayName: 'Claude Code',
    shortName: 'Claude',
    command: 'claude',
    canBeDisabled: true,
    visible: true,
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    shortName: 'OpenCode',
    command: 'opencode',
    canBeDisabled: true,
    visible: true,
  },
];

export function setupPreviewProviders() {
  const defaultProvider = selectEffectiveDefaultProviderId.select(appStore.state);
  const catalog = selectProviderCatalogEntries.select(appStore.state);
  const statuses = selectProviderStatusMap.select(appStore.state);
  const loading = selectProviderLoadingMap.select(appStore.state);
  const enabled = selectEnabledProviders.select(appStore.state);
  appStore.dispatch(providerCatalogLoaded({ providers: previewProviders }));
  appStore.dispatch(hydrateDefaultProvider('codex'));
  appStore.dispatch(
    loadEnabledProvidersFromStorage({ codex: true, 'claude-code': true, opencode: false }),
  );
  for (const { id } of previewProviders) {
    appStore.dispatch(
      checkSingleProviderSuccess(id, {
        available: id !== 'opencode',
        authenticated: id !== 'opencode',
      }),
    );
  }
  appStore.dispatch(checkAllProvidersComplete());
  return () => {
    appStore.dispatch(providerCatalogLoaded({ providers: catalog }));
    appStore.dispatch(hydrateDefaultProvider(defaultProvider));
    appStore.dispatch(loadEnabledProvidersFromStorage(enabled));
    for (const { id } of previewProviders) {
      appStore.dispatch(checkSingleProviderSuccess(id, statuses[id] ?? { available: false }));
    }
    appStore.dispatch(setAllProvidersLoading(loading));
  };
}

function setupProviderSelector() {
  const restoreProviders = setupPreviewProviders();
  const unavailable = { available: false };
  const availability: ProviderAvailabilityResult = {
    hasAnyProvider: true,
    hiddenProviders: [],
    providers: {
      codex: { available: true, authenticated: true },
      claudeCode: { available: true, authenticated: true },
      auggie: unavailable,
      cortex: unavailable,
      mock: unavailable,
      opencode: unavailable,
      pi: unavailable,
      droid: unavailable,
      grok: unavailable,
      unsloth: unavailable,
    },
  };
  const restoreHandlers = setupProviderSelectorPreviewHandlers(availability);
  return () => {
    restoreHandlers();
    restoreProviders();
  };
}

export function setupProviderDisablePreview(
  status: 'signed-out' | 'pending' | 'unavailable' = 'signed-out',
  auggieEnabled = true,
) {
  const restoreProviders = setupProviderSelector();
  const specialists = getItems(appStore.state.specialists.fileSpecialists);
  const auggie = {
    id: 'auggie',
    displayName: 'Augment Auggie',
    shortName: 'Auggie',
    command: 'auggie',
    canBeDisabled: true,
    visible: true,
    loginCommandHint: 'auggie login',
    loginDocsUrl: 'https://docs.augmentcode.com/cli/overview',
  };
  appStore.dispatch(providerCatalogLoaded({ providers: [...previewProviders, auggie] }));
  appStore.dispatch(
    loadEnabledProvidersFromStorage({ codex: true, 'claude-code': true, auggie: auggieEnabled }),
  );
  if (status !== 'pending')
    appStore.dispatch(
      checkSingleProviderSuccess('auggie', {
        available: status !== 'unavailable',
        authenticated: false,
      }),
    );
  appStore.dispatch(
    setFileSpecialists([
      {
        id: 'pinned-provider',
        name: 'Pinned specialist',
        description: '',
        codingAgent: 'auggie',
        model: '',
        behaviorPrompt: '',
        filePath: '/fixture/specialists/pinned.md',
        source: 'user',
      },
    ]),
  );
  return () => {
    appStore.dispatch(setFileSpecialists(specialists));
    restoreProviders();
  };
}

const CURSOR_PREVIEW_VERSION = '2026.11.05-86047df';
const GROK_HOST_REASON =
  'cursor-agent runs the Grok agent host (grok-agent 1.4.2), not the Cursor CLI. Run "cursor-agent update --channel cursor" to switch back, or set providers.paths.cursor to the Cursor install under ~/.local/share/cursor-agent/versions/.';

/** Mocked Cursor status, shaped like the provider status seeder's discovery mapping. */
export function cursorPreviewStatus(
  status: 'signed-in' | 'signed-out' | 'not-installed' | 'unsupported',
): ProviderStatus {
  switch (status) {
    case 'not-installed':
      return { available: false };
    case 'unsupported':
      return {
        available: false,
        version: 'grok-agent 1.4.2',
        unavailableReason: GROK_HOST_REASON,
        warning: m.settings_providers_cursorUnsupported_warning({ reason: GROK_HOST_REASON }),
      };
    default:
      return {
        available: true,
        authenticated: status === 'signed-in',
        version: CURSOR_PREVIEW_VERSION,
      };
  }
}

/** Cursor lab on with a mocked catalog row; `enabled` puts the row under Enabled. */
export function setupCursorProviderPreview(
  status: 'signed-in' | 'signed-out' | 'not-installed' | 'unsupported',
  { lab = true, enabled = false }: { lab?: boolean; enabled?: boolean } = {},
) {
  const restoreProviders = setupProviderSelector();
  const previousLab = appStore.state.userPreferences.labsCursorProviderEnabled;
  const previousStatus = selectProviderStatusMap.select(appStore.state).cursor;
  appStore.dispatch(setLabsCursorProviderEnabled(lab));
  appStore.dispatch(
    providerCatalogLoaded({ providers: [...previewProviders, MOCK_CURSOR_PROVIDER] }),
  );
  appStore.dispatch(
    loadEnabledProvidersFromStorage({
      codex: true,
      'claude-code': true,
      opencode: false,
      cursor: enabled,
    }),
  );
  appStore.dispatch(checkSingleProviderSuccess('cursor', cursorPreviewStatus(status)));
  return () => {
    appStore.dispatch(checkSingleProviderSuccess('cursor', previousStatus ?? { available: false }));
    appStore.dispatch(setLabsCursorProviderEnabled(previousLab));
    restoreProviders();
  };
}

export const preview = definePreview<ComponentProps<typeof ProviderSelector>>({
  id: 'provider-selector',
  title: 'Provider selector',
  defaultState: 'mixed',
  states: {
    'disable-in-use': { props: {}, setup: () => setupProviderDisablePreview() },
    'auggie-not-installed': {
      props: {},
      setup: () => setupProviderDisablePreview('unavailable', false),
    },
    mixed: { props: {}, setup: setupProviderSelector },
    // Cursor rows exist only while Cmd+K > Enable experimental Cursor provider is on.
    'cursor-signed-in': { props: {}, setup: () => setupCursorProviderPreview('signed-in') },
    'cursor-signed-out': { props: {}, setup: () => setupCursorProviderPreview('signed-out') },
    'cursor-not-installed': {
      props: {},
      setup: () => setupCursorProviderPreview('not-installed'),
    },
    // cursor-agent on the Grok agent host: the daemon's reason replaces Install.
    'cursor-unsupported': { props: {}, setup: () => setupCursorProviderPreview('unsupported') },
    // Lab off never hides an enabled Cursor: the row keeps its Disable action.
    'cursor-enabled-lab-off': {
      props: {},
      setup: () => setupCursorProviderPreview('signed-in', { lab: false, enabled: true }),
    },
    profiles: {
      props: {},
      setup: () => {
        const restoreProviders = setupProviderSelector();
        const restoreProfiles = setupProviderProfilesPreview({ appOwned: true });
        return () => {
          restoreProfiles();
          restoreProviders();
        };
      },
    },
    // Backup profiles: reorder with drag or arrow keys on the handle; backups carry a badge.
    'profiles-backup': {
      props: {},
      setup: () => {
        const restoreProviders = setupProviderSelector();
        const restoreProfiles = setupProviderProfilesPreview({
          appOwned: true,
          withBackups: true,
        });
        return () => {
          restoreProfiles();
          restoreProviders();
        };
      },
    },
    // The Default configuration renamed: its pinned first row shows the name plus a Default pill.
    'profiles-renamed-default': {
      props: {},
      setup: () => {
        const restoreProviders = setupProviderSelector();
        const restoreProfiles = setupProviderProfilesPreview({
          appOwned: true,
          withBackups: true,
          defaultNames: { codex: 'Main account' },
        });
        return () => {
          restoreProfiles();
          restoreProviders();
        };
      },
    },
    'profiles-remote': {
      props: {},
      setup: () => {
        const restoreProviders = setupProviderSelector();
        const restoreProfiles = setupProviderProfilesPreview({ appOwned: false });
        return () => {
          restoreProfiles();
          restoreProviders();
        };
      },
    },
    // Each named profile has its own Fast mode / service tier (off unless set).
    'profiles-fast-mode': {
      props: {},
      setup: () => {
        const restoreProviders = setupProviderSelector();
        const restoreProfiles = setupProviderProfilesPreview({ appOwned: true });
        const restoreFastMode = setupProviderFastModePreview(true, false, undefined, {
          codex: true,
          'claude-code': false,
          'claude-code@pproxy0000001': true,
        });
        return () => {
          restoreFastMode();
          restoreProfiles();
          restoreProviders();
        };
      },
    },
    'fast-mode': {
      props: {},
      setup: () => {
        const restoreProviders = setupProviderSelector();
        const restoreFastMode = setupProviderFastModePreview();
        return () => {
          restoreFastMode();
          restoreProviders();
        };
      },
    },
  },
});

export default ProviderSelector;
