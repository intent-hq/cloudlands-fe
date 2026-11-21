import type {
  UnslothServerWirePayload,
  UnslothStatusWirePayload,
} from '$store/renderer/slices/daemon-health/daemon-health-types';

/** Running servers; a missing or empty list falls back to the top-level server. */
export function unslothServerRows(
  status: UnslothStatusWirePayload | null | undefined,
): UnslothServerWirePayload[] {
  if (!status?.running) return [];
  return status.servers?.length ? status.servers : [status];
}

export type UnslothStopPlan =
  /** `repoId` stops one model; omitted, the daemon's one server stops. */
  | { stopsAll: false; repoId?: string; attachedAgentCount: number }
  /** A daemon without stopByModel stops every server, whatever the row. */
  | { stopsAll: true; serverCount: number; attachedAgentCount: number };

/**
 * What stopping `repoId`'s row does, decided when the dialog opens so a later
 * poll cannot widen the stop. Older daemons ignore `repoId` and stop every server.
 */
export function planUnslothStop(
  status: UnslothStatusWirePayload | null | undefined,
  repoId: string | undefined,
): UnslothStopPlan {
  const rows = unslothServerRows(status);
  if (status?.stopByModel === true && repoId) {
    const row = rows.find((server) => server.repoId === repoId);
    return { stopsAll: false, repoId, attachedAgentCount: row?.attachedAgentCount ?? 0 };
  }
  const attachedAgentCount = rows.reduce((sum, row) => sum + (row.attachedAgentCount ?? 0), 0);
  return rows.length > 1
    ? { stopsAll: true, serverCount: rows.length, attachedAgentCount }
    : { stopsAll: false, attachedAgentCount };
}

/** The agents a stop would cut off: live while the server is listed, else as planned. */
export function stopAgentCount(
  plan: UnslothStopPlan,
  model: string | undefined,
  rows: UnslothServerWirePayload[],
): number {
  if (plan.stopsAll) return plan.attachedAgentCount;
  const row = model ? rows.find((server) => server.repoId === model) : undefined;
  return row?.attachedAgentCount ?? plan.attachedAgentCount;
}
