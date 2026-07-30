/**
 * Fleet HUD shared types — the agent state buckets rendered by the AGENTS
 * panel state bars (mock: running / waiting / done / failed / idle).
 */

/** Mock-faithful agent state buckets for the AGENTS panel. */
export const HUD_AGENT_STATE_BUCKETS = [
  "running",
  "waiting",
  "done",
  "failed",
  "idle",
] as const;

export type HudAgentStateBucket = (typeof HUD_AGENT_STATE_BUCKETS)[number];

/**
 * Bucket a wire agent status (`agentSummary.agents[].status`, PROTOCOL §5.1 —
 * same strings as `agent.list`) into a HUD state bar. The wire carries both
 * current lowercase values (`active`, `idle`, `error`, …) and legacy
 * PascalCase ones (`Waiting`, `Completed`, `Processing`); compare
 * case-insensitively. Unknown statuses fall back to `idle`.
 */
export function toHudAgentStateBucket(status: string): HudAgentStateBucket {
  switch (status.toLowerCase()) {
    case "active":
    case "processing":
    case "responding":
      return "running";
    case "pending":
    case "waiting":
      return "waiting";
    case "completed":
      return "done";
    case "error":
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}
