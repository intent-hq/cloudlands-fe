import { takeEveryFromSelector, takeLatestFromSelector } from '@themislib/themis/saga';
import { buffers, eventChannel } from 'redux-saga';
import { call, delay, join, put, take } from 'typed-redux-saga';
import { captureIntegrationContext } from '@/features/integrations/integrations-request-context';
import { linkPreviewService } from '@/features/link-preview/link-preview-service';
import {
  classifyGitHubLinkPreviewError,
  type GitLabPreviewUpdate,
} from '$lib/client/live/link-preview-service';
import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
import {
  selectLinkTooltipConnectionGeneration,
  selectLinkTooltipRequest,
} from '../link-tooltip-selectors';
import {
  linkTooltipHidden,
  linkTooltipPreviewChanged,
  linkTooltipShown,
} from '../link-tooltip-slice';
import type { LinkTooltipRequest } from '../link-tooltip-types';

function* previewHover({ payload: request }: { payload: LinkTooltipRequest | null }) {
  if (!request) return;
  const { id, url, workspaceId } = request;
  // Source interaction delay, not an animation duration.
  yield* delay(300);
  yield* put(linkTooltipShown(id));
  const context = yield* call(captureIntegrationContext, workspaceId);
  if (parseGitHubIssueOrPrUrl(url)) {
    const controller = new AbortController();
    try {
      yield* put(linkTooltipPreviewChanged(id, { status: 'loading' }));
      const data = yield* call(linkPreviewService.loadGitHubLinkPreview, url, {
        workspaceId,
        signal: controller.signal,
      });
      if (context.isCurrent()) {
        yield* put(
          linkTooltipPreviewChanged(id, data ? { status: 'ready', data } : { status: 'idle' }),
        );
      }
    } catch (error) {
      if (context.isCurrent()) {
        yield* put(
          linkTooltipPreviewChanged(id, {
            status: 'error',
            reason: classifyGitHubLinkPreviewError(error),
          }),
        );
      }
    } finally {
      // Abort retires this consumer; the shared transport promise remains available
      // to a later hover of the same URL in the same connection/workspace context.
      controller.abort();
    }
    return;
  }

  const channel = yield* call(() =>
    eventChannel<GitLabPreviewUpdate>(
      (emit) => linkPreviewService.observeGitLabLinkPreview(url, workspaceId, emit),
      buffers.sliding(1),
    ),
  );
  try {
    while (true) {
      const update = yield* take(channel);
      if (!context.isCurrent()) return;
      yield* put(linkTooltipPreviewChanged(id, update));
      if (update.status === 'idle') return;
      // Keep settled GitLab resources alive until hide/retirement. Closing after
      // ready would discard the resource's identity/connection retirement callback.
    }
  } finally {
    channel.close();
  }
}

/** The application root starts exactly one owner after Store.init(). */
export function* linkTooltipSaga() {
  const previews = yield* takeLatestFromSelector(selectLinkTooltipRequest, previewHover);
  const reconnects = yield* takeEveryFromSelector(
    selectLinkTooltipConnectionGeneration,
    function* ({ prevPayload }) {
      // Initial subscription is not a reconnect. Real connection changes retire
      // pending and settled previews before any later response can be displayed.
      if (prevPayload !== undefined && prevPayload !== null) yield* put(linkTooltipHidden());
    },
  );
  try {
    yield* join([previews, reconnects]);
  } finally {
    yield* put(linkTooltipHidden());
  }
}
