import { describe, expect, it } from 'vitest';
import type { ScriptWithState } from '../types';
import { getRunningScriptBrowserTarget } from './running-script-browser-target';

function script(
  id: string,
  status: ScriptWithState['runtime']['status'],
  detectedUrl?: string,
  startedAt?: string,
): ScriptWithState {
  return {
    id,
    workspaceId: 'workspace-1',
    name: `Script ${id}`,
    command: `run ${id}`,
    mode: 'service',
    source: 'user',
    createdAt: '2026-07-28T00:00:00.000Z',
    runtime: { status, restartCount: 0, detectedUrl, startedAt },
  };
}

describe('running script browser target', () => {
  it('returns the newest running script with a detected URL', () => {
    expect(
      getRunningScriptBrowserTarget([
        script('older', 'running', 'http://localhost:3000', '2026-07-28T01:00:00.000Z'),
        script('idle', 'idle', 'http://localhost:4000', '2026-07-28T03:00:00.000Z'),
        script('newer', 'running', 'http://localhost:5173', '2026-07-28T02:00:00.000Z'),
      ]),
    ).toEqual({
      scriptId: 'newer',
      name: 'Script newer',
      url: 'http://localhost:5173',
    });
  });

  it('ignores stopped scripts and running scripts without a URL', () => {
    expect(
      getRunningScriptBrowserTarget([
        script('idle', 'idle', 'http://localhost:3000'),
        script('no-url', 'running'),
      ]),
    ).toBeNull();
  });
});
