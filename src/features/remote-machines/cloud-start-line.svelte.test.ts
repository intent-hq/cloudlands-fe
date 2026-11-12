/**
 * @vitest-environment jsdom
 *
 * While an agent's cloud machine starts, the chat's working row shows the
 * start line in place of the turn's phase line ("Sent prompt…"). When the
 * machine is up, the phase line returns. A failed start shows only the failure
 * card. Agents on other machines keep the phase line and the notice below it.
 */
import { cleanup, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { cloudMachineChanged } from '$features/cloud-machines/cloud-machines-slice';
import type { RemoteMachine } from '$shared/types/remote-machines';
import CloudStartPhaseLineHost from './__tests__/CloudStartPhaseLineHost.svelte';
import { StartLineHosts } from './start-line-hosts.svelte';

const navigation = vi.hoisted(() => ({ navigateToSettings: vi.fn(async () => {}) }));
vi.mock('$lib/utils/workspace-navigation', () => navigation);

let AGENT = 'agent-cloud-0';
let seq = 0;

const SENT_PROMPT = [
  { phase: 'prompt', message: 'Sent prompt…', level: 'info' as const, timestamp: Date.now() },
];

const base = (extra: Partial<AgentSession>): AgentSession =>
  ({
    id: AgentId(AGENT),
    backendSessionId: null,
    workspaceId: WorkspaceId('ws-1'),
    name: 'Docs sweeper',
    status: AgentStatus.Processing,
    messages: [],
    createdAt: '2026-11-08T02:20:00Z',
    updatedAt: '2026-11-08T02:20:00Z',
    nodeName: 'E2B',
    placement: { target: 'e2b', checkout: 'isolated' },
    effectiveIsolation: 'isolated',
    ...extra,
  }) as AgentSession;

const seed = (agent: AgentSession) =>
  store.dispatch(bulkUpsertSessions([agent], { preserveExplicitRuntimeFlags: true }));

function mount(agent: AgentSession, isProcessing = true) {
  seed(agent);
  const view = render(CloudStartPhaseLineHost, {
    agentId: AGENT,
    isProcessing,
    statusEvents: SENT_PROMPT,
  });
  const row = view.getByTestId('working-row');
  const notice = view.getByTestId('conversation-notice');
  return { ...view, row, notice };
}

const phaseLine = (root: HTMLElement) =>
  root.querySelector('[data-testid="streaming-status-phase"]')?.textContent ?? null;
const startLines = (root: HTMLElement) =>
  root.querySelectorAll('[data-agent-placement-notice="starting"]');

beforeEach(() => {
  AGENT = `agent-cloud-${++seq}`;
  store.init();
  store.dispatch(backendReconnected());
});
afterEach(() => cleanup());

describe('cloud machine start line in the working row', () => {
  it('shows only the start line while the cloud machine starts', async () => {
    const { container, row, notice } = mount(
      base({ effectiveIsolation: 'pending', cloudStart: { step: 'creating-sandbox' } }),
    );
    await waitFor(() => expect(startLines(notice)).toHaveLength(0));
    expect(startLines(container)).toHaveLength(1);
    const line = startLines(row)[0] as HTMLElement;
    expect(line.dataset.placementPhaseLine).toBeDefined();
    expect(line.textContent).toContain('Starting cloud machine…');
    expect(line.textContent).toContain('Creating E2B sandbox');
    expect(container.textContent).not.toContain('Sent prompt…');
  });

  it('shows the start line while setup runs, with its output on request', async () => {
    const { row, notice } = mount(
      base({
        effectiveIsolation: 'pending',
        setup: { state: 'running', startedAt: '2026-11-08T02:20:05Z', output: 'pnpm install\n' },
      }),
    );
    await waitFor(() => expect(startLines(notice)).toHaveLength(0));
    const line = startLines(row)[0] as HTMLElement;
    expect(line.textContent).toContain('Running setup');
    within(line).getByRole('button', { name: 'Show output' }).click();
    await waitFor(() =>
      expect(within(line).getByRole('log').textContent).toContain('pnpm install'),
    );
  });

  it('brings back the phase line once the machine has started', async () => {
    const { container, row } = mount(
      base({ effectiveIsolation: 'pending', cloudStart: { step: 'connecting' } }),
    );
    await waitFor(() => expect(startLines(row)).toHaveLength(1));
    seed(base({ effectiveIsolation: 'isolated', cloudStart: undefined }));
    await waitFor(() => expect(phaseLine(row)).toBe('Sent prompt…'));
    expect(startLines(container)).toHaveLength(0);
  });

  it('shows only the failure card when the start fails', async () => {
    const { container } = mount(
      base({
        status: AgentStatus.Error,
        stopReason: 'the sandbox did not start',
        effectiveIsolation: 'pending',
        placementError: {
          code: 'remote-launch-failed',
          detail: `the sandbox did not start ${JSON.stringify({
            code: 'cloud-machine-unavailable',
            reason: 'bootstrap-failed',
            retryable: true,
          })}`,
        },
      }),
      false,
    );
    expect(container.querySelector('[data-cloud-start-failure]')).not.toBeNull();
    expect(container.querySelector('[data-testid="failure-recovery-card"]')).toBeNull();
    expect(startLines(container)).toHaveLength(0);
    expect(container.textContent).not.toContain('Sent prompt…');
  });

  it('keeps the start notice in the transcript when no turn is working', async () => {
    const { row, notice } = mount(
      base({ effectiveIsolation: 'pending', cloudStart: { step: 'starting-daemon' } }),
      false,
    );
    expect(startLines(row)).toHaveLength(0);
    expect(startLines(notice)).toHaveLength(1);
    expect(notice.textContent).toContain('Starting cloud machine…');
  });

  it('leaves an agent on another machine unchanged', async () => {
    const { row, notice } = mount(
      base({
        nodeId: 'node-mac',
        nodeName: 'Mac Studio',
        placement: { target: 'remote', checkout: 'isolated', os: 'macos', arch: 'aarch64' },
        effectiveIsolation: 'pending',
      }),
    );
    expect(phaseLine(row)).toBe('Sent prompt…');
    expect(startLines(row)).toHaveLength(0);
    expect(startLines(notice)).toHaveLength(1);
    expect(notice.textContent).toContain('Starting on Mac Studio…');
  });
});

describe('cloud machine start line as the turn changes', () => {
  const starting = () =>
    base({ effectiveIsolation: 'pending', cloudStart: { step: 'creating-sandbox' } });

  it('moves the start line back to the conversation when the turn stops mid-start', async () => {
    const { row, notice, rerender } = mount(starting());
    await waitFor(() => expect(startLines(notice)).toHaveLength(0));
    await rerender({ isProcessing: false });
    await waitFor(() => expect(startLines(notice)).toHaveLength(1));
    expect(startLines(row)).toHaveLength(0);
  });

  it('swaps the start line for the failure card when the start fails during the turn', async () => {
    const { container, row, rerender } = mount(starting());
    await waitFor(() => expect(startLines(row)).toHaveLength(1));
    seed(
      base({
        status: AgentStatus.Error,
        stopReason: 'E2B failed',
        effectiveIsolation: 'pending',
        cloudStart: undefined,
        placementError: {
          code: 'cloud-machine-unavailable',
          detail: `E2B failed ${JSON.stringify({
            code: 'cloud-machine-unavailable',
            reason: 'api-error',
            retryable: true,
          })}`,
        },
      }),
    );
    await rerender({ isProcessing: false });
    await waitFor(() =>
      expect(container.querySelector('[data-cloud-start-failure]')).not.toBeNull(),
    );
    expect(startLines(container)).toHaveLength(0);
    expect(container.querySelector('[data-testid="failure-recovery-card"]')).toBeNull();
    expect(container.textContent).not.toContain('Sent prompt…');
  });

  it('still offers Stop when the start stalls', async () => {
    seed(starting());
    const view = render(CloudStartPhaseLineHost, {
      agentId: AGENT,
      onStop: vi.fn(),
      statusEvents: [
        ...SENT_PROMPT,
        {
          phase: 'stalled',
          message: 'No model activity',
          level: 'warn' as const,
          timestamp: Date.now() + 1,
        },
      ],
    });
    const row = view.getByTestId('working-row');
    await waitFor(() => expect(startLines(row)).toHaveLength(1));
    expect(row.querySelector('[data-stream-stalled]')).not.toBeNull();
    expect(within(row).getByTestId('stalled-cancel')).toBeTruthy();
  });
});

describe('cloud machine wake line in the working row', () => {
  const SANDBOX = 'sbx-node-1';
  const sandbox = (state: 'paused' | 'resuming' | 'running'): RemoteMachine => ({
    id: SANDBOX,
    name: 'E2B · Docs sweeper',
    hosts: [],
    port: 0,
    fingerprint: 'fp',
    state: 'connected',
    runningAgents: 1,
    addedAt: '2026-11-08T02:20:00Z',
    cloud: {
      provider: 'e2b',
      cloudMachineId: 'e2b',
      sandboxId: 'isx1k2v9',
      state,
      template: 'intent/intent-node-4x8:0.240.0',
      size: '4x8',
      startedBy: { principalId: 'p-sam', displayName: 'Sam' },
      agentId: AGENT,
      workspaceId: 'ws-1',
      startedAt: '2026-11-08T02:20:00Z',
      runningSeconds: 60,
    },
  });
  const setSandbox = (state: 'paused' | 'resuming' | 'running') =>
    store.dispatch(cloudMachineChanged(sandbox(state), Date.now()));
  const placed = (extra: Partial<AgentSession> = {}) => base({ nodeId: SANDBOX, ...extra });
  const wakeLines = (root: HTMLElement) => root.querySelectorAll('[data-cloud-wake-line]');

  it('shows only the wake line while the paused machine resumes', async () => {
    setSandbox('resuming');
    const { container, row, notice } = mount(placed());
    await waitFor(() => expect(wakeLines(row)).toHaveLength(1));
    const line = wakeLines(row)[0] as HTMLElement;
    expect(line.textContent).toContain('Waking cloud machine…');
    expect(within(line).getByRole('status').textContent).toContain('Waking cloud machine…');
    expect(notice.textContent?.trim()).toBe('');
    expect(startLines(container)).toHaveLength(0);
    expect(container.textContent).not.toContain('Sent prompt…');
  });

  it('shows the start line, not the wake line, while the machine still starts', async () => {
    setSandbox('resuming');
    const { container, row } = mount(placed({ cloudStart: { step: 'connecting' } }));
    await waitFor(() => expect(startLines(row)).toHaveLength(1));
    expect(wakeLines(container)).toHaveLength(0);
  });

  it('keeps the phase line when the sandbox row is unknown', async () => {
    const { container, row } = mount(placed());
    expect(phaseLine(row)).toBe('Sent prompt…');
    expect(wakeLines(container)).toHaveLength(0);
  });

  it('brings back the phase line once the machine runs', async () => {
    setSandbox('resuming');
    const { container, row } = mount(placed());
    await waitFor(() => expect(wakeLines(row)).toHaveLength(1));
    setSandbox('running');
    await waitFor(() => expect(phaseLine(row)).toBe('Sent prompt…'));
    expect(wakeLines(container)).toHaveLength(0);
  });

  it('shows no wake line when no turn is working', async () => {
    setSandbox('resuming');
    const { container } = mount(placed(), false);
    expect(wakeLines(container)).toHaveLength(0);
  });

  it('shows the turn failure card when E2B refuses the resume', async () => {
    setSandbox('resuming');
    const { container, row, rerender } = mount(placed());
    await waitFor(() => expect(wakeLines(row)).toHaveLength(1));
    setSandbox('paused');
    seed(placed({ status: AgentStatus.Error, stopReason: 'E2B refused the resume' }));
    await rerender({ isProcessing: false });
    await waitFor(() =>
      expect(container.querySelector('[data-testid="failure-recovery-card"]')).not.toBeNull(),
    );
    expect(wakeLines(container)).toHaveLength(0);
    expect(container.textContent).not.toContain('Sent prompt…');
  });

  it('shows the cloud failure card when the sandbox is lost while it resumes', async () => {
    setSandbox('resuming');
    const { container, row, rerender } = mount(placed());
    await waitFor(() => expect(wakeLines(row)).toHaveLength(1));
    seed(
      placed({
        status: AgentStatus.Error,
        stopReason: 'the sandbox is gone',
        placementError: {
          code: 'cloud-machine-unavailable',
          detail: `the sandbox is gone ${JSON.stringify({
            code: 'cloud-machine-unavailable',
            reason: 'sandbox-lost',
            retryable: true,
          })}`,
        },
      }),
    );
    await rerender({ isProcessing: false });
    await waitFor(() =>
      expect(container.querySelector('[data-cloud-start-failure]')).not.toBeNull(),
    );
    expect(wakeLines(container)).toHaveLength(0);
    expect(container.querySelector('[data-testid="failure-recovery-card"]')).toBeNull();
  });
});

describe('start line hosts', () => {
  it('counts each shown start line once, however often it is released', () => {
    const hosts = new StartLineHosts();
    const first = hosts.register();
    const second = hosts.register();
    first();
    first();
    expect(hosts.shown).toBe(true);
    second();
    expect(hosts.shown).toBe(false);
  });
});
