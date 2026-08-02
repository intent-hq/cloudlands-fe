/**
 * Regression tests for the id-space mismatch behind intent-hq/monorepo#1330.
 *
 * The DaemonTerminalRegistry keys terminals by LOCAL id; the daemon id lives
 * only in the `byDaemonId` map used for event routing. Renderer hydration
 * (`loadWorkspaceTerminals` fed by daemon `terminal.list`) rekeys tabs to
 * DAEMON ids, so a reconnect that arrives at PROFESSIONAL_CREATE with the
 * daemon id as `terminalId` misses `registry.getTerminal(providedId)` and
 * spawns a brand-new PTY instead of reattaching to the live one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  backendRequest: vi.fn(),
  clientOn: vi.fn(),
  mainDispatch: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.backendRequest, on: mocks.clientOn }),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$features/workspace/main/workspace.service', () => ({
  workspaceService: { getWorkspace: vi.fn(async () => ({ ok: false })) },
}));

vi.mock('$shared/main/config', () => ({
  WorkspaceConfig: { paths: { workspace: (id: string) => `/tmp/${id}` } },
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  mainDispatch: mocks.mainDispatch,
}));

const WS = 'amber-forest';
const CWD = os.tmpdir();

async function setup() {
  const { registerTerminalHandlers } = await import('../terminal.ipc');
  registerTerminalHandlers();
  const create = mocks.handlers.get('terminal:professional:create');
  const list = mocks.handlers.get('terminal:professional:list');
  if (!create || !list) throw new Error('terminal professional handlers not registered');
  return { create, list };
}

function countCreateCalls(): number {
  return mocks.backendRequest.mock.calls.filter(([method]) => method === 'terminal.create')
    .length;
}

describe('terminal.ipc PROFESSIONAL_CREATE reconnect (monorepo#1330)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    let ptySeq = 0;
    mocks.backendRequest.mockImplementation(async (method: string) => {
      switch (method) {
        case 'terminal.create':
          ptySeq += 1;
          return { terminalId: `daemon-pty-${ptySeq}` };
        case 'events.subscribe':
          return { subscriptionId: 'sub-1' };
        default:
          return {};
      }
    });
  });

  it('reconnects when the caller passes the original local id (working baseline)', async () => {
    const { create } = await setup();

    const first = await create({}, { terminalId: 'terminal-local-1', workspaceId: WS, cwd: CWD });
    expect(first).toMatchObject({ success: true, terminalId: 'terminal-local-1' });
    expect(countCreateCalls()).toBe(1);

    const second = await create({}, { terminalId: 'terminal-local-1', workspaceId: WS, cwd: CWD });
    expect(second).toMatchObject({ success: true, terminalId: 'terminal-local-1', reconnected: true });
    expect(countCreateCalls()).toBe(1);
  });

  it('reattaches (not respawns) when the caller passes the DAEMON id after hydration rekeyed the tab', async () => {
    const { create } = await setup();

    // Original spawn under a renderer-local id; the daemon assigns daemon-pty-1.
    await create({}, { terminalId: 'terminal-local-1', workspaceId: WS, cwd: CWD });
    expect(countCreateCalls()).toBe(1);

    // Workspace switch: hydration rekeys the renderer tab to the daemon id
    // (`terminal.list` returns daemon ids), so the reconnect arrives with it.
    const result = await create({}, { terminalId: 'daemon-pty-1', workspaceId: WS, cwd: CWD });

    // BUG: registry.getTerminal('daemon-pty-1') misses (registry keys by local
    // id; byDaemonId is only consulted for event routing), so a second PTY is
    // spawned — the "fresh session, no scrollback" symptom.
    // The reattach must also return the registry's LOCAL id — the canonical
    // key `terminal:data`/`terminal:exit` events are emitted under — so a
    // caller filtering the event stream by the returned id sees the events.
    expect(result).toMatchObject({
      success: true,
      terminalId: 'terminal-local-1',
      reconnected: true,
    });
    expect(countCreateCalls()).toBe(1);
  });
});
