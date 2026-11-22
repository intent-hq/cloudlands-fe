import type { ConnectionRecord, DaemonMode } from '$shared/types/connections';
import type {
  RemoteMachine,
  RemoteMachineCapacity,
  RemoteMachineResources,
} from '$shared/types/remote-machines';
import { isMachineProviderOffered } from './remote-model-picker';

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

const REPORT_STATES = new Set<RemoteMachine['state']>(['connected', 'disconnected']);

/**
 * The machine-wide load from its report while it is connected: every agent on
 * it, this host's, other hosts' and its own local ones. Only a runner that
 * sends `resources` pushes its report when the count changes, so the count is
 * live only then; null otherwise (not connected, or an older runner whose
 * count can be an hour old).
 */
export function machineRowLoad(machine: RemoteMachine | null): RemoteMachineCapacity | null {
  if (machine?.state !== 'connected' || !machine.capabilities?.resources) return null;
  return machine.capabilities.capacity ?? null;
}

/**
 * The whole host's CPU and memory from the machine's report while it is
 * connected; null otherwise, and for an older machine that does not send them.
 */
export function machineRowResources(machine: RemoteMachine | null): RemoteMachineResources | null {
  return machine?.state === 'connected' ? (machine.capabilities?.resources ?? null) : null;
}

/** The machine's last report, while it is connected or idle (disconnected). */
export function machineRowReport(machine: RemoteMachine | null) {
  return machine && REPORT_STATES.has(machine.state) ? machine.capabilities : undefined;
}

export interface MachineRowProvider {
  id: string;
  name: string;
}

/**
 * The providers available on a Machines row's machine: the connected daemon's
 * installed providers, else the installed providers in the backend's last
 * report for a machine made available to it. That report counts while the
 * machine is connected or disconnected (its idle state: the backend connects
 * on demand); any other state shows nothing rather than a misleading list.
 * Providers the machine hides (`visible: false`) are left out.
 * `catalogName` supplies the provider's display name.
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
  const report = machineRowReport(machine);
  if (!report) return [];
  return report.providers
    .filter(isMachineProviderOffered)
    .map((provider) => ({ id: provider.id, name: catalogName(provider.id) ?? provider.id }));
}

/**
 * The providers a machine could run once Node.js is installed: those its
 * last report marks `prerequisite-missing` (they run through `npx`, which
 * fetches their pinned adapter). Others may still lack their own CLI.
 * Empty when the report is not usable.
 */
export function machineRowNeedsNode(
  machine: RemoteMachine | null,
  catalogName: (providerId: string) => string | undefined,
  daemonMode?: DaemonMode | null,
): string[] {
  // An orchestrator runs no providers, so it never needs Node.js.
  if (daemonMode === 'orchestrator') return [];
  const report = machineRowReport(machine);
  if (!report) return [];
  return report.providers
    .filter((provider) => provider.visible !== false && provider.status === 'prerequisite-missing')
    .map((provider) => catalogName(provider.id) ?? provider.id);
}
