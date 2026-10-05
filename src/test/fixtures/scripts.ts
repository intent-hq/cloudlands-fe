import type { ScriptWithState } from '$features/scripts/types';

/** Synthetic equivalent of the approved 984-command / 19-service scale fixture. */
export function makeScriptsFixture(): ScriptWithState[] {
  return Array.from({ length: 1003 }, (_, index) => ({
    id: `synthetic-${index}`,
    workspaceId: 'synthetic-history',
    name: index < 984 ? `Validation ${String(index).padStart(4, '0')}` : `Service ${index - 984}`,
    command: index < 984 ? `printf 'synthetic check ${index}'` : 'printf synthetic-service',
    mode: index < 984 ? 'command' : 'service',
    source: 'user',
    purpose: 'saved',
    createdAt: '2026-09-01T00:00:00Z',
    runtime: { status: 'idle', restartCount: 0 },
  }));
}
