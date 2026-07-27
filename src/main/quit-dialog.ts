/**
 * Mode-branched copy for the running-agent quit confirmation dialog.
 *
 * The framing depends on who owns the daemon (`connection-mode.ts`):
 *   - `sidecar`  → quitting shuts the daemon down, so running agents stop
 *     mid-turn (the daemon captures them as interrupted records, PROTOCOL
 *     §6.6, and the app offers resume on next launch). Destructive framing,
 *     "Quit" as the default.
 *   - `external` → the daemon outlives the app, so closing is non-destructive:
 *     intentd and its running agents keep working in the background and the
 *     app reconnects on next launch. "Close" framing, agent names listed.
 *   - `unknown`  → treated as sidecar (the conservative, destructive framing).
 *
 * Kept as a pure, dependency-light helper (no electron runtime import, no
 * logger) so the copy is unit-testable — `src/main/index.ts` has heavy
 * top-level side effects and can only be regression-guarded via AST tests.
 */

import type { MessageBoxOptions } from 'electron';

import type { ConnectionMode } from '../features/backend/main/connection-mode';
import type { RespondingAgent } from './running-agents';
import { m } from '../shared/paraglide/messages.js';

/** Max agent names listed in the external-mode dialog before "and M more". */
export const MAX_LISTED_AGENT_NAMES = 5;

/**
 * Human-readable agent-name list, capped at `MAX_LISTED_AGENT_NAMES` with an
 * "and M more" suffix for the remainder.
 */
export function formatAgentNameList(agents: RespondingAgent[]): string {
  const names = agents.map((agent) => agent.name);
  const shown = names.slice(0, MAX_LISTED_AGENT_NAMES);
  const remaining = names.length - shown.length;
  return remaining > 0 ? `${shown.join(', ')}, and ${remaining} more` : shown.join(', ');
}

/**
 * Build the quit-confirmation dialog options for the given connection mode.
 * Callers must only invoke this with a non-empty agent list (the zero-agent
 * fast path skips the prompt entirely, in every mode).
 */
export function buildQuitDialogOptions(
  mode: ConnectionMode,
  agents: RespondingAgent[],
): MessageBoxOptions {
  const count = agents.length;
  const plural = count > 1;

  if (mode === 'external') {
    // Non-destructive framing: the external daemon is not ours to stop, so
    // closing the app leaves intentd and its agents running in the background.
    return {
      type: 'info',
      title: 'Agents Keep Running',
      message: `${count} agent${plural ? 's are' : ' is'} still working.`,
      detail: `Intent will close, but intentd and your ${count} running agent${plural ? 's' : ''} (${formatAgentNameList(agents)}) continue${plural ? '' : 's'} in the background. Reconnect anytime by reopening the app.`,
      buttons: ['Close', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    };
  }

  // Sidecar (and unknown) mode: quitting shuts down the daemon and its
  // running agents. The daemon captures those agents as interrupted records
  // on shutdown (PROTOCOL §6.6), and the app offers to resume them on next
  // launch — so quitting pauses rather than loses work, and Quit remains the
  // default.
  return {
    type: 'info',
    title: m.quit_dialog_sidecar_title(),
    message: `${count} agent${plural ? 's are' : ' is'} still working.`,
    detail: m.quit_dialog_sidecar_detail(),
    buttons: [m.quit_dialog_quit_button(), m.quit_dialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  };
}
