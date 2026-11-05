/**
 * Composer copy for a remote agent's `/` menu: its skills are its machine's
 * (PROTOCOL agent-aux.md § Skills of a remote agent).
 */
import { m } from '$shared/paraglide/messages.js';
import type { AgentSkillsUnavailable, SkillInfo } from '$store/renderer/slices/skills/skills-types';

export interface RemoteSkillsInput {
  machine: string;
  skills: readonly SkillInfo[];
  stale: boolean;
  unavailable: AgentSkillsUnavailable | null;
  /** The machine's list was read and the last read did not fail. */
  ready: boolean;
}

export interface RemoteSlashCopy {
  /** Shown in place of the list when there is nothing to offer. */
  emptyLabel?: string;
  /** A muted row under the list. */
  notice?: string;
  /** The menu offers nothing even if a list arrived (an older machine). */
  hideSkills?: boolean;
  /** The tooltip of a `/name` chip the machine does not have, or `undefined`. */
  unavailableTitle?: (name: string) => string | undefined;
}

export function remoteSlashCopy(input: RemoteSkillsInput | undefined): RemoteSlashCopy {
  if (!input) return {};
  const { machine } = input;
  if (input.unavailable === 'machine-update-required') {
    // An older machine gives its agent no catalog: offer nothing, only the update.
    const text = m.chat_slashSkillSuggestionList_machineUpdateRequired_label({ machine });
    return { emptyLabel: text, hideSkills: true };
  }
  if (input.unavailable === 'machine-offline') {
    // The list holds only the workspace's project skills, not the machine's.
    const text = m.chat_slashSkillSuggestionList_machineOffline_label({ machine });
    return { emptyLabel: text, notice: text };
  }
  const known = new Set(input.skills.map((skill) => skill.name));
  return {
    emptyLabel: m.chat_slashSkillSuggestionList_noMachineSkills_label({ machine }),
    notice: input.stale
      ? m.chat_slashSkillSuggestionList_machineStale_label({ machine })
      : undefined,
    // No chip is marked before the machine's catalog is known.
    unavailableTitle: input.ready
      ? (name) =>
          known.has(name) ? undefined : m.chat_skillCommand_unavailable_tooltip({ name, machine })
      : undefined,
  };
}
