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
}

export interface RemoteSlashCopy {
  /** Shown in place of the list when there is nothing to offer. */
  emptyLabel?: string;
  /** A muted row under the list. */
  notice?: string;
  /** The tooltip of a `/name` chip the machine does not have, or `undefined`. */
  unavailableTitle?: (name: string) => string | undefined;
}

export function remoteSlashCopy(input: RemoteSkillsInput | undefined): RemoteSlashCopy {
  if (!input) return {};
  const { machine } = input;
  if (input.unavailable === 'machine-update-required') {
    const text = m.chat_slashSkillSuggestionList_machineUpdateRequired_label({ machine });
    return { emptyLabel: text, notice: text };
  }
  if (input.unavailable === 'machine-offline') {
    return { emptyLabel: m.chat_slashSkillSuggestionList_machineOffline_label({ machine }) };
  }
  const known = new Set(input.skills.map((skill) => skill.name));
  return {
    emptyLabel: m.chat_slashSkillSuggestionList_noMachineSkills_label({ machine }),
    notice: input.stale
      ? m.chat_slashSkillSuggestionList_machineStale_label({ machine })
      : undefined,
    unavailableTitle: (name) =>
      known.has(name) ? undefined : m.chat_skillCommand_unavailable_tooltip({ name, machine }),
  };
}
