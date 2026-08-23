/**
 * Serializable projection of a native ACP `plan` session update (the
 * `planManager` source in `src/features/acp-official/plans/plan-manager.ts`).
 * Only canonical plan facts are stored — presentation extras (icons, colors,
 * timings) stay out of Redux.
 */
export interface NativePlanEntry {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  children?: NativePlanEntry[];
}

/** Per-session native plan state, keyed by the ACP session identifier. */
export interface NativePlanSessionState {
  entries: NativePlanEntry[];
}

export interface NativePlansState {
  bySessionId: Record<string, NativePlanSessionState>;
}
