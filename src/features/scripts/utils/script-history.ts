import type { ScriptWithState } from '../types';
import { isLiveScriptStatus } from './script-status';

export function canArchiveScript(script: ScriptWithState): boolean {
  return (
    !script.archivedAt && script.mode === 'command' && !isLiveScriptStatus(script.runtime?.status)
  );
}

export function historyNeedsAttention(script: ScriptWithState): boolean {
  return !!script.archivedAt && !!script.lastRun && script.lastRun.outcome !== 'succeeded';
}

export function searchScripts(scripts: ScriptWithState[], query: string): ScriptWithState[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return scripts.filter((script) => {
    const text = [
      script.name,
      script.command,
      script.lastRun?.outcome,
      script.lastRun?.error,
      script.runtime.error,
      script.id,
    ]
      .join(' ')
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
