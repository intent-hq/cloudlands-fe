import type { AgentPlacement } from '$shared/types/agent-node';

/**
 * Wire `SpecialistDef` (`specialist.list`, PROTOCOL §5.11): the resolved view
 * of one definition. `source` is the winning tier (project > user > bundled)
 * and `path` the file it resolved from (omitted for `bundled`). The optional
 * frontmatter scalars (`codingAgent`/`model`/`roleReminder`/
 * `agentType`/`hidden`) are carried through verbatim when present;
 * `behaviorPrompt` mirrors `prompt` (the markdown body). `hidden: true`
 * excludes the specialist from picker surfaces (absent ⇒ not hidden).
 */
export interface SpecialistDef {
  runsOn?: AgentPlacement;
  /** Original Claude definition; read-only in Intent. */
  importedFrom?: 'claude-code';
  /** Unsupported settings that prevent launching this imported definition. */
  unsupportedFields?: string[];
  requiredSkills?: string[];
  missingSkills?: string[];
  id: string;
  name: string;
  description: string;
  codingAgent?: string;
  model?: string;
  roleReminder?: string;
  agentType?: string;
  hidden?: boolean;
  /**
   * Ordered delegation model options (additive, PROTOCOL §5.11): emitted on
   * `list`/`get` when the resolved list is non-empty, omitted otherwise
   * (never `null`/`[]` on the wire); accepted in `create`/`edit` spec bodies.
   */
  modelOptions?: { provider?: string; model: string; hint: string; reasoningEffort?: string }[];
  /**
   * Reasoning-effort level for the specialist's model (additive, PROTOCOL
   * §5.11): one of the model's catalog `effortLevels`. Omitted when the
   * specialist inherits the model default (never `null`/`""` on the wire).
   */
  reasoningEffort?: string;
  /**
   * Orchestration role (additive, PROTOCOL §5.11): 'orchestrator' powers the
   * New Workspace modal's team card; 'internal' is excluded from the modal's
   * single-agent dropdown only. Omitted for standard specialists.
   */
  role?: 'orchestrator' | 'internal';
  /**
   * Specialist ids the orchestrator delegates to (additive, PROTOCOL §5.11).
   * Advisory/render-only; omitted when not declared.
   */
  teamAgents?: string[];
  /**
   * Built-in avatar design id (additive, PROTOCOL §5.11). Free string on the
   * wire; unknown/absent values degrade to the client's fallback design.
   */
  icon?: string;
  prompt?: string;
  behaviorPrompt?: string;
  source: 'project' | 'user' | 'bundled';
  isCustomized?: boolean;
  path?: string;
  /**
   * Daemon-computed default-model preview (additive, PROTOCOL §5.11): the
   * model a no-model `agent.create` with this specialist would pin, resolved
   * by the daemon's single creation-time resolver in the request's `provider`
   * context. Both fields are omitted when resolution yields the provider CLI
   * default (clients render "Provider default").
   */
  resolvedModel?: string;
  resolvedProvider?: string;
  /** Effort from the matching model option or specialist, before Settings fallback. */
  resolvedReasoningEffort?: string;
}

export interface SpecialistImportDiagnostic {
  path: string;
  isDirectory?: boolean;
  source: 'user' | 'project';
  code: 'invalid' | 'unreadable' | 'broken-link' | 'too-large' | 'shadowed' | 'scan-limit';
  message: string;
  specialistId?: string;
  winnerPath?: string;
}

export interface SpecialistCatalog {
  specialists: SpecialistDef[];
  importDiagnostics?: SpecialistImportDiagnostic[];
}
