import { afterEach, describe, expect, it } from 'vitest';
import { StreamingStore } from '@themislib/themis/streaming-store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { QueuedMessage } from '$shared/types';
import { backendReconnected } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { principalContextChanged } from '../principal/principal-slice';
import { agentQueueReducer, replaceAgentQueue } from '../agent-queue/agent-queue-slice';
import {
  pendingSubmissionsReducer,
  pendingScopeActivated,
  pendingScopeReleased,
  pendingSubmissionAccepted,
  pendingSubmissionSending,
  pendingSubmissionSettled,
  pendingEvidenceObserved,
  pendingLifecycleObserved,
  pendingReadStarted,
  pendingReadCompleted,
  pendingRetentionPruned,
} from './pending-submissions-slice';
import { projectPendingSubmissions } from './pending-submissions-projection';
import { admitPendingSubmission } from './pending-submissions-admission';
import {
  evidenceSubmissionIds,
  PENDING_SUBMISSION_LIMIT,
  SUBMISSION_TOMBSTONE_LIMIT,
  SUBMISSION_TOMBSTONE_TTL,
  submissionReadIsCurrent,
} from './pending-submissions-model';
import type { SubmissionInput, SubmissionRead, SubmissionScope } from './pending-submissions-types';

const scope: SubmissionScope = {
  agentId: 'agent',
  workspaceId: 'workspace',
  authority: 'host',
  principalId: 'alice',
  participation: 'admitted-1',
  owner: 'owner-1',
};
const alice = { principalId: 'alice', login: null, displayName: null, avatarUrl: null };
const bob = { ...alice, principalId: 'bob' };
function queued(id: string, content = id, overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id,
    content,
    queuedAt: '2026-10-03T07:00:00Z',
    position: 0,
    author: alice,
    submissionIds: [id],
    mergeEligible: true,
    ...overrides,
  };
}
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function fixture(capability: unknown = 1) {
  const store = new StreamingStore(
    { pendingSubmissions: pendingSubmissionsReducer, agentQueue: agentQueueReducer },
    [],
  );
  disposers.push(store.init());
  store.dispatch(pendingScopeActivated(scope, capability));
  const entry = () => store.state.pendingSubmissions.byAgentId.agent;
  const display = () =>
    projectPendingSubmissions(
      entry(),
      store.state.agentQueue.byAgentId.agent
        ? getItems(store.state.agentQueue.byAgentId.agent.messages)
        : [],
    );
  const accept = (
    id: string,
    destination: 'queue' | 'conversation' = 'queue',
    overrides: Partial<SubmissionInput> = {},
  ) =>
    store.dispatch(
      pendingSubmissionAccepted(scope, {
        id,
        content: id,
        destination,
        createdAt: 1,
        ...overrides,
      }),
    );
  const read = (kind: 'queue' | 'history', id = kind): SubmissionRead => {
    const token = { scope, kind, id, generation: entry().generation };
    store.dispatch(pendingReadStarted(token));
    return token;
  };
  const fresh = (queue: QueuedMessage[] = []) => {
    const q = read('queue');
    store.dispatch(replaceAgentQueue(scope.agentId, queue, scope.workspaceId));
    store.dispatch(pendingReadCompleted(q, queue, 2));
    const h = read('history');
    store.dispatch(pendingReadCompleted(h, [], 2));
  };
  const event = (rows: QueuedMessage[], kind: 'queue' | 'processing' | 'history' = 'queue') => {
    if (kind === 'queue') store.dispatch(replaceAgentQueue(scope.agentId, rows, scope.workspaceId));
    store.dispatch(pendingEvidenceObserved(scope, kind, rows, 3));
  };
  const settle = (
    id: string,
    outcome: 'rejected' | 'uncertain' | 'accepted',
    row?: QueuedMessage,
  ) => store.dispatch(pendingSubmissionSettled(scope, id, outcome, 4, row));
  return { store, entry, display, accept, read, fresh, event, settle };
}

