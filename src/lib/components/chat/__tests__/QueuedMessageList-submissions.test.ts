/** @vitest-environment jsdom */
import { fireEvent, render, screen, within, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { createAdmittedLegacyPrincipal } from '../../../../test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { admitAgentSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-admission';
import {
  pendingEvidenceObserved,
  pendingLifecycleObserved,
  pendingSubmissionSettled,
} from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import { selectAgentSubmissionDisplay } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { beginSubmissionRead } from '$features/agent/submission-evidence';
import { isUserQueuedMessage } from '$lib/utils/queued-message-visibility';
import type { AgentSession, QueuedMessage, Workspace } from '$shared/types';
vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendReconnected: () => () => {},
  onBackendNotification: () => () => {},
}));
vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/Button.svelte')).default,
}));
import QueuedMessageList from '../QueuedMessageList.svelte';
const ws = 'queue-render-workspace';
const agent = 'queue-render-agent';
let dispose: () => void;
let capability: unknown;
beforeEach(() => {
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity({ id: ws, myRole: 'owner' } as Workspace));
  store.dispatch(
    bulkUpsertSessions([{ id: agent, workspaceId: ws, messages: [] } as unknown as AgentSession]),
  );
  capability = 1;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => dispose());
const admit = (content: string) =>
  admitAgentSubmission(store, agent, ws, capability, { content, destination: 'queue' })!;
const author = () => ({
  principalId: store.state.principal.snapshot!.principal.id,
  login: null,
  displayName: null,
  avatarUrl: null,
});
const row = (id: string, content: string, extra: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id,
  turnId: `turn-${id}`,
  content,
  queuedAt: '2026-10-03T12:00:00Z',
  position: 0,
  submissionIds: [id],
  author: author(),
  mergeEligible: true,
  ...extra,
});
function event(rows: QueuedMessage[]) {
  routeDaemonEventsNotification('events.event', {
    id: crypto.randomUUID(),
    type: 'agent:queue:updated',
    workspaceId: ws,
    timestamp: '2026-10-03T12:00:00Z',
    data: { agentId: agent, queue: rows },
  });
}
function fresh(rows: QueuedMessage[]) {
  event(rows);
  beginSubmissionRead(agent, ws, 'queue').complete(rows);
  beginSubmissionRead(agent, ws, 'history').complete([]);
}
function props() {
  const messages = selectAgentQueueMessages
    .select(store.state, agent, ws)
    .filter(isUserQueuedMessage);
  return {
    messages,
    displayRows: selectAgentSubmissionDisplay
      .select(store.state, agent, ws)
      .queue.filter((r) => !r.confirmedId || messages.some((m) => m.id === r.confirmedId)),
    ownPrincipalId: author().principalId,
  };
}
const texts = () => screen.getAllByTestId('queued-message-text').map((n) => n.textContent?.trim());

