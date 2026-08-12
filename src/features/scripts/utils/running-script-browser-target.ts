import type { ScriptWithState } from '../types';

export interface RunningScriptBrowserTarget {
  scriptId: string;
  name: string;
  url: string;
}

export function getRunningScriptBrowserTarget(
  scripts: ScriptWithState[],
): RunningScriptBrowserTarget | null {
  const candidates = scripts.filter(
    (script) => script.runtime.status === 'running' && script.runtime.detectedUrl?.trim(),
  );
  const script = candidates.sort((a, b) =>
    (b.runtime.startedAt ?? '').localeCompare(a.runtime.startedAt ?? ''),
  )[0];
  const url = script?.runtime.detectedUrl?.trim();
  if (!script || !url) return null;
  return {
    scriptId: script.id,
    name: script.name,
    url,
  };
}
