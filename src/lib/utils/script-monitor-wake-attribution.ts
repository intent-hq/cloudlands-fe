/** Structured daemon attribution only: script output never supplies an attribution prefix. */
export interface ScriptMonitorWakeAttribution {
  scriptName: string;
  scriptId: string;
  runId: string;
  monitorId: string;
  workspaceId: string;
  reason: 'finished' | 'ttl-expired' | 'output-match' | 'line-count';
  matchedLine?: string;
}
export function getScriptMonitorWakeAttribution(
  metadata: unknown,
): ScriptMonitorWakeAttribution | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = metadata as Record<string, unknown>;
  if (value.type !== 'script_monitor_wake' || value.source !== 'system') return null;
  const { scriptName, scriptId, runId, monitorId, workspaceId, reason } = value;
  if (
    typeof scriptName !== 'string' ||
    typeof scriptId !== 'string' ||
    !scriptId ||
    typeof runId !== 'string' ||
    !runId ||
    typeof monitorId !== 'string' ||
    !monitorId ||
    typeof workspaceId !== 'string' ||
    !workspaceId
  )
    return null;
  if (
    reason !== 'finished' &&
    reason !== 'ttl-expired' &&
    reason !== 'output-match' &&
    reason !== 'line-count'
  )
    return null;
  const trigger = value.trigger as { matchedLine?: unknown } | undefined;
  return {
    scriptName,
    scriptId,
    runId,
    monitorId,
    workspaceId,
    reason,
    ...(reason === 'output-match' && typeof trigger?.matchedLine === 'string'
      ? { matchedLine: trigger.matchedLine }
      : {}),
  };
}
