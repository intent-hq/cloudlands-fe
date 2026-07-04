import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScriptWithState } from './types';

// FAKE seams: the daemon script.list (via appClient.scripts) and the raw IPC
// invoke boundary are both mocked, so no call reaches a real daemon or the
// mock router. The tests assert the exact save-to-repo wire payload: the
// scripts array MUST be sourced from the live daemon list (the legacy local
// store is empty in daemon builds — forwarding nothing is what clobbered
// .intent/config.json with `scripts: []`).
const { scriptsList, invokeIpc } = vi.hoisted(() => ({
  scriptsList: vi.fn<(workspaceId: string) => Promise<unknown[]>>(() => Promise.resolve([])),
  invokeIpc: vi.fn(() => Promise.resolve({ success: true, written: true })),
}));
vi.mock('$lib/client', () => ({
  appClient: { scripts: { list: scriptsList } },
}));
vi.mock('../../shared/generated/ipc-client', () => ({
  invoke: invokeIpc,
}));

import { scriptsClient } from './scripts.client';

function liveScript(overrides: Partial<ScriptWithState> = {}): ScriptWithState {
  return {
    id: 'script-1',
    workspaceId: 'ws-1',
    name: 'dev',
    command: 'pnpm dev',
    mode: 'service',
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    state: { status: 'idle' },
    ...overrides,
  } as ScriptWithState;
}

describe('scriptsClient.saveToRepo (fake daemon list + IPC seam)', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends the live daemon script.list as the save-to-repo payload, stripping runtime fields', async () => {
    scriptsList.mockResolvedValueOnce([
      liveScript({
        id: 'script-dev',
        name: 'dev',
        command: 'pnpm dev',
        mode: 'service',
        category: 'dev',
        cwd: 'packages/app',
        env: { NODE_ENV: 'development' },
        autoStart: true,
      }),
      liveScript({ id: 'script-test', name: 'test', command: 'pnpm test', mode: 'command' }),
    ]);

    const result = await scriptsClient.saveToRepo('ws-1');

    expect(scriptsList).toHaveBeenCalledWith('ws-1');
    expect(invokeIpc).toHaveBeenCalledWith('scripts:save-to-repo', {
      workspaceId: 'ws-1',
      scripts: [
        {
          name: 'dev',
          command: 'pnpm dev',
          mode: 'service',
          category: 'dev',
          cwd: 'packages/app',
          env: { NODE_ENV: 'development' },
          autoStart: true,
        },
        { name: 'test', command: 'pnpm test', mode: 'command' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('omits undefined optional fields instead of shipping explicit undefined', async () => {
    scriptsList.mockResolvedValueOnce([liveScript()]);

    await scriptsClient.saveToRepo('ws-1');

    const [, payload] = invokeIpc.mock.calls[0] as [string, { scripts: object[] }];
    expect(payload.scripts[0]).toEqual({ name: 'dev', command: 'pnpm dev', mode: 'service' });
    expect(payload.scripts[0]).not.toHaveProperty('category');
    expect(payload.scripts[0]).not.toHaveProperty('cwd');
    expect(payload.scripts[0]).not.toHaveProperty('env');
    expect(payload.scripts[0]).not.toHaveProperty('autoStart');
  });

  it('forwards an empty live list verbatim (main handler treats it as a no-op)', async () => {
    scriptsList.mockResolvedValueOnce([]);

    await scriptsClient.saveToRepo('ws-1');

    expect(invokeIpc).toHaveBeenCalledWith('scripts:save-to-repo', {
      workspaceId: 'ws-1',
      scripts: [],
    });
  });

  it('surfaces the handler failure envelope without masking it as success', async () => {
    scriptsList.mockResolvedValueOnce([liveScript()]);
    invokeIpc.mockResolvedValueOnce({ success: false, error: 'disk full' });

    const result = await scriptsClient.saveToRepo('ws-1');

    expect(result).toEqual({ success: false, error: 'disk full' });
  });
});
