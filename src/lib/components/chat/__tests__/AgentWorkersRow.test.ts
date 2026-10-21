/** Real worker channel, saga, selectors, row and card. Only the daemon is mocked (§5.5b). */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
  type BackendNotification,
} from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { agentWorkersSaga } from '$store/renderer/slices/agent-workers/sagas/agent-workers-saga';
import {
  agentWorkersSubscribeRequested,
  agentWorkersUnsubscribeRequested,
} from '$store/renderer/slices/agent-workers/agent-workers-slice';
import { selectAgentWorkers } from '$store/renderer/slices/agent-workers/agent-workers-selectors';
import { removeWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { setSubscriptionSnapshot } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { notify } from '$lib/components/patterns/notify';
import {
  workerFixture,
  workerSnapshotFixture,
} from '$features/agent-workers/agent-workers.fixture';
import type { WorkerObservation, WorkerSnapshot } from '$features/agent-workers/types';
import AgentWorkersRow from '../AgentWorkersRow.svelte';
import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';
import { setEventSubscriptionsExpanded } from '../agent-subscriptions-view-state';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn().mockResolvedValue({ subscriptionId: 'events' }),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/MockAgentEventSection.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/MockHookEventSection.svelte')).default,
}));
vi.mock('../MonitoredPrsRow.svelte', async () => ({
  default: (await import('./mocks/MockPrEventSection.svelte')).default,
}));

const ws = workerSnapshotFixture.workspaceId;
const agent = workerSnapshotFixture.agentId;
const taskId = workerFixture.identity.asyncTaskId;
const listeners = new Set<(n: BackendNotification) => void>();
let stopSaga: () => void;
let seq = 0;
let stopAnswer: () => Promise<unknown>;

const snapshot = (workers: WorkerObservation[]): WorkerSnapshot => ({
  ...workerSnapshotFixture,
  workers,
});
function push(next: WorkerSnapshot) {
  for (const fn of listeners)
    fn({
      method: 'subscription.push',
      params: { subscriptionId: 'workers-sub', kind: 'snapshot', seq: seq++, snapshot: next },
    });
}
const status = () => selectAgentWorkers.select(store.state, ws, agent).status;

beforeAll(() => store.init());
beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  seq = 0;
  stopAnswer = async () => ({ asyncTaskId: taskId, stopped: true });
  vi.mocked(onBackendNotification).mockImplementation((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  });
  vi.mocked(onBackendReconnected).mockImplementation(() => vi.fn());
  vi.mocked(backendRequest).mockImplementation(async (method) => {
    if (method === 'client.hello') return { server: { capabilities: { agentWorkers: 1 } } };
    if (method === 'agent.workers.subscribe') return { subscriptionId: 'workers-sub' };
    if (method === 'agent.workers.stop') return stopAnswer();
    return undefined;
  });
  stopSaga = store.runSaga(agentWorkersSaga);
});
afterEach(() => {
  cleanup();
  store.dispatch(agentWorkersUnsubscribeRequested(ws, agent));
  stopSaga();
  store.dispatch(removeWorkspaceEntity(ws));
});

async function mountRow() {
  store.dispatch(agentWorkersSubscribeRequested(ws, agent));
  render(AgentWorkersRow, { workspaceId: ws, agentId: agent });
  await waitFor(() =>
    expect(backendRequest).toHaveBeenCalledWith('agent.workers.subscribe', {
      workspaceId: ws,
      agentId: agent,
    }),
  );
}

