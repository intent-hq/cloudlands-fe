import type { ConnectionRecord } from '$shared/types/connections';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { MACHINE_PROVIDER_NOT_INSTALLED } from './remote-model-picker';

/** The platform families Settings → Machines shows an icon for. */
export type MachinePlatform = 'macos' | 'windows' | 'linux';

const PLATFORMS: Record<string, MachinePlatform> = {
  macos: 'macos',
  darwin: 'macos',
  windows: 'windows',
  win32: 'windows',
  linux: 'linux',
};

/** Map a daemon-reported OS identifier to a platform icon; null when unknown. */
export function machinePlatform(os: string | null | undefined): MachinePlatform | null {
  return (os && PLATFORMS[os.trim().toLowerCase()]) || null;
}

/**
 * A Machines row's platform: the connected daemon's own `host.status` report,
 * else the backend's report for a machine made available to it.
 */
export function machineRowPlatform(
  device: Pick<ConnectionRecord, 'hostOs'>,
  machine: RemoteMachine | null,
): MachinePlatform | null {
  return machinePlatform(device.hostOs ?? machine?.platform?.os);
}

export interface MachineRowProvider {
  id: string;
  name: string;
}

/**
 * The providers available on a Machines row's machine: the connected daemon's
 * installed providers, else the installed providers in the backend's report
 * for a machine made available to it while that machine is connected. Empty
 * when neither is known, so an offline row shows nothing rather than a stale
 * or misleading list. `catalogName` supplies the provider's display name.
 */
export function machineRowProviders(
  device: Pick<ConnectionRecord, 'providers'>,
  machine: RemoteMachine | null,
  catalogName: (providerId: string) => string | undefined,
): MachineRowProvider[] {
  if (device.providers)
    return device.providers.map((provider) => ({
      id: provider.id,
      name: catalogName(provider.id) ?? provider.displayName,
    }));
  if (machine?.state !== 'connected' || !machine.capabilities) return [];
  return machine.capabilities.providers
    .filter((provider) => !MACHINE_PROVIDER_NOT_INSTALLED.has(provider.status))
    .map((provider) => ({ id: provider.id, name: catalogName(provider.id) ?? provider.id }));
}
