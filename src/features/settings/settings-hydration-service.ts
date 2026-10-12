import type { AppliedSettingChange } from '$lib/client/settings-types';
import { store as appStore } from '$store/renderer/store';
import { createSettingsHydrator } from './settings-hydrator';
import {
  setDisabledServers,
  setEnabled as setMcpEnabled,
  setServers as setMcpServers,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import type { McpServerConfig } from '$store/renderer/slices/mcp-settings/mcp-settings-types';
import { setDefaultSpecialistId } from '$store/renderer/slices/specialists/specialists-slice';
import { hydrateNotificationVolume } from '$store/renderer/slices/user-preferences/user-preferences-slice';
export { BG_MODEL_MIGRATION_MARKER_KEY } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';

function applyOther({ path, value }: AppliedSettingChange, revision?: number) {
  switch (path) {
    case 'notifications.volume': {
      if (typeof value === 'number') appStore.dispatch(hydrateNotificationVolume(value, revision));
      return;
    }
    case 'mcp.servers': {
      if (Array.isArray(value)) {
        appStore.dispatch(setMcpServers(value as McpServerConfig[]));
      }
      return;
    }
    case 'mcp.disabledServers': {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        appStore.dispatch(setDisabledServers(value as Record<string, true>));
      }
      return;
    }
    case 'mcp.enableUserServers': {
      if (typeof value === 'boolean') appStore.dispatch(setMcpEnabled(value));
      return;
    }
    case 'specialists.default': {
      // The daemon setting is Option<String>: null/unset clears the default.
      if (typeof value === 'string') {
        appStore.dispatch(setDefaultSpecialistId(value.trim()));
      } else if (value === null) {
        appStore.dispatch(setDefaultSpecialistId(''));
      }
      return;
    }
  }
}
// Svelte compatibility composition; remove at the renderer cutover.
export const applySettingsChanges = createSettingsHydrator({
  dispatch: (action) => appStore.dispatch(action),
  getState: () => appStore.state,
  applyOther,
});