describe('rendered queue with production submission state and daemon events', () => {
  it('splits a provisional append when another human intervenes, retaining canonical DOM identity and ACLs', async () => {
    const a = admit('A');
    const original = row(a.submission.id, 'A');
    fresh([original]);
    const view = render(QueuedMessageList, {
      props: {
        ...props(),
        onedit: vi.fn().mockResolvedValue({ success: true }),
        onsendnow: vi.fn(),
      },
    });
    const anchor = screen.getByTestId('queued-message-row');
    const b = admit('B');
    await view.rerender(props());
    expect(texts()).toEqual(['A\n\nB']);
    expect(screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled')).toBe(true);
    const foreign = row('foreign', 'Other person', {
      author: { ...author(), principalId: 'other' },
      mergeEligible: false,
      position: 1,
    });
    event([
      { ...original, mergeEligible: false },
      foreign,
      row(b.submission.id, 'B', { position: 2 }),
    ]);
    await view.rerender(props());
    expect(texts()).toEqual(['A', 'Other person', 'B']);
    expect(screen.getAllByTestId('queued-message-row')[0]).toBe(anchor);
    expect(
      within(screen.getAllByTestId('queued-message-row')[1]).queryByRole('button', {
        name: 'Edit',
      }),
    ).toBeNull();
    store.dispatch(
      pendingSubmissionSettled(
        b.scope,
        b.submission.id,
        'accepted',
        Date.now(),
        row(a.submission.id, 'A\n\nB', { submissionIds: [a.submission.id, b.submission.id] }),
      ),
    );
    await view.rerender(props());
    expect(texts()).toEqual(['A', 'Other person', 'B']);
  });

  it('uses eligibility rather than priority/position, skips automatic rows, and keeps identical contributions independently recoverable', async () => {
    const a = admit('same');
    const original = row(a.submission.id, 'same', { position: 0 });
    const older = row('older', 'Older arrival', { position: 2, mergeEligible: false });
    fresh([
      original,
      row('automatic', 'System', {
        position: 1,
        author: null,
        mergeEligible: false,
        messageMetadata: { source: 'system' },
      }),
      older,
    ]);
    const b = admit('same'),
      c = admit('same');
    const view = render(QueuedMessageList, { props: props() });
    expect(texts()).toEqual(['same\n\nsame\n\nsame', 'Older arrival']);
    const projection = selectAgentSubmissionDisplay.select(store.state, agent, ws);
    expect(projection.queue[0].contributions.map((s) => s.id)).toEqual([
      b.submission.id,
      c.submission.id,
    ]);
    expect(selectAgentQueueMessages.select(store.state, agent, ws)[0].content).toBe('same');
    store.dispatch(pendingSubmissionSettled(b.scope, b.submission.id, 'rejected', Date.now()));
    await view.rerender(props());
    expect(texts()).toEqual(['same\n\nsame', 'Older arrival']);
    expect(
      selectAgentSubmissionDisplay
        .select(store.state, agent, ws)
        .queue[0].contributions.map((s) => s.id),
    ).toEqual([c.submission.id]);
  });

  it.each([null, { principalId: null, login: null, displayName: 'Imported', avatarUrl: null }])(
    'keeps unknown author %j separate',
    async (unknownAuthor) => {
      admit('initialize');
      fresh([]);
      const original = row('unknown', 'Same text', { author: unknownAuthor, mergeEligible: false });
      fresh([original]);
      // Retire the setup admission without inventing evidence for the new send.
      const setup = store.state.pendingSubmissions.byAgentId[agent];
      for (const s of selectAgentSubmissionDisplay
        .select(store.state, agent, ws)
        .queue.flatMap((r) => r.contributions))
        store.dispatch(pendingSubmissionSettled(setup.scope, s.id, 'rejected', Date.now()));
      admit('Same text');
      render(QueuedMessageList, { props: props() });
      expect(texts()).toEqual(['Same text', 'Same text']);
    },
  );

  it('retains the private edit and exposes a pending append while save/release are deferred', async () => {
    const a = admit('A');
    const original = row(a.submission.id, 'A');
    fresh([original]);
    const onedit = vi.fn().mockResolvedValue({ success: true });
    const view = render(QueuedMessageList, { props: { ...props(), onedit } });
    expect(view.component.editLastMessage()).toBe(true);
    await waitFor(() => expect(onedit).toHaveBeenCalledOnce());
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'private edit' } });
    const b = admit('B');
    await view.rerender(props());
    expect(screen.getByRole('status').textContent).toContain('B');
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onedit).toHaveBeenCalledOnce();
    expect((input as HTMLTextAreaElement).value).toBe('private edit');
    fresh([
      {
        ...original,
        content: 'A\n\nB',
        editing: true,
        submissionIds: [a.submission.id, b.submission.id],
      },
    ]);
    await view.rerender(props());
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(onedit).toHaveBeenLastCalledWith(a.submission.id, 'private edit', false),
    );
  });

  it('keeps restored head and tail after pre-ACK drain and partial persistence without replaying stale acknowledgements', async () => {
    const a = admit('Head'),
      b = admit('Tail');
    const head = row(a.submission.id, 'Head', { mergeEligible: false });
    const tail = row(b.submission.id, 'Tail', { mergeEligible: false, position: 1 });
    const view = render(QueuedMessageList, { props: props() });
    routeDaemonEventsNotification('events.event', {
      id: crypto.randomUUID(),
      type: 'agent:queue:processing',
      workspaceId: ws,
      timestamp: '2026-10-03T12:00:00Z',
      data: { agentId: agent, messageId: head.id, turnId: 'turn', queuedMessages: [head, tail] },
    });
    event([]);
    await view.rerender(props());
    expect(screen.queryByTestId('queued-messages-container')).toBeNull();
    expect(
      selectAgentSubmissionDisplay
        .select(store.state, agent, ws)
        .processing.map((row) => row.content),
    ).toEqual(['Head', 'Tail']);
    store.dispatch(pendingEvidenceObserved(a.scope, 'history', [head], Date.now()));
    event([head, tail]);
    store.dispatch(
      pendingSubmissionSettled(a.scope, a.submission.id, 'accepted', Date.now(), {
        ...head,
        content: 'Stale head acknowledgement',
      }),
    );
    store.dispatch(
      pendingSubmissionSettled(b.scope, b.submission.id, 'accepted', Date.now(), {
        ...tail,
        content: 'Stale tail acknowledgement',
      }),
    );
    await view.rerender(props());
    expect(texts()).toEqual(['Head', 'Tail']);
    expect(
      selectAgentSubmissionDisplay
        .select(store.state, agent, ws)
        .queue.every((row) => row.blocksMutations),
    ).toBe(true);
    store.dispatch(pendingLifecycleObserved(a.scope, false));
    fresh([head, tail]);
    await view.rerender(props());
    expect(
      selectAgentSubmissionDisplay
        .select(store.state, agent, ws)
        .queue.every((row) => !row.blocksMutations && !row.contributions.length),
    ).toBe(true);
    event([]);
    await view.rerender(props());
    expect(screen.queryByTestId('queued-messages-container')).toBeNull();
  });

  it('keeps confirmed controls working on an unsupported daemon without guessing identical text matches', async () => {
    capability = undefined;
    const a = admit('same');
    fresh([row('confirmed', 'same', { mergeEligible: undefined, submissionIds: undefined })]);
    const onremove = vi.fn();
    render(QueuedMessageList, { props: { ...props(), onremove } });
    expect(texts()).toEqual(['same']);
    await fireEvent.keyDown(screen.getByTestId('queued-message-content'), { key: 'Delete' });
    expect(onremove).toHaveBeenCalledWith('confirmed');
    expect(a.submission.id).not.toBe('confirmed');
  });
});