describe('shared pending submission state', () => {
  it.each(['queue', 'history'] as const)(
    'fences both pre-ACK reads when %s completes first and retains unaccounted acceptance',
    (first) => {
      const f = fixture();
      f.accept('a');
      const q = f.read('queue');
      const h = f.read('history');
      f.settle('a', 'accepted', queued('a'));
      for (const token of first === 'queue' ? [q, h] : [h, q]) {
        expect(submissionReadIsCurrent(f.entry(), token)).toBe(false);
        f.store.dispatch(pendingReadCompleted(token, [], 5));
        expect(f.display().queue.map((row) => row.content)).toEqual(['a']);
        expect(f.entry().refreshNeeded).toBe(true);
      }
      // Even a later empty snapshot is not correlated delivery evidence.
      f.fresh([]);
      expect(f.display().queue.map((row) => row.content)).toEqual(['a']);
      expect(f.entry().refreshNeeded).toBe(true);
      f.event([queued('a')], 'history');
      expect(f.display().queue).toEqual([]);
    },
  );

  it('keeps individual accepted contributions when only part of a merged ACK has current evidence', () => {
    const f = fixture();
    f.accept('a', 'queue', { content: 'A' });
    f.accept('b', 'queue', { content: 'B', messageMetadata: { trace: 'keep' } });
    f.settle('a', 'accepted', queued('a', 'A\n\nB', { submissionIds: ['a', 'b'] }));
    expect(f.display().queue.map((row) => row.content)).toEqual(['A\n\nB']);
    f.event([queued('a', 'A')], 'history');
    f.fresh([]);
    expect(f.display().queue.map((row) => row.content)).toEqual(['B']);
    expect(getItems(f.entry().submissions)[0].messageMetadata).toEqual({ trace: 'keep' });
    expect(f.entry().refreshNeeded).toBe(true);
    f.event([queued('b', 'B')]);
    expect(f.display().queue.map((row) => row.content)).toEqual(['B']);
    expect(getItems(f.entry().submissions)).toEqual([]);
  });

  it.each(['ttl', 'count'] as const)(
    'retains trusted processing after queue dwell evicts its %s tombstone',
    (eviction) => {
      const f = fixture();
      f.accept('a');
      f.event([queued('a')]);
      f.settle('a', 'accepted', queued('a'));
      if (eviction === 'ttl') {
        f.store.dispatch(pendingRetentionPruned(scope, SUBMISSION_TOMBSTONE_TTL + 4));
      } else {
        for (let i = 0; i < SUBMISSION_TOMBSTONE_LIMIT; i++) {
          const id = `done-${i}`;
          f.accept(id);
          f.event([queued(id)], 'history');
          f.settle(id, 'accepted');
        }
      }
      expect(getItems(f.entry().tombstones).some((t) => t.id === 'a')).toBe(false);
      f.event([queued('a')], 'processing');
      f.event([]);
      expect(f.display().processing.map((row) => row.content)).toEqual(['a']);
      expect(getItems(f.entry().tombstones).some((t) => t.id === 'a')).toBe(false);
      expect(getItems(f.entry().tombstones).length).toBeLessThanOrEqual(SUBMISSION_TOMBSTONE_LIMIT);
      f.settle('a', 'accepted', queued('a', 'stale ACK'));
      expect(f.display().queue).toEqual([]);
      f.event([queued('a')], 'history');
      expect(f.display().processing).toEqual([]);
    },
  );

  it('processing evidence uses trusted source authors without requiring retained local callbacks', () => {
    const f = fixture();
    f.event(
      [
        queued('other', 'foreign', { author: bob }),
        queued('anonymous', 'unknown', { author: null }),
      ],
      'processing',
    );
    expect(f.display().processing).toEqual([]);
    const retry = queued('retry', 'trusted retry', {
      author: bob,
      submissionIds: undefined,
      recoverySources: [{ messageId: 'a', submissionIds: ['a'], author: alice, origin: 'user' }],
    });
    f.event([retry], 'processing');
    f.event([]);
    expect(f.display().processing.map((row) => row.content)).toEqual(['trusted retry']);
    f.store.dispatch(pendingLifecycleObserved(scope, false));
    f.event([retry]);
    expect(f.display().processing).toEqual([]);
    expect(f.display().queue.map((row) => row.content)).toEqual(['trusted retry']);
  });

  it('admits distinct IDs synchronously before a deferred preparation, and snapshots individual metadata', async () => {
    const f = fixture();
    let resolve!: () => void;
    const preparation = new Promise<void>((done) => {
      resolve = done;
    });
    const input = {
      content: 'same',
      destination: 'conversation' as const,
      appMessageId: 'compatibility-row',
      messageMetadata: { answer: 'one' },
      imageBlocks: [{ type: 'image' as const, attachmentId: 'image' }],
    };
    const first = admitPendingSubmission(f.store, scope, input)!;
    const second = admitPendingSubmission(f.store, scope, input)!;
    input.messageMetadata.answer = 'edited';
    input.imageBlocks[0].attachmentId = 'changed';
    expect(first.id).not.toBe(second.id);
    expect(first.id).not.toBe(first.appMessageId);
    expect(
      f.display().conversation.map((s) => [s.content, s.messageMetadata, s.imageBlocks]),
    ).toEqual([
      ['same', { answer: 'one' }, [{ type: 'image', attachmentId: 'image' }]],
      ['same', { answer: 'one' }, [{ type: 'image', attachmentId: 'image' }]],
    ]);
    f.store.dispatch(pendingSubmissionSending(scope, first.id));
    expect(f.display().conversation[0].status).toBe('sending');
    resolve();
    await preparation;
  });

  it('splits an apparent A+B append into A / other participant / B without changing confirmed A', () => {
    const f = fixture();
    const a = queued('a', 'A');
    f.fresh([a]);
    f.accept('b', 'queue', {
      content: 'B',
      messageMetadata: { answer: 'B' },
    });
    expect(f.display().queue.map((s) => s.content)).toEqual(['A\n\nB']);
    expect(f.display().queue[0].blocksMutations).toBe(true);
    expect(f.display().queue[0].contributions[0].messageMetadata).toEqual({ answer: 'B' });
    expect(a.content).toBe('A');
    expect(a.fileBlocks).toBeUndefined();
    expect(getItems(f.store.state.agentQueue.byAgentId.agent.messages)).toEqual([a]);
    f.event([
      queued('a', 'A', { mergeEligible: false }),
      queued('foreign', 'other participant', { author: bob, mergeEligible: false }),
      queued('b', 'B'),
    ]);
    expect(f.display().queue.map((s) => s.content)).toEqual(['A', 'other participant', 'B']);
    expect(getItems(f.entry().submissions)).toEqual([]);
    f.settle('b', 'accepted', queued('a', 'A\n\nB', { submissionIds: ['a', 'b'] }));
    expect(f.display().queue.map((s) => s.content)).toEqual(['A', 'other participant', 'B']);
  });

  it('removes only a rejected append and keeps earlier content and another pending contribution', () => {
    const f = fixture();
    f.fresh([queued('a', 'A')]);
    f.accept('b', 'queue', { content: 'B' });
    f.accept('c', 'queue', { content: 'C' });
    expect(f.display().queue.map((s) => s.content)).toEqual(['A\n\nB\n\nC']);
    f.settle('b', 'rejected');
    expect(f.display().queue.map((s) => s.content)).toEqual(['A\n\nC']);
    expect(getItems(f.entry().submissions).map((s) => s.id)).toEqual(['c']);
  });

  it.each(['reply-first', 'event-first'] as const)(
    'moves direct send to queue exactly once: %s',
    (order) => {
      const f = fixture();
      f.fresh();
      f.accept('b', 'conversation');
      const row = queued('a', 'A\n\nB', { submissionIds: ['a', 'b'] });
      if (order === 'reply-first') f.settle('b', 'accepted', { ...row, author: null });
      else f.event([row]);
      expect(f.display().conversation).toEqual([]);
      expect(f.display().queue.map((s) => s.content)).toEqual(['A\n\nB']);
      if (order === 'reply-first') f.event([row]);
      else f.settle('b', 'accepted', row);
      expect(f.display().queue.map((s) => s.content)).toEqual(['A\n\nB']);
    },
  );

  it.each(['processing', 'history'] as const)(
    '%s before acknowledgment never resurrects the queue',
    (kind) => {
      const f = fixture();
      f.accept('a', 'conversation');
      f.event([queued('a')], kind);
      f.settle('a', 'accepted', queued('a'));
      expect(f.display().queue).toEqual([]);
      expect(f.display().conversation).toEqual([]);
      expect(f.display().processing.map((s) => s.id)).toEqual(kind === 'processing' ? ['a'] : []);
      expect(getItems(f.entry().tombstones)[0].reason).toBe(kind);
    },
  );

  it('retains the consumed canonical snapshot after an ACK, hides overlays, and settles on history', () => {
    const f = fixture();
    f.accept('b');
    const row = queued('a', 'A\n\nB', { submissionIds: ['a', 'b'], mergeEligible: false });
    f.settle('b', 'accepted', row);
    f.event([row], 'processing');
    expect(f.display().processing.map((s) => s.content)).toEqual(['A\n\nB']);
    f.event([row]);
    expect(f.display().processing).toEqual([]);
    expect(f.display().queue.map((s) => s.content)).toEqual(['A\n\nB']);
    f.event([]);
    expect(f.display().processing.map((s) => s.content)).toEqual(['A\n\nB']);
    f.event([row], 'history');
    expect(f.display().processing).toEqual([]);
  });

  it('repeated processing does not lose retained content or extend terminal retention', () => {
    const f = fixture();
    f.accept('a');
    f.event([queued('a')], 'processing');
    f.store.dispatch(pendingEvidenceObserved(scope, 'processing', [queued('a')], 200));
    expect(f.display().processing.map((s) => s.content)).toEqual(['a']);
    expect(getItems(f.entry().tombstones)[0].at).toBe(3);
    f.store.dispatch(pendingRetentionPruned(scope, SUBMISSION_TOMBSTONE_TTL + 3));
    expect(getItems(f.entry().tombstones)).toEqual([]);
    f.event([queued('a')], 'history');
    expect(f.display().processing).toEqual([]);
  });

  it('keeps uncertain delivery visible through empty snapshots until matching evidence arrives', () => {
    const f = fixture();
    f.accept('a', 'conversation');
    f.settle('a', 'uncertain');
    f.fresh([]);
    expect(f.display().conversation.map((s) => s.status)).toEqual(['uncertain']);
    f.event([queued('a')], 'history');
    expect(f.display().conversation).toEqual([]);
  });

  it('moves direct fallback without a queuedMessage reply to a pending queue row', () => {
    const f = fixture();
    f.accept('a', 'conversation');
    f.store.dispatch(pendingSubmissionSettled(scope, 'a', 'accepted', 4, undefined, true));
    expect(f.display().conversation).toEqual([]);
    expect(f.display().queue.map((s) => [s.content, s.blocksMutations])).toEqual([['a', true]]);
    f.event([queued('survivor', 'older\n\na', { submissionIds: ['older', 'a'] })]);
    expect(f.display().queue.map((s) => s.content)).toEqual(['older\n\na']);
  });

  it('direct success keeps recoverable text until transcript evidence, without writing authoritative history', () => {
    const f = fixture();
    f.accept('a', 'conversation');
    f.settle('a', 'accepted');
    expect(f.display().conversation[0].status).toBe('accepted');
    expect(f.store.state.agentQueue.byAgentId).toEqual({});
    f.event([queued('a')], 'history');
    expect(f.display().conversation).toEqual([]);
  });

  it('uses per-source recovery authors rather than the retry head or text', () => {
    const f = fixture();
    f.accept('alice-source');
    f.accept('bob-source');
    const retry = queued('retry', 'combined', {
      author: bob,
      submissionIds: undefined,
      mergeEligible: false,
      recoverySources: [
        {
          messageId: 'alice-original',
          submissionIds: ['alice-source'],
          author: alice,
          origin: 'user',
        },
        { messageId: 'bob-original', submissionIds: ['bob-source'], author: bob, origin: 'user' },
        { messageId: 'automatic', submissionIds: ['automatic'], author: null, origin: 'automatic' },
      ],
    });
    f.event([retry]);
    expect(getItems(f.entry().submissions).map((s) => s.id)).toEqual(['bob-source']);
    expect(f.display().queue[0].confirmed?.author).toEqual(bob);
    expect(evidenceSubmissionIds(retry, 'alice')).toEqual(['alice-source']);
    f.settle('alice-source', 'accepted', queued('alice-original'));
    expect(f.display().queue[0].confirmedId).toBe('retry');
  });

  it('preserves unflagged same-ID restored work alongside history, and disables ambiguous controls', () => {
    const f = fixture();
    f.accept('head');
    f.accept('tail');
    f.event([queued('head'), queued('tail')], 'processing');
    f.event([queued('head')], 'history');
    f.event([
      queued('head', 'persisted head', { mergeEligible: false }),
      queued('tail', 'unpersisted tail', { mergeEligible: false }),
    ]);
    expect(f.display().queue.map((s) => [s.confirmedId, s.blocksMutations])).toEqual([
      ['head', true],
      ['tail', true],
    ]);
    expect(getItems(f.entry().submissions)).toEqual([]);
    f.settle('head', 'accepted', queued('head', 'old ACK'));
    f.store.dispatch(pendingLifecycleObserved(scope, false));
    f.fresh([
      queued('head', 'persisted head', { mergeEligible: false }),
      queued('tail', 'unpersisted tail', { mergeEligible: false }),
    ]);
    expect(f.display().queue.map((s) => [s.content, s.blocksMutations])).toEqual([
      ['persisted head', false],
      ['unpersisted tail', false],
    ]);
    expect(
      getItems(f.entry().tombstones)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['head', 'tail']);
    f.event([]);
    expect(f.display().queue).toEqual([]);
  });

  it('fences reads across observations and superseding reads, then accepts a quiet current refresh', () => {
    const f = fixture();
    f.accept('a');
    const old = f.read('queue', 'old');
    f.event([queued('a')], 'history');
    expect(submissionReadIsCurrent(f.entry(), old)).toBe(false);
    f.store.dispatch(pendingReadCompleted(old, [queued('a')], 4));
    expect(f.entry().queueFresh).toBe(false);
    expect(f.display().queue).toEqual([]);
    const superseded = f.read('queue', 'first');
    const current = f.read('queue', 'second');
    expect(submissionReadIsCurrent(f.entry(), superseded)).toBe(false);
    expect(submissionReadIsCurrent(f.entry(), current)).toBe(true);
    f.store.dispatch(pendingReadCompleted(current, [queued('a')], 5));
    expect(f.entry().queueFresh).toBe(true);
    expect(submissionReadIsCurrent(f.entry(), current)).toBe(false);
  });

  it('an unrelated intervening event prevents a mutation seed but retains its queued contribution', () => {
    const f = fixture();
    f.accept('a', 'conversation');
    f.event([queued('foreign', 'other', { author: bob })]);
    f.settle('a', 'accepted', queued('a'));
    expect(f.display().conversation).toEqual([]);
    expect(f.display().queue.map((s) => s.content)).toEqual(['other', 'a']);
    expect(getItems(f.entry().seeds)).toEqual([]);
    expect(f.entry().refreshNeeded).toBe(true);
  });

  it('a current full read also fences an older mutation echo, without invalidating its sibling history read', () => {
    const f = fixture();
    f.accept('a');
    const q = f.read('queue');
    const h = f.read('history');
    f.store.dispatch(pendingReadCompleted(q, [], 3));
    expect(submissionReadIsCurrent(f.entry(), h)).toBe(true);
    f.store.dispatch(pendingReadCompleted(h, [], 3));
    f.settle(
      'a',
      'accepted',
      queued('stale-survivor', 'stale canonical', { submissionIds: ['a'] }),
    );
    expect(getItems(f.entry().seeds)).toEqual([]);
    expect(f.display().queue.map((s) => s.content)).toEqual(['a']);
  });

  it('a subset reply cannot overwrite the newest merged seed', () => {
    const f = fixture();
    f.accept('a');
    f.accept('b');
    f.settle('b', 'accepted', queued('a', 'A\n\nB', { submissionIds: ['a', 'b'] }));
    f.settle('a', 'accepted', queued('a', 'A'));
    expect(f.display().queue.map((s) => s.content)).toEqual(['A\n\nB']);
  });

  it.each([undefined, null, true, false, '1', 0, 2, 1.5])(
    'keeps confirmed queue fallback for capability %s',
    (capability) => {
      // Explicit undefined is distinct from fixture's default supported value.
      const f = fixture();
      f.store.dispatch(pendingScopeActivated(scope, capability));
      f.fresh([queued('confirmed')]);
      f.accept('q');
      f.accept('c', 'conversation');
      expect(f.display().queue.map((s) => s.content)).toEqual(['confirmed']);
      expect(f.display().conversation.map((s) => s.content)).toEqual(['c']);
    },
  );

  it.each([
    queued('a', 'A', { mergeEligible: undefined }),
    queued('a', 'A', { mergeEligible: false }),
    queued('a', 'A', { author: null }),
    queued('a', 'A', { author: { ...alice, principalId: null } }),
    queued('a', 'A', { author: bob }),
    queued('a', 'A', { submissionIds: undefined }),
  ])('does not infer merge authority from queue order, text or unknown authorship: %j', (row) => {
    const f = fixture();
    f.fresh([row]);
    f.accept('b', 'queue', { content: 'B' });
    expect(f.display().queue.map((s) => s.content)).toEqual(['A', 'B']);
  });

  it('editing alone does not block append, and a live eligible row may precede an automatic row', () => {
    const f = fixture();
    f.fresh([
      queued('a', 'A', { editing: true }),
      queued('auto', 'automatic', { author: null, mergeEligible: false }),
    ]);
    f.accept('b', 'queue', { content: 'B' });
    expect(f.display().queue.map((s) => s.content)).toEqual(['A\n\nB', 'automatic']);
    expect(f.display().queue[0].confirmed?.editing).toBe(true);
  });

  it('does not accept foreign or unbound alias evidence', () => {
    const f = fixture();
    f.accept('a');
    f.event([queued('a', 'a', { author: bob })]);
    f.event([queued('a', 'a', { author: null })], 'history');
    expect(getItems(f.entry().submissions).map((s) => s.id)).toEqual(['a']);
  });

  it.each(['workspaceId', 'authority', 'principalId', 'participation', 'owner'] as const)(
    'rejects old callbacks after changing %s',
    (field) => {
      const f = fixture();
      f.accept('a');
      f.store.dispatch(pendingScopeActivated({ ...scope, [field]: 'changed' }, 1));
      f.settle('a', 'accepted', queued('a'));
      f.event([queued('a')], 'history');
      expect(getItems(f.entry().seeds)).toEqual([]);
      expect(getItems(f.entry().submissions)).toEqual([]);
      expect(
        admitPendingSubmission(f.store, scope, { content: 'stale', destination: 'conversation' }),
      ).toBeNull();
    },
  );

  it.each([
    backendReconnected(),
    principalContextChanged('different'),
    pendingScopeReleased(scope),
  ])('clears old scoped text on %j', (action) => {
    const f = fixture();
    f.accept('a');
    f.store.dispatch(action);
    f.settle('a', 'accepted', queued('a'));
    expect(f.entry()).toBeUndefined();
  });

  it('retains unresolved callback guards after terminal tombstones expire', () => {
    const f = fixture();
    f.accept('a');
    f.event([queued('a')], 'processing');
    f.store.dispatch(pendingRetentionPruned(scope, SUBMISSION_TOMBSTONE_TTL + 10));
    expect(getItems(f.entry().tombstones)).toEqual([]);
    expect(getItems(f.entry().operations).map((s) => [s.id, s.observed])).toEqual([['a', true]]);
    f.store.dispatch(
      pendingEvidenceObserved(scope, 'processing', [queued('a')], SUBMISSION_TOMBSTONE_TTL + 11),
    );
    expect(getItems(f.entry().tombstones)).toEqual([]);
    f.settle('a', 'accepted', queued('a'));
    expect(f.display().queue).toEqual([]);
    expect(getItems(f.entry().operations)).toEqual([]);
    expect(f.display().processing.map((s) => s.content)).toEqual(['a']);
    f.event([queued('a')], 'history');
    expect(f.display().conversation).toEqual([]);
  });

  it('bounds tombstones and refuses admission instead of silently evicting unsettled work', () => {
    const f = fixture();
    for (let i = 0; i < SUBMISSION_TOMBSTONE_LIMIT + 1; i++) {
      f.accept(`done-${i}`);
      f.settle(`done-${i}`, 'rejected');
    }
    expect(getItems(f.entry().tombstones)).toHaveLength(SUBMISSION_TOMBSTONE_LIMIT);
    expect(getItems(f.entry().tombstones)[0].id).toBe('done-1');
    for (let i = 0; i < PENDING_SUBMISSION_LIMIT; i++) f.accept(`pending-${i}`);
    expect(
      admitPendingSubmission(f.store, scope, {
        content: 'keep this draft',
        destination: 'conversation',
      }),
    ).toBeNull();
    expect(getItems(f.entry().submissions)).toHaveLength(PENDING_SUBMISSION_LIMIT);
  });
});
