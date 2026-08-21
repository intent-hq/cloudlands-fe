/**
 * Dev-only workspace-switch timing instrumentation.
 *
 * Records `performance.mark`/`performance.measure` entries around the
 * transcript reveal-gate inputs (hydration, seq-0 snapshot, utility-footer
 * data seeds) and emits ONE consolidated log line per agent view once the
 * reveal condition is met. Pure module-level bookkeeping — no Redux state,
 * no behavior change; every entry point no-ops outside dev builds.
 *
 * t=0 is the first of `initializeChatRequested` / `markAgentAsViewed` for the
 * agent; the two triggers fire back-to-back on a view switch and merge into
 * one record via `VIEW_MERGE_WINDOW_MS`.
 */
import { ClientLogger } from '$lib/utils/client-logger';

// Debug level so the consolidated line survives the default 'info' filter (dev-only anyway).
const logger = new ClientLogger({ name: 'SwitchTiming', level: 'debug' });

/** A second begin() for the same agent inside this window merges into the open record. */
export const VIEW_MERGE_WINDOW_MS = 1000;
/** Workspace seeds older than t0 minus this slack are treated as cached and omitted. */
export const SEED_RELEVANCE_SLACK_MS = 2000;

export type SwitchTrigger = 'initialize' | 'viewed';
export type GateName =
  | 'hydrationStarted'
  | 'hydrationSettled'
  | 'hydrationFailed'
  | 'snapshotApplied'
  | 'footerReady'
  | 'revealTimedOut'
  | 'subscriptionsFetched';
export type SeedName =
  'hooksSeedStarted' | 'hooksSeedDelivered' | 'prSeedStarted' | 'prSeedDelivered';
export type SwitchOutcome = 'revealed' | 'revealed-after-timeout' | 'hydration-failed';

export interface SwitchTimingSummary {
  agentId: string;
  workspaceId: string | undefined;
  trigger: SwitchTrigger;
  outcome: SwitchOutcome;
  /** t=0 → finalize, ms. */
  revealMs: number;
  /** Gate settle deltas from t=0, ms. */
  gates: Partial<Record<GateName, number>>;
  /** Workspace seed deltas from t=0, ms (relevant seeds only; stale ones omitted). */
  seeds: Partial<Record<SeedName, number>>;
}

interface ViewRecord {
  agentId: string;
  workspaceId: string | undefined;
  trigger: SwitchTrigger;
  t0: number;
  gates: Partial<Record<GateName, number>>;
}

const openViews = new Map<string, ViewRecord>();
const workspaceSeeds = new Map<string, Partial<Record<SeedName, number>>>();

export function isSwitchTimingEnabled(): boolean {
  return !!import.meta.env.DEV;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const startMarkName = (agentId: string): string => `ws-switch:${agentId}:start`;

function safeMark(name: string): void {
  if (typeof performance === 'undefined') return;
  try {
    performance.clearMarks(name);
    performance.mark(name);
  } catch {
    // Performance API unavailable or restricted — timing still logs.
  }
}

function safeMeasure(name: string, startMark: string): void {
  if (typeof performance === 'undefined') return;
  try {
    performance.clearMeasures(name);
    performance.measure(name, startMark);
  } catch {
    // Start mark may have been cleared (e.g. buffer reset) — skip the measure.
  }
}

/** Open (or merge into) the timing record for an agent view. Called at t=0 triggers. */
export function beginAgentView(
  agentId: string,
  workspaceId: string | undefined,
  trigger: SwitchTrigger,
): void {
  if (!isSwitchTimingEnabled() || !agentId) return;
  const t = now();
  const existing = openViews.get(agentId);
  if (existing && t - existing.t0 <= VIEW_MERGE_WINDOW_MS) {
    if (!existing.workspaceId && workspaceId) existing.workspaceId = workspaceId;
    return;
  }
  openViews.set(agentId, { agentId, workspaceId, trigger, t0: t, gates: {} });
  safeMark(startMarkName(agentId));
}

export function hasOpenAgentView(agentId: string): boolean {
  return openViews.has(agentId);
}

/** Record a reveal-gate settle for an open view (first occurrence wins). */
export function markAgentGate(agentId: string, gate: GateName): void {
  if (!isSwitchTimingEnabled()) return;
  const record = openViews.get(agentId);
  if (!record || record.gates[gate] !== undefined) return;
  record.gates[gate] = now();
  safeMark(`ws-switch:${agentId}:${gate}`);
}

/** Record a workspace-scoped data seed event (hooks / PR monitors). */
export function markWorkspaceSeed(workspaceId: string | undefined, seed: SeedName): void {
  if (!isSwitchTimingEnabled() || !workspaceId) return;
  let seeds = workspaceSeeds.get(workspaceId);
  if (!seeds) {
    seeds = {};
    workspaceSeeds.set(workspaceId, seeds);
  }
  seeds[seed] = now();
  if (seed === 'hooksSeedStarted') delete seeds.hooksSeedDelivered;
  if (seed === 'prSeedStarted') delete seeds.prSeedDelivered;
  safeMark(`ws-switch-seed:${workspaceId}:${seed}`);
}

/** Drop an open view without logging (subscription teardown / view abandoned). */
export function discardAgentView(agentId: string): void {
  openViews.delete(agentId);
}

/**
 * Close the open view: measure t=0 → now, log ONE consolidated line, and
 * return the summary (null when no view is open for the agent).
 */
export function finalizeAgentView(agentId: string): SwitchTimingSummary | null {
  if (!isSwitchTimingEnabled()) return null;
  const record = openViews.get(agentId);
  if (!record) return null;
  openViews.delete(agentId);
  const t = now();

  const gates: Partial<Record<GateName, number>> = {};
  for (const [gate, at] of Object.entries(record.gates) as [GateName, number][]) {
    gates[gate] = round1(at - record.t0);
  }

  const seeds: Partial<Record<SeedName, number>> = {};
  const wsSeeds = record.workspaceId ? workspaceSeeds.get(record.workspaceId) : undefined;
  if (wsSeeds) {
    for (const [seed, at] of Object.entries(wsSeeds) as [SeedName, number][]) {
      if (at >= record.t0 - SEED_RELEVANCE_SLACK_MS) seeds[seed] = round1(at - record.t0);
    }
  }

  const outcome: SwitchOutcome =
    record.gates.hydrationFailed !== undefined
      ? 'hydration-failed'
      : record.gates.revealTimedOut !== undefined
        ? 'revealed-after-timeout'
        : 'revealed';

  const summary: SwitchTimingSummary = {
    agentId,
    workspaceId: record.workspaceId,
    trigger: record.trigger,
    outcome,
    revealMs: round1(t - record.t0),
    gates,
    seeds,
  };
  safeMeasure(`ws-switch:${agentId}:reveal`, startMarkName(agentId));
  logger.debug(
    `workspace-switch ${agentId} ${summary.outcome} in ${summary.revealMs}ms (trigger=${summary.trigger})`,
    { workspaceId: summary.workspaceId, gates: summary.gates, seeds: summary.seeds },
  );
  return summary;
}

/** Test helper: clear all open views and workspace seeds. */
export function resetSwitchTiming(): void {
  openViews.clear();
  workspaceSeeds.clear();
}