describe('agent worker rows', () => {
  it('lists a running worker with its title, type and start time', async () => {
    await mountRow();
    push(snapshot([workerFixture]));
    const row = await screen.findByTestId('agent-worker-row');
    expect(row.textContent).toContain('Start the dev server');
    expect(within(row).getByTestId('agent-worker-state').textContent).toBe('Running');
    await fireEvent.click(within(row).getAllByRole('button', { name: 'Start the dev server' })[0]);
    expect(row.textContent).toContain('Type: shell');
    expect(row.textContent).toContain('Started');
    // The provider sends a task title, not the command line, so nothing offers it as one.
    expect(within(row).queryByRole('button', { name: /copy/i })).toBeNull();
  });

  it('stops through the provider, shows Stopping until the stopped report removes the row', async () => {
    let answer!: (value: unknown) => void;
    stopAnswer = () => new Promise((resolve) => (answer = resolve));
    await mountRow();
    push(snapshot([workerFixture]));
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Start the dev server' }),
    );
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
    await waitFor(() =>
      expect(backendRequest).toHaveBeenCalledWith('agent.workers.stop', {
        workspaceId: ws,
        agentId: agent,
        connectionGeneration: workerFixture.identity.connectionGeneration,
        asyncTaskId: taskId,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('agent-worker-state').textContent).toBe('Stopping…'),
    );
    push(snapshot([{ ...workerFixture, providerState: 'stopped', status: 'stopped' }]));
    answer({ asyncTaskId: taskId, stopped: true });
    await waitFor(() => expect(screen.queryByTestId('agent-worker-row')).toBeNull());
    expect(notify.info).not.toHaveBeenCalled();
  });

  it('reports a worker that had already ended, and a failed stop inline', async () => {
    stopAnswer = async () => ({ asyncTaskId: taskId, stopped: false });
    await mountRow();
    push(snapshot([workerFixture]));
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Start the dev server' }),
    );
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
    await waitFor(() =>
      expect(notify.info).toHaveBeenCalledWith('This background task had already ended.'),
    );

    stopAnswer = async () => {
      throw new Error('provider-error');
    };
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Start the dev server' }),
    );
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't stop this background task.",
    );
  });

  it('marks a worker unknown when the connection is lost and offers no Stop', async () => {
    await mountRow();
    push(snapshot([{ ...workerFixture, status: 'unknown', unknownReason: 'disconnected' }]));
    const row = await screen.findByTestId('agent-worker-row');
    expect(within(row).getByTestId('agent-worker-state').textContent).toBe('Connection lost');
    expect(within(row).queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('hides ended workers and a worker that cannot be stopped has no menu', async () => {
    await mountRow();
    push(
      snapshot([
        {
          ...workerFixture,
          identity: { ...workerFixture.identity, asyncTaskId: 'done' },
          status: 'completed',
          providerState: 'completed',
        },
        { ...workerFixture, canStop: false, name: 'nightly workflow', taskType: 'workflow' },
      ]),
    );
    const rows = await screen.findAllByTestId('agent-worker-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('nightly workflow');
    expect(within(rows[0]).queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('shows nothing when the daemon does not advertise agentWorkers', async () => {
    vi.mocked(backendRequest).mockImplementation(async (method) =>
      method === 'client.hello' ? { server: { capabilities: {} } } : undefined,
    );
    await mountRowWithoutSubscribe();
    await waitFor(() => expect(status()).toBe('unsupported'));
    expect(screen.queryByTestId('agent-worker-row')).toBeNull();
    expect(backendRequest).not.toHaveBeenCalledWith('agent.workers.subscribe', expect.anything());
  });

  it("counts running workers in the owning agent's chat card and holds the channel lease", async () => {
    store.dispatch(
      setSubscriptionSnapshot(ws, agent, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'idle',
      }),
    );
    setEventSubscriptionsExpanded(ws, agent, true);
    const card = within(
      render(EventSubscriptionsCard, { workspaceId: ws, agentId: agent }).container,
    );
    await waitFor(() => expect(status()).toBe('loading'));
    await waitFor(() =>
      expect(backendRequest).toHaveBeenCalledWith('agent.workers.subscribe', {
        workspaceId: ws,
        agentId: agent,
      }),
    );
    const area = () => card.getByTestId('subscription-utility-area');
    expect(area().getAttribute('data-has-subscriptions')).toBe('false');
    push(snapshot([workerFixture]));
    expect(await card.findByTestId('agent-worker-row')).toBeTruthy();
    expect(area().getAttribute('data-has-subscriptions')).toBe('true');
  });
});

async function mountRowWithoutSubscribe() {
  store.dispatch(agentWorkersSubscribeRequested(ws, agent));
  render(AgentWorkersRow, { workspaceId: ws, agentId: agent });
}
