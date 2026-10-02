import { z } from 'zod';
import type { ScriptRuntimeState, ScriptWithState } from '../types';

const runtimeSchema = z
  .object({
    status: z.enum(['idle', 'starting', 'running', 'restarting', 'exited']),
    restartCount: z.number().int().nonnegative(),
    pid: z.number().int().optional(),
    exitCode: z.number().int().optional(),
    startedAt: z.string().optional(),
    stoppedAt: z.string().optional(),
    error: z.string().optional(),
    detectedUrl: z.string().optional(),
    previouslyRunning: z.boolean().optional(),
  })
  .passthrough();
const snapshotSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    command: z.string(),
    mode: z.enum(['command', 'service']),
    purpose: z.enum(['oneOff', 'saved']),
    source: z.string(),
    createdAt: z.string(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    category: z.string().optional(),
    autoStart: z.boolean().optional(),
    updatedAt: z.string().optional(),
    lastRunAt: z.string().optional(),
    archivedAt: z.string().optional(),
    lastRun: z
      .object({
        outcome: z.enum(['succeeded', 'failed', 'cancelled', 'interrupted']),
        stoppedAt: z.string(),
        startedAt: z.string().optional(),
        exitCode: z.number().int().optional(),
        error: z.string().optional(),
      })
      .passthrough()
      .optional(),
    runtime: runtimeSchema,
  })
  .passthrough();

export function scriptRuntimeSnapshot(value: unknown): ScriptRuntimeState | undefined {
  const parsed = runtimeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Only complete, identity-matched rows can replace the cached definition/runtime. */
export function scriptChangeSnapshot(
  value: unknown,
  workspaceId: string,
  scriptId: unknown,
): ScriptWithState | undefined {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success && parsed.data.id === scriptId && parsed.data.workspaceId === workspaceId
    ? parsed.data
    : undefined;
}

export type ScriptReadChange =
  | { kind: 'snapshot'; script: ScriptWithState }
  | { kind: 'read'; script: ScriptWithState }
  | { kind: 'allIds'; ids: string[] }
  | { kind: 'removed'; scriptId: string }
  | { kind: 'runtime'; scriptId: string; partial: Partial<ScriptRuntimeState>; replace?: boolean };

/** Replay only events observed after the read began, in live publication order. */
export function replayScriptRead(
  entries: ScriptWithState[],
  changes: ScriptReadChange[],
): ScriptWithState[] {
  const rows = new Map(entries.map((entry) => [entry.id, entry]));
  for (const change of changes) {
    if (change.kind === 'snapshot') rows.set(change.script.id, change.script);
    else if (change.kind === 'read') {
      // A newer viewer read can replace a returned row, but cannot invent
      // membership in an older active-list response that omitted it.
      if (rows.has(change.script.id)) rows.set(change.script.id, change.script);
    } else if (change.kind === 'allIds') {
      const ids = new Set(change.ids);
      for (const id of rows.keys()) if (!ids.has(id)) rows.delete(id);
    } else if (change.kind === 'removed') rows.delete(change.scriptId);
    else {
      const row = rows.get(change.scriptId);
      if (row)
        rows.set(row.id, {
          ...row,
          runtime: change.replace
            ? (change.partial as ScriptRuntimeState)
            : { ...row.runtime, ...change.partial },
        });
    }
  }
  return [...rows.values()];
}
