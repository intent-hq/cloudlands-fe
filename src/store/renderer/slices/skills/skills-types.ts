/**
 * Skills slice types.
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type SkillInfo = {
  name: string;
  description: string;
  location: string;
  resourceDirectory?: string;
  scope?: 'project' | 'user';
};

export type SkillsWorkspaceState = {
  skills: SkillInfo[];
  loading: boolean;
  error: string | null;
};

/** Why a remote agent's machine could not list its skills (PROTOCOL §5.34). */
export type AgentSkillsUnavailable = 'machine-offline' | 'machine-update-required';

/** `skill.list` with `agentId`: a remote agent's machine skills. */
export type AgentSkills = {
  skills: SkillInfo[];
  /** The machine is offline; this is the last list it reported. */
  stale: boolean;
  unavailable: AgentSkillsUnavailable | null;
};

export type SkillsAgentState = SkillsWorkspaceState & {
  stale: boolean;
  unavailable: AgentSkillsUnavailable | null;
  /** A read succeeded at least once. */
  loaded: boolean;
  /** The agent's workspace, so its entry goes with the workspace. */
  workspaceId: string | null;
};

export type SkillsState = {
  byWorkspaceId: Record<string, SkillsWorkspaceState>;
  /** Remote agents only, keyed by agent id. */
  byAgentId: Record<string, SkillsAgentState>;
};
