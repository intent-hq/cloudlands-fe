/**
 * Confirmation copy for the orphaned-sidecar kill-and-restart recovery
 * (#2444). Shown only when the orphaned daemon has actively responding agents
 * that the restart would stop mid-turn (same safety pattern as the quit flow;
 * the daemon captures them as interrupted records, PROTOCOL §6.6, and offers
 * resume after the restart).
 *
 * Kept as a pure, dependency-light helper (no electron runtime import, no
 * logger), mirroring quit-dialog.ts, so the copy is unit-testable.
 */

import type { MessageBoxOptions } from 'electron';

import { formatAgentNameList } from './quit-dialog';
import type { RespondingAgent } from './running-agents';
import { m } from '../shared/paraglide/messages.js';

/**
 * Build the confirmation dialog for restarting the orphaned daemon while
 * `agents` are actively responding. Callers must only invoke this with at
 * least one agent (the zero-agent path restarts without prompting).
 * Response 0 = proceed with the restart, response 1 = cancel.
 */
export function buildOrphanRestartDialogOptions(agents: RespondingAgent[]): MessageBoxOptions {
  const count = agents.length;
  const names = formatAgentNameList(agents);
  return {
    type: 'warning',
    title: m.orphanRestart_dialog_title(),
    message:
      count > 1 ? m.quit_dialog_agents_working_many({ count }) : m.quit_dialog_agents_working_one(),
    detail:
      count > 1
        ? m.orphanRestart_dialog_detail_many({ count, names })
        : m.orphanRestart_dialog_detail_one({ names }),
    buttons: [m.orphanRestart_dialog_restart_button(), m.quit_dialog_cancel_button()],
    defaultId: 1,
    cancelId: 1,
  };
}
