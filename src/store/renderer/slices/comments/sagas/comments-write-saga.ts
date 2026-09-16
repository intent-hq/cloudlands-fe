import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { commentsClient } from '$features/comments/comments.client';
import type { MutationResult } from '$lib/client';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { toast } from 'svelte-sonner';
import { enqueueRevBumpingNoteMutation } from '../../workspace-notes/note-mutation-queue';
import { selectCommentById } from '../comments-selectors';
import {
  addCommentAction,
  addCommentRequested,
  deleteCommentRequested,
  removeCommentAction,
  respondToCommentRequested,
  resolveCommentRequested,
  updateCommentAction,
} from '../comments-slice';

const logger = createLogger('CommentsWriteSaga');

function* addCommentWorker(action: ReturnType<typeof addCommentRequested>): SagaGenerator<void> {
  const [noteId, optimistic, params] = action.payload;
  let settled = false;
  try {
    yield* put(addCommentAction(optimistic));
    const result: MutationResult = params.workspaceId
      ? yield* call(enqueueRevBumpingNoteMutation, params.workspaceId, noteId, () =>
          appClient.comments.add(noteId, params),
        )
      : yield* call([appClient.comments, appClient.comments.add], noteId, params);
    if (!result.success) {
      yield* put(removeCommentAction(optimistic.id));
      toast.error(m.comments_writeService_addFailed_error(), {
        description: result.error ?? m.comments_writeService_unknown_error(),
      });
      yield* put(action.success(false));
      settled = true;
      return;
    }
    yield* put(action.success(true));
    settled = true;
  } catch (error) {
    logger.error('Failed to add comment', error);
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(removeCommentAction(optimistic.id));
      yield* put(action.failure(new Error('Comment add cancelled')));
    }
  }
}

function* respondToCommentWorker(
  action: ReturnType<typeof respondToCommentRequested>,
): SagaGenerator<void> {
  const [noteId, optimistic, params] = action.payload;
  let settled = false;
  try {
    yield* put(addCommentAction(optimistic));
    const result: MutationResult = yield* call(
      [appClient.comments, appClient.comments.respond],
      noteId,
      params,
    );
    if (!result.success) {
      yield* put(removeCommentAction(optimistic.id));
      toast.error(m.comments_writeService_replyFailed_error(), {
        description: result.error ?? m.comments_writeService_unknown_error(),
      });
      yield* put(action.success(false));
      settled = true;
      return;
    }
    yield* put(action.success(true));
    settled = true;
  } catch (error) {
    logger.error('Failed to respond to comment', error);
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(removeCommentAction(optimistic.id));
      yield* put(action.failure(new Error('Comment reply cancelled')));
    }
  }
}

function* deleteCommentWorker(
  action: ReturnType<typeof deleteCommentRequested>,
): SagaGenerator<void> {
  const [noteId, commentId, workspaceId] = action.payload;
  let settled = false;
  const snapshot = yield* selectCommentById.effect(commentId);
  try {
    yield* put(removeCommentAction(commentId));
    const result: MutationResult = yield* call(
      [appClient.comments, appClient.comments.delete],
      noteId,
      commentId,
      workspaceId,
    );
    if (!result.success) {
      if (snapshot) yield* put(addCommentAction(snapshot));
      toast.error(m.comments_writeService_deleteFailed_error(), {
        description: result.error ?? m.comments_writeService_unknown_error(),
      });
      yield* put(action.success({ existed: !!snapshot, success: false }));
      settled = true;
      return;
    }
    yield* put(action.success({ existed: !!snapshot, success: true }));
    settled = true;
  } catch (error) {
    logger.error('Failed to delete comment', error);
    if (snapshot) yield* put(addCommentAction(snapshot));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      if (snapshot) yield* put(addCommentAction(snapshot));
      yield* put(action.failure(new Error('Comment delete cancelled')));
    }
  }
}

function* resolveCommentWorker(
  action: ReturnType<typeof resolveCommentRequested>,
): SagaGenerator<void> {
  const [workspaceId, commentId, noteId] = action.payload;
  let settled = false;
  const existing = yield* selectCommentById.effect(commentId);
  if (!existing) {
    yield* put(action.success(false));
    return;
  }
  try {
    yield* put(updateCommentAction(commentId, { status: 'resolved' }));
    const result = yield* call(() =>
      commentsClient.updateStatus({
        workspaceId,
        noteId,
        commentId,
        status: 'resolved',
      }),
    );
    if (!result.ok) {
      yield* put(updateCommentAction(commentId, { status: existing.status }));
    }
    yield* put(action.success(result.ok));
    settled = true;
  } catch (error) {
    logger.error('Failed to resolve comment', error);
    yield* put(updateCommentAction(commentId, { status: existing.status }));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(updateCommentAction(commentId, { status: existing.status }));
      yield* put(action.failure(new Error('Comment resolve cancelled')));
    }
  }
}

export function* commentsWriteSaga(): SagaGenerator<void> {
  yield* takeEvery(addCommentRequested, addCommentWorker);
  yield* takeEvery(respondToCommentRequested, respondToCommentWorker);
  yield* takeEvery(deleteCommentRequested, deleteCommentWorker);
  yield* takeEvery(resolveCommentRequested, resolveCommentWorker);
}
