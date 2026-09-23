import type { AppClient, AppliedSettingChange, SettingDefinitionWithValue } from '../app-client';
import { backendRequest } from './backend-transport';
import { LiveServerClient } from './live-server-client';

/** Local device settings never use the remote window's settings cache or transport target. */
export const localMachineClient: {
  settings: Pick<AppClient['settings'], 'list' | 'update'>;
  server: AppClient['server'];
} = {
  settings: {
    async list() {
      const result = await backendRequest<{ settings: SettingDefinitionWithValue[] }>(
        'settings.list',
        undefined,
        { localMachine: true },
      );
      return result.settings;
    },
    async update(changes) {
      const result = await backendRequest<{ applied: AppliedSettingChange[] }>(
        'settings.update',
        { changes },
        { localMachine: true },
      );
      return result.applied;
    },
  },
  server: new LiveServerClient(true),
};
