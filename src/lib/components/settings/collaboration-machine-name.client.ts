import { backendRequest } from '$lib/client/live/backend-transport';
import {
  collaborationMachineName,
  normalizeCollaborationMachineName,
} from '$shared/collaboration-machine-name';

/** Narrow host-owned setting; collaborators never need access to the settings catalog. */
export const collaborationMachineNameClient = {
  async read(): Promise<{ name: string; fallback: string }> {
    const [setting, status] = await Promise.all([
      backendRequest<{ value?: unknown }>('settings.get', { path: 'sharing.machineName' }),
      backendRequest<Record<string, unknown>>('system.status'),
    ]);
    if (typeof setting?.value !== 'string') throw new Error('Machine name unavailable');
    return {
      name: setting.value,
      fallback: collaborationMachineName({ ...status, collaborationName: null }) ?? '',
    };
  },
  async save(name: string): Promise<string> {
    const value = normalizeCollaborationMachineName(name);
    const result = await backendRequest<{ applied?: Array<{ path: string; value: unknown }> }>(
      'settings.update',
      {
        changes: [{ path: 'sharing.machineName', value }],
      },
    );
    const applied = result?.applied?.find((entry) => entry.path === 'sharing.machineName');
    // The daemon omits unchanged settings from applied (another owner may have saved first).
    const confirmed =
      applied ??
      (await backendRequest<{ value?: unknown }>('settings.get', {
        path: 'sharing.machineName',
      }));
    if (typeof confirmed?.value !== 'string' || confirmed.value !== value)
      throw new Error('Machine name was not applied');
    return confirmed.value;
  },
};
