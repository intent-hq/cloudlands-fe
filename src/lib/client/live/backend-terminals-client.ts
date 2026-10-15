import { m } from '../../../shared/paraglide/messages.js';
import type { TerminalTab } from '../../../store/renderer/slices/terminals/terminals-slice';
import type { TerminalListResult, TerminalsReadClient } from '../lifecycle-read-client-types';
import type { BackendRuntime } from './backend-transport-runtime';

/**
 * Coerce a raw `terminal.list` entry into a `TerminalTab` for the renderer
 * slice. The daemon shape is `{ id, name, cwd, isExecutingCommand }` (PROTOCOL
 * §5.9) — `name` is the display name given at spawn (e.g. "Setup Script") and
 * flows straight into `TerminalTab.name`; display fallbacks live in the
 * selectors (`customName || name || 'Terminal'`), never a raw id-derived label.
 */
function toTerminalTab(raw: unknown, fallbackWorkspaceId?: string): TerminalTab | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const id = String(entry.terminalId ?? entry.id ?? '');
  if (!id) return null;
  const workspaceId =
    typeof entry.workspaceId === 'string' ? entry.workspaceId : fallbackWorkspaceId;
  return {
    id,
    name: typeof entry.name === 'string' ? entry.name : '',
    workspaceId,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : undefined,
    isConnected: true,
    ...(typeof entry.isExecutingCommand === 'boolean'
      ? { isExecuting: entry.isExecutingCommand }
      : {}),
  };
}

export function createBackendTerminalsClient(
  backend: Pick<BackendRuntime, 'backendRequest'>,
  options: { strict?: boolean } = {},
): TerminalsReadClient {
  const { backendRequest } = backend;
  return {
    async list(workspaceId: string): Promise<TerminalListResult> {
      const result = await backendRequest<
        { terminals?: unknown[]; daemonBootId?: unknown } | unknown[]
      >('terminal.list', { workspaceId });
      if (options.strict) {
        if (
          !result ||
          typeof result !== 'object' ||
          !('terminals' in result) ||
          !Array.isArray(result.terminals) ||
          result.terminals.some(
            (entry) =>
              !entry ||
              typeof entry !== 'object' ||
              typeof (entry as { id?: unknown }).id !== 'string' ||
              !(entry as { id: string }).id ||
              ('workspaceId' in entry && entry.workspaceId !== workspaceId),
          )
        )
          throw new Error(m.terminal_ipc_listFailed_error());
      }
      // Envelope shape (PROTOCOL §5.13): { terminals, daemonBootId }. A legacy
      // pre-envelope daemon returns a bare array — tolerated by shape detection
      // and treated as carrying no boot metadata (daemonBootId omitted), which
      // the store maps to the preserve-tabs behavior.
      const isLegacyArray = Array.isArray(result);
      const raw = isLegacyArray
        ? result
        : Array.isArray((result as { terminals?: unknown[] })?.terminals)
          ? (result as { terminals: unknown[] }).terminals
          : [];
      const bootId =
        !isLegacyArray && typeof (result as { daemonBootId?: unknown })?.daemonBootId === 'string'
          ? (result as { daemonBootId: string }).daemonBootId
          : undefined;
      const tabs: TerminalTab[] = [];
      for (const entry of raw) {
        const tab = toTerminalTab(entry, workspaceId);
        if (tab) tabs.push(tab);
      }
      return { terminals: tabs, ...(bootId !== undefined ? { daemonBootId: bootId } : {}) };
    },
  };
}
