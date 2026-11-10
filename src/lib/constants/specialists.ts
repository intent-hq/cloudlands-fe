import { m } from '$shared/paraglide/messages.js';
import type {
  SpecialistModelOption,
  SpecialistRole,
  SpecialistSource,
} from '$shared/specialist-file-types';

/** Known built-in specialist IDs */
export type BuiltinSpecialistId =
  | 'pr-reviewer'
  | 'vulnerability-scanner'
  | 'ui-designer'
  | 'developer'
  | 'product-manager'
  | 'maintenance-coordinator'
  | 'chief-of-staff';

export interface Specialist {
  /** Original Claude definition; read-only in Intent. */
  importedFrom?: 'claude-code';
  /** Unsupported settings that prevent launching this imported definition. */
  unsupportedFields?: string[];
  requiredSkills?: string[];
  missingSkills?: string[];
  id: string;
  name: string;
  description: string;
  /**
   * ACP provider / runtime backend for this specialist (e.g. 'auggie', 'codex').
   * If omitted, callers should fall back to the global default coding agent.
   */
  codingAgent?: string;
  /**
   * Hardcoded default model ID. Used for custom specialists or backwards compatibility.
   * Optional: if not provided, callers should use the user's current default model.
   */
  defaultModel?: string;
  defaultBehaviorPrompt: string;
  /**
   * Short, punchy reminder of the most critical constraints for this specialist.
   * Injected periodically during long conversations to prevent role drift.
   * Should be 1-2 sentences focusing on what the specialist MUST NOT do.
   */
  roleReminder?: string;
  /**
   * Where this specialist was loaded from (project file, user file, bundled, etc.).
   * Undefined for hardcoded fallback specialists.
   */
  source?: SpecialistSource;
  /**
   * Default agent type for agents created with this specialist.
   * Controls which instruction set (agent loop) the agent uses.
   * If not set, defaults to 'task-loop'.
   */
  defaultAgentType?: string;
  /**
   * When true, this specialist is excluded from picker surfaces
   * (it remains visible on Settings → AI Behavior for editing).
   */
  hidden?: boolean;
  /**
   * Daemon-computed default-model preview (`specialist.list` resolvedModel/
   * resolvedProvider, PROTOCOL §5.11): the model a no-model create with this
   * specialist would pin, in the daemon's default-provider context. Absent
   * when resolution yields the provider CLI default ("Provider default").
   */
  resolvedModel?: string;
  resolvedProvider?: string;
  /**
   * Ordered delegation model options (`specialist.list` modelOptions,
   * PROTOCOL §5.11). Absent when the resolved list is empty.
   */
  modelOptions?: SpecialistModelOption[];
  /**
   * Reasoning-effort level for the specialist's model (`specialist.list`
   * reasoningEffort, PROTOCOL §5.11). Absent when the specialist inherits
   * the model default.
   */
  reasoningEffort?: string;
  /**
   * Orchestration role (`specialist.list` role, PROTOCOL §5.11):
   * 'orchestrator' power the New Workspace modal's team card; 'internal' is
   * excluded from the modal's single-agent dropdown only (in-workspace
   * pickers and Settings unaffected). Absent means standard.
   */
  role?: SpecialistRole;
  /**
   * Specialist ids the orchestrator delegates to (`specialist.list`
   * teamAgents, PROTOCOL §5.11). Advisory/render-only — drives the modal's
   * team-card avatar row. Absent when not declared.
   */
  teamAgents?: string[];
  /**
   * Built-in avatar design id (`specialist.list` icon, PROTOCOL §5.11).
   * Unknown/absent values degrade to the id-map + seeded fallback.
   */
  icon?: string;
  /**
   * Display-only placeholder from `SPECIALISTS`: the daemon catalog has not
   * been read, so the prompt and role reminder are unknown, not empty. Never
   * write it back or start an agent from it.
   */
  promptUnavailable?: true;
}

/**
 * Display metadata for the built-in specialists, in picker order. intentd owns
 * their definitions (prompts, reminders, model settings) and serves them on
 * `specialist.list`; this list only names, orders and illustrates them before
 * that catalog loads or when it cannot be read.
 */
export const SPECIALISTS: Specialist[] = [
  {
    id: 'pr-reviewer',
    icon: 'pr-reviewer',
    get name() {
      return m.specialists_builtin_prReviewer_name();
    },
    get description() {
      return m.specialists_builtin_prReviewer_description();
    },
    defaultBehaviorPrompt: '',
    promptUnavailable: true,
  },
  {
    id: 'ui-designer',
    icon: 'ui-designer',
    get name() {
      return m.specialists_builtin_uiDesigner_name();
    },
    get description() {
      return m.specialists_builtin_uiDesigner_description();
    },
    defaultBehaviorPrompt: '',
    promptUnavailable: true,
  },
  {
    id: 'vulnerability-scanner',
    icon: 'pr-reviewer',
    get name() {
      return m.specialists_builtin_vulnerabilityScanner_name();
    },
    get description() {
      return m.specialists_builtin_vulnerabilityScanner_description();
    },
    defaultBehaviorPrompt: '',
    promptUnavailable: true,
  },
  {
    id: 'developer',
    icon: 'verifier',
    get name() {
      return m.specialists_builtin_developer_name();
    },
    get description() {
      return m.specialists_builtin_developer_description();
    },
    defaultBehaviorPrompt: '',
    promptUnavailable: true,
  },
  {
    id: 'product-manager',
    icon: 'coordinator',
    get name() {
      return m.specialists_builtin_productManager_name();
    },
    get description() {
      return m.specialists_builtin_productManager_description();
    },
    defaultBehaviorPrompt: '',
    promptUnavailable: true,
  },
  {
    id: 'maintenance-coordinator',
    icon: 'ralph',
    get name() {
      return m.specialists_builtin_maintenanceCoordinator_name();
    },
    get description() {
      return m.specialists_builtin_maintenanceCoordinator_description();
    },
    defaultBehaviorPrompt: '',
    promptUnavailable: true,
  },
  {
    id: 'chief-of-staff',
    icon: 'chief-of-staff',
    get name() {
      return m.specialists_builtin_chiefOfStaff_name();
    },
    get description() {
      return m.specialists_builtin_chiefOfStaff_description();
    },
    hidden: true,
    defaultBehaviorPrompt: '',
    promptUnavailable: true,
  },
];

/** Specialist IDs that require GitHub to be connected */
export const GITHUB_DEPENDENT_SPECIALIST_IDS = new Set(['pr-reviewer']);

/**
 * Specialist pre-selected for a new workspace's single agent when nothing has
 * been remembered yet (fresh install: New Workspace modal and onboarding).
 * Contract for every caller: check the id against the resolved specialist
 * list (`selectSpecialists`) and fall back to General (`null`) when a
 * non-empty list does not contain it — a loaded list is authoritative
 * (daemon replacement mode). Only an empty, not-yet-loaded list may assume
 * the daemon-bundled Developer.
 */
export const DEFAULT_NEW_WORKSPACE_SPECIALIST_ID: BuiltinSpecialistId = 'developer';

export function getSpecialistById(id: string): Specialist | undefined {
  return SPECIALISTS.find((s) => s.id === id);
}
