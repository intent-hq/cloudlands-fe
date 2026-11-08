/**
 * @vitest-environment jsdom
 *
 * An agent on E2B that couldn't start: one turn-failure card in the chat with
 * a plain title and cause, the backend's detail under Details, and the action
 * most likely to help first. The queued message stays in the queue strip; the
 * card only says what Retry does with it.
 */
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import AgentPlacementNotice from './AgentPlacementNotice.svelte';
import { agentCloudStartFailure } from './agent-location';

const navigation = vi.hoisted(() => ({ navigateToSettings: vi.fn(async () => {}) }));
vi.mock('$lib/utils/workspace-navigation', () => navigation);

let AGENT = 'agent-e2b-0';
let seq = 0;
const FAILED_AT = '2026-11-08T02:21:34Z';
const BOOT_DETAIL =
  "the sandbox's intentd did not mint a credential (exit 3): intentd or its tunnel did not start in the sandbox The sandbox was deleted; no machine was added.";

const typed = (message: string, data: Record<string, unknown>) =>
  `${message} ${JSON.stringify(data)}`;

const e2bAgent = (placementError: { code: string; detail: string }): AgentSession =>
  ({
    id: AgentId(AGENT),
    backendSessionId: null,
    workspaceId: WorkspaceId('ws-1'),
    name: 'Docs sweeper',
    status: AgentStatus.Error,
    stopReason: BOOT_DETAIL,
    messages: [],
    createdAt: '2026-11-08T02:20:00Z',
    updatedAt: '2026-11-08T02:21:34Z',
    nodeName: 'E2B',
    placement: { target: 'e2b', checkout: 'isolated' },
    effectiveIsolation: 'pending',
    placementError,
  }) as AgentSession;

type NoticeProps = {
  queued?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  turnError?: string | null;
  agent?: Partial<AgentSession>;
};

function mount(placementError: { code: string; detail: string }, props: NoticeProps = {}) {
  store.dispatch(
    bulkUpsertSessions([{ ...e2bAgent(placementError), ...props.agent } as AgentSession], {
      preserveExplicitRuntimeFlags: true,
    }),
  );
  return render(AgentPlacementNotice, {
    agentId: AGENT,
    failedAt: FAILED_AT,
    queued: props.queued ?? true,
    onRetry: 'onRetry' in props ? props.onRetry : vi.fn(),
    retrying: props.retrying ?? false,
    turnError: props.turnError ?? null,
  });
}

function show(placementError: { code: string; detail: string }, props: NoticeProps = {}) {
  const view = mount(placementError, props);
  const card = view.container.querySelector<HTMLElement>('[data-cloud-start-failure]');
  if (!card) throw new Error('no cloud start failure card');
  return { ...view, card, summary: card.querySelector<HTMLElement>('[data-failure-summary]')! };
}

const actions = (card: HTMLElement) =>
  [...card.querySelectorAll<HTMLElement>('[data-action]')].map((button) => button.dataset.action);
const action = (card: HTMLElement, id: string) =>
  card.querySelector<HTMLElement>(`[data-action="${id}"]`);

const queuedNote = (card: HTMLElement) =>
  card.querySelector<HTMLElement>('[data-queued-note]')?.dataset.queuedNote ?? null;

const primary = (card: HTMLElement) =>
  card.querySelector<HTMLElement>('[data-primary-action]')?.dataset.action;

beforeEach(() => {
  AGENT = `agent-e2b-${++seq}`;
  store.init();
  store.dispatch(backendReconnected());
  navigation.navigateToSettings.mockClear();
});
afterEach(() => cleanup());

