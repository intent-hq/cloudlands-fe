/**
 * @vitest-environment jsdom
 *
 * A machine run publishes no output events, so its viewer reads
 * `script.output { remoteAgentId }` itself: on open and on each run change,
 * and every few seconds while the run is live, one read at a time.
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import {
  scriptOutputSnapshotReceived,
  setScriptsData,
} from '$store/renderer/slices/scripts/scripts-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import type { ScriptMachineRun } from '../types';
import MachineRunOutput from './MachineRunOutput.svelte';

const WS = 'ws-machine-output';
const ID = 'dev';

const running: ScriptMachineRun = {
  remoteAgentId: 'agent-remote',
  nodeId: 'node-mac',
  runtime: { status: 'running', restartCount: 0, startedAt: '2026-11-03T08:00:00Z' },
};

function requests(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls
    .map(([action]) => action as { type: string; payload: unknown[] })
    .filter((action) => action.type === 'scripts/outputRequested');
}

function viewerId(): string {
  return Object.keys(store.state.scripts.byWorkspaceId[WS]?.retainedOutputs ?? {})[0];
}

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  store.dispatch(
    setScriptsData(WS, [
      {
        id: ID,
        workspaceId: WS,
        name: 'dev',
        command: 'pnpm dev',
        mode: 'service',
        source: 'user',
        createdAt: '2026-11-03T00:00:00Z',
        runtime: { status: 'idle', restartCount: 0 },
        machineRuns: [running],
      },
    ]),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MachineRunOutput', () => {
  it("reads the remote agent's run and shows it as plain text", async () => {
    const spy = vi.spyOn(store, 'dispatch');
    const { container } = render(MachineRunOutput, {
      workspaceId: WS,
      scriptId: ID,
      run: running,
    });
    expect(
      requests(spy).map((action) => [action.payload[0], action.payload[1], action.payload[3]]),
    ).toEqual([[WS, ID, 'agent-remote']]);

    store.dispatch(
      scriptOutputSnapshotReceived(WS, ID, viewerId(), '\x1b[32mready\x1b[0m\nlistening'),
    );
    await vi.waitFor(() =>
      expect(container.querySelector('pre')?.textContent).toBe('ready\nlistening'),
    );
  });

  it('re-reads while live without overlapping reads, and releases its read on close', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(store, 'dispatch');
    const view = render(MachineRunOutput, { workspaceId: WS, scriptId: ID, run: running });
    expect(requests(spy)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(requests(spy)).toHaveLength(1);

    store.dispatch(scriptOutputSnapshotReceived(WS, ID, viewerId(), 'first'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(requests(spy)).toHaveLength(2);
    expect(view.container.querySelector('pre')?.textContent).toBe('first');

    view.unmount();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/outputReleased',
        payload: [WS, ID, expect.any(String)],
      }),
    );
  });

  it('stops polling once the run has stopped', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(store, 'dispatch');
    const stopped = {
      ...running,
      runtime: { status: 'exited' as const, exitCode: 0, restartCount: 0 },
    };
    render(MachineRunOutput, { workspaceId: WS, scriptId: ID, run: stopped });
    store.dispatch(scriptOutputSnapshotReceived(WS, ID, viewerId(), 'done'));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(requests(spy)).toHaveLength(1);
  });

  it('re-reads when the run changes even while an earlier read is still pending', async () => {
    const spy = vi.spyOn(store, 'dispatch');
    const starting = { ...running, runtime: { status: 'starting' as const, restartCount: 0 } };
    const view = render(MachineRunOutput, { workspaceId: WS, scriptId: ID, run: starting });
    expect(requests(spy)).toHaveLength(1);
    await view.rerender({ run: running });
    expect(requests(spy)).toHaveLength(2);
  });

  it('retries a read the saga discarded instead of staying on loading', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(store, 'dispatch');
    const stopped = {
      ...running,
      runtime: { status: 'exited' as const, exitCode: 0, restartCount: 0 },
    };
    render(MachineRunOutput, { workspaceId: WS, scriptId: ID, run: stopped });
    expect(requests(spy)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(requests(spy)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(requests(spy).length).toBeGreaterThanOrEqual(2);
  });
});
