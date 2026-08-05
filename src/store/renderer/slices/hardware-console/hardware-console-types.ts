import type { ActionKeyActionId } from "$features/hardware-console/actions/action-mapping";
import type {
  CycleScope,
  CycleScopeFamilyId,
} from "$features/hardware-console/actions/cycle-scope";
import type { HardwareDeviceModel } from "$features/hardware-console/input/types";
import type { PromptUsageEntry } from "$features/hardware-console/prompt-picker/curation";

/** Transient UI state of the joystick radial prompt picker overlay. */
export interface RadialPromptPickerState {
  /** True while the joystick is deflected and the overlay is showing. */
  open: boolean;
  /** Top-N prompt texts by sector (index 0 = sector 0). */
  prompts: string[];
  /**
   * Highlighted 0-based sector. `prompts.length` = the dedicated Cancel
   * sector at 6 o'clock; `null` = centered. Release inserts nothing in
   * either of those cases.
   */
  sector: number | null;
}

/** State for the hardware-console (Work Louder Micro) key assignments. */
export interface HardwareConsoleState {
  /** Whether the hardware-console integration is enabled (device panel toggle). */
  enabled: boolean;
  /** True once the persisted enabled flag was read from the daemon settings bag. */
  enabledHydrated: boolean;
  /**
   * 6-slot pin array (slot 0 = key "1" = agent key AG02; see
   * `AGENT_KEY_IDS`). `null` = unpinned (auto-fills by workspace activity);
   * `UNASSIGNED_KEY_PIN` = sticky-unassigned (stays empty, never
   * auto-fills). Assignments are sticky: the persistence middleware
   * reconciles auto-filled slots back into pins so they survive activity
   * changes and are freed only on archive/delete. See the resolver in
   * `$features/hardware-console/assignment/key-assignment`.
   */
  keyPins: (string | null)[];
  /** True once the persisted pins were read from the daemon settings bag. */
  hydrated: boolean;
  /**
   * Workspaces auto-fill must never place on a key (manually unassigned).
   * Manually pinning a workspace removes it from this list. Persisted in
   * the daemon settings bag alongside `keyPins`.
   */
  excludedWorkspaceIds: string[];
  /** Normalized prompt-usage tracker (composer submissions), ranked for the radial picker. */
  promptUsage: PromptUsageEntry[];
  /** Top-N surface of the radial picker (device-panel setting; clamped 1–12). */
  promptPickerLimit: number;
  /** True once prompt usage + limit were read from the daemon settings bag. */
  promptsHydrated: boolean;
  /** Joystick radial prompt picker overlay state (transient, never persisted). */
  radialPrompt: RadialPromptPickerState;
  /** Workspace targeted by the encoder-rotate HUD; `null` = HUD hidden. */
  encoderHudWorkspaceId: string | null;
  /** Label of the last-fired cycle action key shown by the action HUD; `null` = HUD hidden. */
  actionHudLabel: string | null;
  /** True while a push-to-talk recording is in progress (transient, never persisted). */
  pttRecording: boolean;
  /** True while a `voice.transcribe` request is in flight (transient, never persisted). */
  voiceTranscribing: boolean;
  /**
   * Per-model 7-slot action-key mappings (slot 0 = action key ACT06),
   * keyed by device model so a customized CM2 layout never bleeds into the
   * Codex Micro (different physical caps) and vice versa. Defaults per
   * model come from `DEFAULT_ACTION_MAPPINGS` in
   * `$features/hardware-console/actions/action-mapping`.
   */
  actionMappingByModel: Record<HardwareDeviceModel, ActionKeyActionId[]>;
  /** True once the persisted mapping was read from the daemon settings bag. */
  actionMappingHydrated: boolean;
  /**
   * Per-family scope of the togglable agent-cycle actions: `all` includes
   * delegated sub-agents in the walk, `top-level` cycles foreground agents
   * only. Defaults per `DEFAULT_CYCLE_SCOPES` in
   * `$features/hardware-console/actions/cycle-scope`.
   */
  cycleScopeByFamily: Record<CycleScopeFamilyId, CycleScope>;
}

/** Shape of the `keyPins` field inside the `hardwareConsole.state` daemon bag. */
export type PersistedKeyPins = (string | null)[];

/** Shape of the `excludedWorkspaceIds` field inside the `hardwareConsole.state` daemon bag. */
export type PersistedExcludedWorkspaceIds = string[];

/**
 * Legacy shape of the `actionMapping` field inside the
 * `hardwareConsole.state` daemon bag (flat CM2 array, pre per-model).
 * Read as the CM2 fallback on hydration; new writes go to
 * `actionMappingByModel`.
 */
export type PersistedActionMapping = ActionKeyActionId[];

/** Shape of the `actionMappingByModel` field inside the `hardwareConsole.state` daemon bag. */
export type PersistedActionMappingsByModel = Partial<
  Record<HardwareDeviceModel, ActionKeyActionId[]>
>;

/** Shape of the `cycleScopeByFamily` field inside the `hardwareConsole.state` daemon bag. */
export type PersistedCycleScopeByFamily = Partial<Record<CycleScopeFamilyId, CycleScope>>;