describe('E2B start failure card', () => {
  it('offers Retry first for a sandbox Intent did not start in, and keeps the raw text in Details', async () => {
    const onRetry = vi.fn();
    const { card, summary } = show(
      {
        code: 'remote-launch-failed',
        detail: typed(BOOT_DETAIL, {
          code: 'cloud-machine-unavailable',
          reason: 'bootstrap-failed',
          retryable: true,
        }),
      },
      { onRetry },
    );
    expect(card.dataset.tone).toBe('danger');
    expect(card.getAttribute('role')).toBe('alert');
    expect(summary.textContent).not.toContain('did not mint');
    expect(summary.textContent).not.toContain('{');
    expect(queuedNote(card)).toBe('retry');
    expect(primary(card)).toBe('retry');
    expect(actions(card)).toEqual(['retry', 'settings']);
    expect(within(card).queryByRole('link')).toBeNull();

    await fireEvent.click(within(card).getByRole('button', { name: 'Details' }));
    const details = within(card).getByTestId('failure-raw-details').textContent ?? '';
    expect(details).toContain('cloud-machine-unavailable');
    expect(details).toContain('bootstrap-failed');
    expect(details).toContain('did not mint a credential (exit 3)');
    expect(details).not.toContain('"retryable"');

    await fireEvent.click(action(card, 'retry')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a queued message when none is queued', () => {
    const { card } = show(
      {
        code: 'remote-launch-failed',
        detail: typed('boom', {
          code: 'cloud-machine-unavailable',
          reason: 'bootstrap-failed',
          retryable: true,
        }),
      },
      { queued: false },
    );
    expect(queuedNote(card)).toBeNull();
  });

  it('says the message stays queued when Retry is not available', () => {
    const { card } = show(
      {
        code: 'remote-launch-failed',
        detail: typed('boom', {
          code: 'cloud-machine-unavailable',
          reason: 'bootstrap-failed',
          retryable: true,
        }),
      },
      { onRetry: undefined },
    );
    expect(action(card, 'retry')).toBeNull();
    expect(queuedNote(card)).toBe('stays');
  });

  it('offers Retry first when the sandbox is gone', () => {
    const { card } = show({
      code: 'remote-launch-failed',
      detail: typed('sandbox isx1k2v9 not found', {
        code: 'cloud-machine-unavailable',
        reason: 'sandbox-lost',
        retryable: true,
      }),
    });
    expect(card.dataset.tone).toBe('danger');
    expect(primary(card)).toBe('retry');
  });

  it('asks the user to fix a missing image first: amber, no Retry, settings first', async () => {
    const { card } = show({
      code: 'remote-launch-failed',
      detail: typed('template intent/intent-node-4x8:0.240.0 not found', {
        code: 'cloud-machine-unavailable',
        reason: 'template-missing',
        retryable: false,
      }),
    });
    expect(card.dataset.tone).toBe('warning');
    expect(card.getAttribute('role')).toBe('status');
    expect(queuedNote(card)).toBe('stays');
    expect(actions(card)).toEqual(['settings']);
    expect(within(card).queryByRole('link')).toBeNull();
    await fireEvent.click(action(card, 'settings')!);
    expect(navigation.navigateToSettings).toHaveBeenCalledWith({
      tab: 'devices',
      hash: 'devices',
    });
  });

  it('leads with settings for a full E2B plan, keeps Retry, and links the E2B dashboard', () => {
    const { card } = show({
      code: 'remote-launch-failed',
      detail: typed('concurrency limit reached', {
        code: 'cloud-quota',
        limit: 'concurrency',
        retryable: true,
      }),
    });
    expect(card.dataset.tone).toBe('warning');
    expect(queuedNote(card)).toBe('retry');
    expect(primary(card)).toBe('settings');
    expect(actions(card)).toEqual(['settings', 'retry']);
    const link = within(card).getByRole('link', { name: /E2B dashboard/ });
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('leads with settings when E2B rejects the key, and links the dashboard', () => {
    const { card } = show({
      code: 'cloud-machine-unavailable',
      detail: typed('E2B answered 401', {
        code: 'cloud-machine-unavailable',
        reason: 'key-rejected',
        retryable: false,
        status: 401,
      }),
    });
    expect(card.dataset.tone).toBe('warning');
    expect(primary(card)).toBe('settings');
    expect(action(card, 'retry')).toBeNull();
    expect(within(card).getByRole('link', { name: /E2B dashboard/ })).toBeTruthy();
  });

  it('keeps the backend detail behind Details when only the code is known', async () => {
    const { card, summary } = show({
      code: 'cloud-machine-unavailable',
      detail: 'E2B API returned 502 Bad Gateway',
    });
    expect(card.dataset.tone).toBe('danger');
    expect(summary.textContent).not.toContain('502');
    await fireEvent.click(within(card).getByRole('button', { name: 'Details' }));
    expect(within(card).getByTestId('failure-raw-details').textContent).toContain(
      'E2B API returned 502 Bad Gateway',
    );
  });
});

describe('E2B start failure card lifecycle', () => {
  const bootstrap = {
    code: 'remote-launch-failed',
    detail: typed('boom', {
      code: 'cloud-machine-unavailable',
      reason: 'bootstrap-failed',
      retryable: true,
    }),
  };
  const cardIn = (container: HTMLElement) => container.querySelector('[data-cloud-start-failure]');

  it('steps aside for a later turn error, so a failed retry shows in the generic card', () => {
    const { container } = mount(bootstrap, { turnError: 'agent.retry failed: E2B 503' });
    expect(cardIn(container)).toBeNull();
    expect(container.querySelector('[data-agent-placement-notice]')).toBeNull();
  });

  it('hides a kept start error once the agent left Error (a retry started)', () => {
    const { container } = mount(bootstrap, { agent: { status: AgentStatus.Pending } });
    expect(cardIn(container)).toBeNull();
  });

  it('shows a retry in flight on Retry and ignores more clicks', async () => {
    const onRetry = vi.fn();
    const { card } = show(bootstrap, { onRetry, retrying: true });
    const retry = action(card, 'retry')!;
    expect(retry.getAttribute('aria-busy')).toBe('true');
    await fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('offers Machines settings when the model needs a key to run on E2B', async () => {
    const { card } = show({
      code: 'remote-launch-failed',
      detail: typed('needs a key', { code: 'cloud-profile-required', providerRef: 'claude-code' }),
    });
    expect(actions(card)).toEqual(['settings']);
    await fireEvent.click(action(card, 'settings')!);
    expect(navigation.navigateToSettings).toHaveBeenCalled();
  });

  it('keeps the turn error in Details when the backend sent only typed data', async () => {
    const { card } = show({
      code: 'remote-launch-failed',
      detail: typed('', { code: 'cloud-quota', limit: 'concurrency', retryable: true }),
    });
    await fireEvent.click(within(card).getByRole('button', { name: 'Details' }));
    expect(within(card).getByTestId('failure-raw-details').textContent).toContain(BOOT_DETAIL);
  });
});

describe('agentCloudStartFailure', () => {
  it('is set only for an E2B agent whose start failed with a cloud error', () => {
    const cloud = e2bAgent({
      code: 'remote-launch-failed',
      detail: typed('x', { code: 'cloud-quota', limit: 'rate', retryable: true }),
    });
    expect(agentCloudStartFailure(cloud)?.cloud?.code).toBe('cloud-quota');
    expect(
      agentCloudStartFailure({
        ...cloud,
        placementError: { code: 'remote-launch-failed', detail: 'x' },
      }),
    ).toBeNull();
    expect(agentCloudStartFailure({ ...cloud, placementError: undefined })).toBeNull();
    expect(agentCloudStartFailure({ ...cloud, status: AgentStatus.Idle })).toBeNull();
    expect(
      agentCloudStartFailure({
        ...cloud,
        placement: { target: 'remote', checkout: 'isolated' },
      } as AgentSession),
    ).toBeNull();
  });
});
