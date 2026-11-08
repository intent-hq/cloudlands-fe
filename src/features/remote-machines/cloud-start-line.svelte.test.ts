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
import CloudStartPhaseLineHost from './__tests__/CloudStartPhaseLineHost.svelte';

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
