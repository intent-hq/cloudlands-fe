/**
 * Agent Overview Types
 *
 * State types for the agent-overview Redux slice.
 * Safe to import from any process.
 */

import type { InteractionEvent } from '$lib/components/agent-overview/types';

/**
 * Per-workspace state for the agent overview visualization.
 * Agent sessions are derived from the canonical agent-session slice via selectors.
 */
export type AgentOverviewWorkspaceState = {
  /** Interaction events extracted from workspace events */
  events: InteractionEvent[];
  /** Current time position for scrubbing (ISO string) */
  currentTime: string;
  /** Whether playing live updates */
  isLive: boolean;
};

/**
 * Root state for the agent-overview slice.
 * Workspace-scoped via byWorkspaceId.
 */
export type AgentOverviewState = {
  byWorkspaceId: Record<string, AgentOverviewWorkspaceState>;
};

