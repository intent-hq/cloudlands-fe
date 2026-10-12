import { EDITOR_REGISTRY } from '../../shared/editors/editor-registry';
import type { InstalledEditor } from '../../store/renderer/slices/external-editors/external-editors-slice';
import type { BackendRuntime } from '../../lib/client/live/backend-transport-runtime';

/** Daemon `host.listInstalledEditors` entry shape (PROTOCOL §5.14). */
interface HostInstalledEditorEntry {
  id: string;
  installed: boolean;
  path?: string;
  source?: string;
  flatpakId?: string;
}

/** Daemon `host.listInstalledEditors` result shape (PROTOCOL §5.14). */
interface HostListInstalledEditorsResult {
  editors: HostInstalledEditorEntry[];
}

type ExternalEditorReadDependencies = Pick<BackendRuntime, 'backendRequest'> & {
  getHostAdministrationContext(): string | null;
};

/** Canonical daemon read and source envelope; construction performs no host work. */
export function createExternalEditorReadRuntime({
  backendRequest,
  getHostAdministrationContext,
}: ExternalEditorReadDependencies) {
  /** Fetch the daemon-host editor catalog (detection runs on the daemon host). */
  async function listInstalledEditors(): Promise<HostInstalledEditorEntry[]> {
    const context = getHostAdministrationContext();
    if (!context) return [];
    const result = await backendRequest<HostListInstalledEditorsResult>(
      'host.listInstalledEditors',
    );
    if (context !== getHostAdministrationContext()) return [];
    return Array.isArray(result?.editors) ? result.editors : [];
  }

  async function detectInstalledEditors() {
    try {
      const entries = await listInstalledEditors();
      const data: InstalledEditor[] = [];
      for (const entry of entries) {
        const def = EDITOR_REGISTRY.find((candidate) => candidate.id === entry.id);
        if (!def) continue;
        data.push({
          id: def.id,
          name: def.name,
          shortLabel: def.shortLabel,
          appName: def.appName,
          category: def.category,
          handlerType: def.handlerType,
          bundleId: def.bundleId,
          shortcut: def.shortcut,
          priority: def.priority,
          // The file manager is always present: the daemon's macOS bundle probe
          // looks for /Applications/Finder.app, which never exists (Finder lives
          // in /System/Library/CoreServices), so `finder` came back
          // installed:false and the "Reveal in Finder" row vanished from every
          // Open-In menu. The reveal launches via `host.exec` (shell-reveal-
          // bridge-seeder), not the bundle path, and the legacy Electron handler
          // (external-editors.ipc.ts) hard-coded finder as installed — mirror
          // that here; locality gating still hides it on remote daemons.
          installed: entry.installed === true || def.handlerType === 'finder',
        });
      }
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { listInstalledEditors, detectInstalledEditors };
}
