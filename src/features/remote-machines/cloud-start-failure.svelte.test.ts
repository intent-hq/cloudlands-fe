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

function show(
  placementError: { code: string; detail: string },
  props: { queued?: boolean; onRetry?: () => void } = {},
) {
  store.dispatch(
    bulkUpsertSessions([e2bAgent(placementError)], { preserveExplicitRuntimeFlags: true }),
  );
  const view = render(AgentPlacementNotice, {
    agentId: AGENT,
    failedAt: FAILED_AT,
    queued: props.queued ?? true,
    onRetry: 'onRetry' in props ? props.onRetry : vi.fn(),
  });
  const card = view.container.querySelector<HTMLElement>('[data-cloud-start-failure]');
  if (!card) throw new Error('no cloud start failure card');
  return { ...view, card, summary: card.querySelector<HTMLElement>('[data-failure-summary]')! };
}

const actionNames = (card: HTMLElement) =>
  within(card)
    .getAllByRole('button')
    .map((button) => button.textContent?.trim())
    .filter((name) => name !== 'Details');

const primary = (card: HTMLElement) =>
  card.querySelector<HTMLElement>('[data-primary-action]')?.textContent?.trim();

beforeEach(() => {
  AGENT = `agent-e2b-${++seq}`;
  store.init();
  store.dispatch(backendReconnected());
  navigation.navigateToSettings.mockClear();
});
afterEach(() => cleanup());

describe('E2B start failure card', () => {
  it('says Intent did not start in the sandbox, offers Retry first, and keeps the raw text in Details', async () => {
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
    expect(summary.textContent).toContain("Couldn't start the E2B sandbox");
    expect(summary.textContent).toContain(
      "Intent didn't start inside the sandbox. The sandbox was deleted, so nothing is left running.",
    );
    expect(summary.textContent).toContain('Retry sends your queued message.');
    expect(summary.textContent).not.toContain('did not mint');
    expect(summary.textContent).not.toContain('{');
    expect(primary(card)).toBe('Retry');
    expect(actionNames(card)).toEqual(['Retry', 'Machines settings']);
    expect(within(card).queryByRole('link')).toBeNull();

    await fireEvent.click(within(card).getByRole('button', { name: 'Details' }));
    const details = within(card).getByTestId('failure-raw-details').textContent ?? '';
    expect(details).toContain('cloud-machine-unavailable · bootstrap-failed');
    expect(details).toContain('did not mint a credential (exit 3)');
    expect(details).not.toContain('"retryable"');

    await fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a queued message when none is queued', () => {
    const { summary } = show(
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
    expect(summary.textContent).not.toContain('queued');
  });

  it('says the message stays queued when Retry is not available', () => {
    const { card, summary } = show(
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
    expect(within(card).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(summary.textContent).toContain('Your message stays queued below.');
  });

  it('says the sandbox is gone and that Retry starts a new one', () => {
    const { card, summary } = show({
      code: 'remote-launch-failed',
      detail: typed('sandbox isx1k2v9 not found', {
        code: 'cloud-machine-unavailable',
        reason: 'sandbox-lost',
        retryable: true,
      }),
    });
    expect(card.dataset.tone).toBe('danger');
    expect(summary.textContent).toContain('The E2B sandbox is gone');
    expect(summary.textContent).toContain('retry starts a new sandbox');
    expect(primary(card)).toBe('Retry');
  });

  it('asks the user to fix a missing image first: amber, no Retry, settings first', async () => {
    const { card, summary } = show({
      code: 'remote-launch-failed',
      detail: typed('template intent/intent-node-4x8:0.240.0 not found', {
        code: 'cloud-machine-unavailable',
        reason: 'template-missing',
        retryable: false,
      }),
    });
    expect(card.dataset.tone).toBe('warning');
    expect(card.getAttribute('role')).toBe('status');
    expect(summary.textContent).toContain('No E2B image for this Intent version');
    expect(summary.textContent).toContain('Your message stays queued below.');
    expect(actionNames(card)).toEqual(['Machines settings']);
    expect(within(card).queryByRole('link')).toBeNull();
    await fireEvent.click(within(card).getByRole('button', { name: 'Machines settings' }));
    expect(navigation.navigateToSettings).toHaveBeenCalledWith({
      tab: 'devices',
      hash: 'devices',
    });
  });

  it('names a full E2B plan, leads with settings, keeps Retry, and links the E2B dashboard', () => {
    const { card, summary } = show({
      code: 'remote-launch-failed',
      detail: typed('concurrency limit reached', {
        code: 'cloud-quota',
        limit: 'concurrency',
        retryable: true,
      }),
    });
    expect(card.dataset.tone).toBe('warning');
    expect(summary.textContent).toContain('E2B plan limit reached');
    expect(summary.textContent).toContain('Retry sends your queued message.');
    expect(primary(card)).toBe('Machines settings');
    expect(actionNames(card)).toEqual(['Machines settings', 'Retry']);
    const link = within(card).getByRole('link', { name: /E2B dashboard/ });
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('says E2B rejected the key and links the dashboard', () => {
    const { card, summary } = show({
      code: 'cloud-machine-unavailable',
      detail: typed('E2B answered 401', {
        code: 'cloud-machine-unavailable',
        reason: 'key-rejected',
        retryable: false,
        status: 401,
      }),
    });
    expect(card.dataset.tone).toBe('warning');
    expect(summary.textContent).toContain('E2B rejected the key');
    expect(summary.textContent).toContain('Save a working key in Machines settings.');
    expect(primary(card)).toBe('Machines settings');
    expect(within(card).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(card).getByRole('link', { name: /E2B dashboard/ })).toBeTruthy();
  });

  it('keeps the backend detail behind Details when only the code is known', async () => {
    const { card, summary } = show({
      code: 'cloud-machine-unavailable',
      detail: 'E2B API returned 502 Bad Gateway',
    });
    expect(card.dataset.tone).toBe('danger');
    expect(summary.textContent).toContain("Couldn't start the E2B sandbox");
    expect(summary.textContent).not.toContain('502');
    await fireEvent.click(within(card).getByRole('button', { name: 'Details' }));
    expect(within(card).getByTestId('failure-raw-details').textContent).toContain(
      'E2B API returned 502 Bad Gateway',
    );
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
    expect(
      agentCloudStartFailure({
        ...cloud,
        placement: { target: 'remote', checkout: 'isolated' },
      } as AgentSession),
    ).toBeNull();
  });
});
