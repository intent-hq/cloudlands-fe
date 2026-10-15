import { isNoteContentStale } from '$shared/utils/note-content';
import { runRecoveryRead, retireRecoveryReads } from '$lib/client/live/recovery-read-queue';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { call, getContext, take } from 'typed-redux-saga';
import {
  rendererEventRecovery,
  type RendererRecoveryScope,
  type RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { RendererStoreBridge } from '../../../renderer-store-bridge';
import { normalizeNote } from '$lib/client/live/live-notes-client';
import { normalizeComment } from '$lib/client/live/live-comments-client';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import {
  workspaceUnmounted,
  workspaceDeleted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  commentLoadRequested,
  commentLoadReleased,
  commentLoadFinished,
  replaceNoteCommentsAction,
} from '../../comments/comments-slice';
import {
  clearWorkspaceNotesForWorkspaces,
  loadWorkspaceNotesSucceeded,
  noteContentInvalidated,
  noteContentViewRequested,
  workspaceNotesHydrationRequested,
} from '../workspace-notes-slice';
import type { LineAttributionData } from '$lib/client';
import {
  noteAttributionViewRequested,
  noteAttributionViewReleased,
  noteAttributionViewFinished,
} from '../workspace-notes-slice';
import { toRuntimeNote } from './note-payload-mappers';

export const notesRecoveryKey = (workspaceId: string) => `notes:${JSON.stringify([workspaceId])}`;
export const commentsRecoveryKey = (workspaceId: string, noteId: string) =>
  `comments:${JSON.stringify([workspaceId, noteId])}`;
export const attributionRecoveryKey = (workspaceId: string, noteId: string) =>
  `attribution:${JSON.stringify([workspaceId, noteId])}`;
export function attributionEventRecoveryKey(payload: { workspaceId?: unknown; noteId?: unknown }) {
  return typeof payload.workspaceId === 'string' && typeof payload.noteId === 'string'
    ? attributionRecoveryKey(payload.workspaceId, payload.noteId)
    : undefined;
}
export const NOTE_RECOVERY_STORE = 'noteRecoveryStore';
const attributionDemands = new WeakMap<
  RendererStoreBridge,
  (consumerId: string, requestId: string, workspaceId: string, noteId: string) => void
>();
export function ensureAttributionRecovery(
  store: RendererStoreBridge,
  consumerId: string,
  requestId: string,
  workspaceId: string,
  noteId: string,
) {
  attributionDemands.get(store)?.(consumerId, requestId, workspaceId, noteId);
}
const commentDemands = new WeakMap<
  RendererStoreBridge,
  (consumerId: string, requestId: string, workspaceId: string, noteId: string) => void
>();
export function ensureCommentsRecovery(
  store: RendererStoreBridge,
  consumerId: string,
  requestId: string,
  workspaceId: string,
  noteId: string,
) {
  commentDemands.get(store)?.(consumerId, requestId, workspaceId, noteId);
}
const noteDemands = new WeakMap<RendererStoreBridge, (workspaceId: string) => void>();
export function ensureNotesRecovery(store: RendererStoreBridge, workspaceId: string) {
  noteDemands.get(store)?.(workspaceId);
}

/** Commit via the owning Redux store synchronously, inside the lifetime check. */
export function* commitNoteAction(lifetime: RecoveryLifetime, action: { type: string }) {
  const store = yield* getContext<RendererStoreBridge>(NOTE_RECOVERY_STORE);
  return yield* call(() =>
    lifetime.commit(() => {
      store.dispatch(action);
    }),
  );
}

/** Demand follows mounted note roots and open comment consumers; no workspace fanout. */
export function* notesRecoverySaga(store: RendererStoreBridge) {
  const workspaces = new Set<string>();
  const comments = new Map<
    string,
    { workspaceId: string; noteId: string; consumers: Map<string, string> }
  >();
  const attributions = new Map<
    string,
    { workspaceId: string; noteId: string; consumers: Map<string, string> }
  >();
  const attributionKeys = new Map<string, string>();
  const consumerKeys = new Map<string, string>();
  const handles = new Map<string, RendererRecoveryHandle>();
  let session: RendererRecoveryScope | undefined;
  const registerNotes = (workspaceId: string) => {
    const key = notesRecoveryKey(workspaceId);
    if (!session || handles.has(key)) return;
    const authority = selectPrincipalConnectionContext.select(store.state);
    handles.set(
      key,
      session.registerResource({
        key,
        workspaceId,
        eventTypes: ['note:*', 'task:*'],
        isCurrent: () =>
          workspaces.has(workspaceId) &&
          authority === selectPrincipalConnectionContext.select(store.state),
        read: ({ request, lifetime }) =>
          runRecoveryRead(key, lifetime, 'recovery', key, async () => {
            const result = await request<{ notes: Record<string, unknown>[] }>('note.list', {
              workspaceId,
              projection: 'slim',
            });
            return result.notes.map((raw) => toRuntimeNote(normalizeNote(raw, workspaceId)));
          }),
        apply: (notes) => {
          const original = rendererEventRecovery.captureAuthority(key);
          const current = store.state.workspaceNotes.byWorkspaceId[workspaceId];
          const staleIds: string[] = [];
          const rows = notes.map((note) => {
            const existing = current ? getItem(current.notes, note.id) : undefined;
            const slim = isNoteContentStale(note);
            if (slim) staleIds.push(String(note.id));
            return existing && (slim || current.pendingContentByNoteId[String(note.id)])
              ? { ...note, content: existing.content }
              : note;
          });
          store.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: rows }));
          for (const id of staleIds) store.dispatch(noteContentInvalidated(workspaceId, id));
          // The recovery resource clears its stale marker after synchronous apply.
          // Admit visible body reads only after that commit, under the same owner.
          queueMicrotask(() =>
            original.commit(() => {
              const latest = store.state.workspaceNotes.byWorkspaceId[workspaceId];
              if (!latest) return;
              for (const view of getItems(latest.contentViews)) {
                if (!staleIds.includes(view.noteId)) continue;
                store.dispatch(
                  noteContentViewRequested(
                    view.consumerId,
                    view.requestId,
                    workspaceId,
                    view.noteId,
                  ),
                );
              }
            }),
          );
        },
        invalidate: () => {},
        retire: () => {
          store.dispatch(clearWorkspaceNotesForWorkspaces([workspaceId]));
        },
      }),
    );
  };
  const registerComments = (key: string) => {
    const demand = comments.get(key);
    if (!session || !demand || handles.has(key)) return;
    const { workspaceId, noteId, consumers } = demand;
    const authority = selectPrincipalConnectionContext.select(store.state);
    handles.set(
      key,
      session.registerResource({
        key,
        workspaceId,
        eventTypes: ['comment:*', 'note:deleted'],
        active: consumers.size > 0,
        isCurrent: () =>
          comments.get(key) === demand &&
          authority === selectPrincipalConnectionContext.select(store.state),
        read: ({ request, lifetime }) =>
          runRecoveryRead(key, lifetime, 'recovery', key, async () => {
            const result = await request<{ threads: { comments?: Record<string, unknown>[] }[] }>(
              'comment.list',
              { workspaceId, noteId, includeComments: true },
            );
            return result.threads.flatMap((thread) =>
              (thread.comments ?? []).map((raw) => normalizeComment(raw, noteId, workspaceId)),
            );
          }),
        apply: (rows) => {
          store.dispatch(replaceNoteCommentsAction(workspaceId, noteId, rows));
          for (const [consumerId, requestId] of consumers)
            store.dispatch(commentLoadFinished(consumerId, requestId, workspaceId, authority));
        },
        invalidate: () => {},
        retire: () => {
          store.dispatch(replaceNoteCommentsAction(workspaceId, noteId, []));
        },
      }),
    );
  };
  const registerAttribution = (key: string) => {
    const demand = attributions.get(key);
    if (!session || !demand || handles.has(key)) return;
    const { workspaceId, noteId, consumers } = demand;
    const authority = selectPrincipalConnectionContext.select(store.state);
    const apply = (data: LineAttributionData | null): undefined => {
      for (const [consumerId, requestId] of consumers)
        store.dispatch(
          noteAttributionViewFinished(consumerId, requestId, workspaceId, authority, data),
        );
    };
    handles.set(
      key,
      session.registerResource({
        key,
        workspaceId,
        eventTypes: ['line-attribution:updated', 'note:updated', 'note:deleted'],
        active: consumers.size > 0,
        isCurrent: () =>
          attributions.get(key) === demand &&
          authority === selectPrincipalConnectionContext.select(store.state),
        read: ({ request, lifetime }) =>
          runRecoveryRead(key, lifetime, 'recovery', key, async () => {
            const data = await request<LineAttributionData | null>('note.lineAttribution.load', {
              workspaceId,
              noteId,
            });
            if (
              data !== null &&
              (String(data.workspaceId) !== workspaceId || String(data.noteId) !== noteId)
            )
              throw new Error('Attribution response scope mismatch');
            return data;
          }),
        apply,
        invalidate: () => {},
        retire: () => {
          apply(null);
        },
      }),
    );
  };
  const releaseAttribution = (consumerId: string) => {
    const key = attributionKeys.get(consumerId);
    if (!key) return;
    attributionKeys.delete(consumerId);
    const demand = attributions.get(key);
    demand?.consumers.delete(consumerId);
    if (demand?.consumers.size === 0) handles.get(key)?.setActive(false);
  };
  const demandAttribution = (
    consumerId: string,
    requestId: string,
    workspaceId: string,
    noteId: string,
  ) => {
    const key = attributionRecoveryKey(workspaceId, noteId);
    if (attributionKeys.get(consumerId) !== key) releaseAttribution(consumerId);
    let demand = attributions.get(key);
    if (!demand) {
      demand = { workspaceId, noteId, consumers: new Map() };
      attributions.set(key, demand);
    }
    demand.consumers.set(consumerId, requestId);
    attributionKeys.set(consumerId, key);
    registerAttribution(key);
    handles.get(key)?.setActive(true);
  };
  attributionDemands.set(store, demandAttribution);
  noteDemands.set(store, (workspaceId) => {
    workspaces.add(workspaceId);
    registerNotes(workspaceId);
  });
  const off = rendererEventRecovery.onSession((scope) => {
    session = scope;
    for (const workspaceId of workspaces) registerNotes(workspaceId);
    for (const key of comments.keys()) registerComments(key);
    for (const key of attributions.keys()) registerAttribution(key);
    return () => {
      for (const owner of handles.values()) owner.dispose();
      handles.clear();
      if (session === scope) session = undefined;
    };
  });
  const release = (consumerId: string) => {
    const key = consumerKeys.get(consumerId);
    if (!key) return;
    consumerKeys.delete(consumerId);
    const demand = comments.get(key);
    demand?.consumers.delete(consumerId);
    if (demand?.consumers.size === 0) handles.get(key)?.setActive(false);
  };
  const demandComments = (
    consumerId: string,
    requestId: string,
    workspaceId: string,
    noteId: string,
  ) => {
    const key = commentsRecoveryKey(workspaceId, noteId);
    if (consumerKeys.get(consumerId) !== key) release(consumerId);
    let demand = comments.get(key);
    if (!demand) {
      demand = { workspaceId, noteId, consumers: new Map() };
      comments.set(key, demand);
    }
    demand.consumers.set(consumerId, requestId);
    consumerKeys.set(consumerId, key);
    registerComments(key);
    handles.get(key)?.setActive(true);
  };
  commentDemands.set(store, demandComments);
  try {
    while (true) {
      const action: { type: string; payload?: unknown[] } = yield* take([
        workspaceNotesHydrationRequested,
        noteAttributionViewRequested,
        noteAttributionViewReleased,
        commentLoadRequested,
        commentLoadReleased,
        workspaceUnmounted,
        workspaceDeleted,
      ]);
      if (action.type === workspaceNotesHydrationRequested.type) {
        const workspaceId = String(action.payload?.[0] ?? '');
        if (workspaceId) {
          workspaces.add(workspaceId);
          registerNotes(workspaceId);
        }
      } else if (action.type === noteAttributionViewRequested.type) {
        const [consumerId, requestId, workspaceId, noteId] = action.payload as string[];
        demandAttribution(consumerId, requestId, workspaceId, noteId);
      } else if (action.type === noteAttributionViewReleased.type)
        releaseAttribution(String(action.payload?.[1]));
      else if (action.type === commentLoadRequested.type) {
        const [consumerId, requestId, workspaceId, noteId] = action.payload as string[];
        demandComments(consumerId, requestId, workspaceId, noteId);
      } else if (action.type === commentLoadReleased.type) release(String(action.payload?.[0]));
      else if (action.type === workspaceUnmounted.type || action.type === workspaceDeleted.type) {
        const workspaceId = String(action.payload?.[0]);
        workspaces.delete(workspaceId);
        retireRecoveryReads(notesRecoveryKey(workspaceId));
        for (const [key, demand] of attributions) {
          if (demand.workspaceId !== workspaceId) continue;
          for (const consumer of demand.consumers.keys()) attributionKeys.delete(consumer);
          retireRecoveryReads(key);
          handles.get(key)?.dispose();
          handles.delete(key);
          attributions.delete(key);
        }
        handles.get(notesRecoveryKey(workspaceId))?.dispose();
        handles.delete(notesRecoveryKey(workspaceId));
        for (const [key, demand] of comments) {
          if (demand.workspaceId !== workspaceId) continue;
          for (const consumer of demand.consumers.keys()) consumerKeys.delete(consumer);
          retireRecoveryReads(key);
          handles.get(key)?.dispose();
          handles.delete(key);
          comments.delete(key);
          store.dispatch(replaceNoteCommentsAction(workspaceId, demand.noteId, []));
        }
      }
    }
  } finally {
    noteDemands.delete(store);
    commentDemands.delete(store);
    attributionDemands.delete(store);
    off();
  }
}
