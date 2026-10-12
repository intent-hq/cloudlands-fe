import type { KnownRepo } from '../../../../shared/types/known-repo';
import { isDaemonManagedCheckoutPath } from '../../../../shared/utils/daemon-managed-checkout';
import type { SettingDefinitionWithValue } from '../../../../lib/client/settings-types';
import type { BackendTransport } from '../../../../lib/client/live/backend-transport-types';

export const REPOS_KNOWN_SETTING = 'repos.known';

export interface KnownRepositoriesReadPorts {
  backendRequest: BackendTransport['request'];
  readSetting: (path: string) => Promise<SettingDefinitionWithValue | null>;
  currentConnection: () => string | null;
  canAdministerHost: () => boolean;
}

/** Canonical recents read and shared settings helper; constructing it performs no I/O. */
export function createKnownRepositoriesReader({
  backendRequest,
  readSetting,
  currentConnection,
  canAdministerHost,
}: KnownRepositoriesReadPorts) {
  async function readReposKnownSetting(): Promise<KnownRepo[]> {
    if (!canAdministerHost()) return [];
    try {
      const setting = await readSetting(REPOS_KNOWN_SETTING);
      return Array.isArray(setting?.value) ? (setting.value as KnownRepo[]) : [];
    } catch {
      // Non-fatal: recents still serve the daemon repo.list registry.
      return [];
    }
  }

  async function readKnownRepositories(): Promise<{ success: boolean; data: KnownRepo[] }> {
    const connection = currentConnection();
    const result = await backendRequest<{ repos: KnownRepo[] }>('repo.list');
    if (connection !== currentConnection()) return { success: true, data: [] };
    const repos = (result.repos ?? []).filter((repo) => !isDaemonManagedCheckoutPath(repo.path));
    const githubPicks = (await readReposKnownSetting()).filter((repo) => !!repo.githubUrl);
    if (connection !== currentConnection()) return { success: true, data: [] };
    const merged = [
      ...githubPicks,
      ...repos.filter((repo) => !githubPicks.some((pick) => pick.path === repo.path)),
    ].sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''));
    return { success: true, data: merged };
  }

  return { readReposKnownSetting, readKnownRepositories };
}
