import type { MutationResult } from './client-types';

/**
 * PROTOCOL §8 permission-response outcome carried by `agent.respondPermission`.
 * `selected` picks one of the request's `options[]` by id; `cancelled` unblocks
 * the agent without choosing any option.
 */
export type PermissionOutcome =
  { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };

/**
 * `agent.respondPermission` outcome (PROTOCOL §8). The daemon returns
 * `{ resolved: bool }` — `false` when the prompt is already gone (timed out or
 * answered elsewhere). Folded onto MutationResult so callers can check
 * `success` uniformly with the other `agent.*` arms; `resolved` is surfaced
 * only when the daemon returned a value.
 */
export interface RespondPermissionResult extends MutationResult {
  resolved?: boolean;
}

/** Canonical permission response contract shared by renderer host clients. */
export interface PermissionResponder {
  /**
   * Resolve an outstanding interactive permission prompt
   * (`agent.respondPermission`, PROTOCOL §8). The daemon forwards the chosen
   * `outcome` to the blocked provider and emits `agent:permission:resolved`;
   * the result carries `resolved: false` when no matching pending prompt was
   * found (e.g. it already timed out or was answered elsewhere). Transport /
   * daemon errors fold into `{ success: false, error }` so callers can decide
   * whether to keep the prompt visible for a retry.
   */
  respondPermission(
    requestId: string,
    outcome: PermissionOutcome,
    workspaceId?: string,
  ): Promise<RespondPermissionResult>;
}
