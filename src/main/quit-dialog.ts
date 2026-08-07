/**
 * Ownership-branched copy for the running-agent quit confirmation dialog.
 *
 * The framing of each agent depends on a single question: does quitting shut
 * down the daemon that agent runs on? The caller
 * (`quit-confirmation.ts`) answers it per source and hands over two groups:
 *   - `keepRunning` → the daemon outlives the app (a remote backend, or an
 *     adopted external local daemon), so closing is non-destructive: intentd
 *     and its running agents keep working in the background and the app
 *     reconnects on next launch. "Close" framing, agent names listed.
 *   - `interrupted` → our spawned sidecar, which quit shuts down, so those
 *     agents stop mid-turn (the daemon captures them as interrupted records,
 *     PROTOCOL §6.6, and the app offers resume on next launch). Destructive
 *     framing, "Quit" as the default.
 * When both groups are non-empty a combined dialog lists them separately.
 *
 * Kept as a pure, dependency-light helper (no electron runtime import, no
 * logger) so the copy is unit-testable — `src/main/index.ts` has heavy
 * top-level side effects and can only be regression-guarded via AST tests.
 */

import type { MessageBoxOptions } from 'electron';

import type { RespondingAgent } from './running-agents';
import { m } from '../shared/paraglide/messages.js';

/** Max agent names listed in the dialog before "and M more". */
export const MAX_LISTED_AGENT_NAMES = 5;

/**
 * Responding agents split by whether quitting shuts down their daemon.
 * Both groups may be non-empty (a remote backend active alongside a spawned
 * local sidecar that still has in-flight agents).
 */
export interface QuitAgentGroups {
  /** Agents on a daemon the app does not stop (remote / adopted external). */
  keepRunning: RespondingAgent[];
  /** Agents on the app-spawned sidecar, stopped mid-turn by quitting. */
  interrupted: RespondingAgent[];
}

/**
 * Human-readable agent-name list, capped at `MAX_LISTED_AGENT_NAMES` with an
 * "and M more" suffix for the remainder.
 */
export function formatAgentNameList(agents: RespondingAgent[]): string {
  const names = agents.map((agent) => agent.name);
  const shown = names.slice(0, MAX_LISTED_AGENT_NAMES);
  const remaining = names.length - shown.length;
  return remaining > 0
    ? m.quit_dialog_agent_list_more({ names: shown.join(', '), count: remaining })
    : shown.join(', ');
}

/**
 * Build the quit-confirmation dialog options for the given agent groups.
 * Callers must only invoke this with at least one agent across both groups
 * (the zero-agent fast path skips the prompt entirely).
 */
export function buildQuitDialogOptions({
  keepRunning,
  interrupted,
}: QuitAgentGroups): MessageBoxOptions {
  const count = keepRunning.length + interrupted.length;
  const plural = count > 1;
  const working = plural
    ? m.quit_dialog_agents_working_many({ count })
    : m.quit_dialog_agents_working_one();

  if (keepRunning.length > 0 && interrupted.length > 0) {
    // Both daemons are in play: the one we do not stop carries its agents
    // through the quit, the sidecar we spawned takes its agents down with it.
    // "Quit" stays the default because the destructive half dominates.
    const keepNames = formatAgentNameList(keepRunning);
    const stopNames = formatAgentNameList(interrupted);
    const keepCount = keepRunning.length;
    const stopCount = interrupted.length;
    return {
      type: 'info',
      title: m.quit_dialog_sidecar_title(),
      message: working,
      detail: [
        keepCount > 1
          ? m.quit_dialog_combined_keep_running_many({ count: keepCount, names: keepNames })
          : m.quit_dialog_combined_keep_running_one({ names: keepNames }),
        stopCount > 1
          ? m.quit_dialog_combined_interrupted_many({ count: stopCount, names: stopNames })
          : m.quit_dialog_combined_interrupted_one({ names: stopNames }),
      ].join('\n\n'),
      buttons: [m.quit_dialog_quit_button(), m.quit_dialog_cancel_button()],
      defaultId: 0,
      cancelId: 1,
    };
  }

  if (interrupted.length === 0) {
    // Non-destructive framing: the daemon is not ours to stop, so closing the
    // app leaves intentd and its agents running in the background.
    const names = formatAgentNameList(keepRunning);
    return {
      type: 'info',
      title: m.quit_dialog_external_title(),
      message: working,
      detail: plural
        ? m.quit_dialog_external_detail_many({ count, names })
        : m.quit_dialog_external_detail_one({ names }),
      buttons: [m.quit_dialog_close_button(), m.quit_dialog_cancel_button()],
      defaultId: 0,
      cancelId: 1,
    };
  }

  // Interrupted only: quitting shuts down the sidecar and its running agents.
  // The daemon captures those agents as interrupted records on shutdown
  // (PROTOCOL §6.6), and the app offers to resume them on next launch — so
  // quitting pauses rather than loses work, and Quit remains the default.
  return {
    type: 'info',
    title: m.quit_dialog_sidecar_title(),
    message: working,
    detail: m.quit_dialog_sidecar_detail(),
    buttons: [m.quit_dialog_quit_button(), m.quit_dialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  };
}
