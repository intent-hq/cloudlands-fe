/**
 * Native copy for the running-agent quit confirmation dialog.
 *
 * The prompt only ever concerns agents on our spawned sidecar, which quit
 * shuts down: those agents stop mid-turn (the daemon captures them as
 * interrupted records, PROTOCOL §6.6, and the app offers resume on next
 * launch). Agents on a daemon the app does not stop (a remote backend or an
 * adopted external local daemon) keep running and never trigger the prompt,
 * so the caller (`quit-confirmation.ts`) hands over the interrupted agents
 * only. Destructive framing, "Quit" as the default.
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
 * Build the quit-confirmation dialog options for the agents on the spawned
 * sidecar that quitting interrupts. Callers must only invoke this with at
 * least one agent (the zero-agent fast path skips the prompt entirely).
 */
export function buildQuitDialogOptions(interrupted: RespondingAgent[]): MessageBoxOptions {
  const count = interrupted.length;
  // Quitting shuts down the sidecar and its running agents. The daemon
  // captures those agents as interrupted records on shutdown (PROTOCOL §6.6),
  // and the app offers to resume them on next launch — so quitting pauses
  // rather than loses work, and Quit remains the default.
  return {
    type: 'info',
    title: m.quit_dialog_sidecar_title(),
    message:
      count > 1 ? m.quit_dialog_agents_working_many({ count }) : m.quit_dialog_agents_working_one(),
    detail: m.quit_dialog_sidecar_detail(),
    buttons: [m.quit_dialog_quit_button(), m.quit_dialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  };
}

/**
 * Native fallback copy for the tabs-only case: zero responding agents, but
 * agent-owned embedded browser tabs would be disconnected by quitting. Used
 * when the renderer prompt is unavailable. Callers must only invoke this with
 * `tabCount >= 1` (both-empty quits silently, agents present use
 * `buildQuitDialogOptions`).
 */
export function buildTabsOnlyQuitDialogOptions(tabCount: number): MessageBoxOptions {
  return {
    type: 'info',
    title: m.quit_dialog_tabs_only_title(),
    message:
      tabCount > 1
        ? m.quit_dialog_tabs_only_message_many({ count: tabCount })
        : m.quit_dialog_tabs_only_message_one(),
    detail: m.quit_dialog_tabs_only_detail(),
    buttons: [m.quit_dialog_quit_button(), m.quit_dialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  };
}
