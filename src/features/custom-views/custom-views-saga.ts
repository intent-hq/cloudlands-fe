import { buffers } from 'redux-saga';
import {
  actionChannel,
  all,
  call,
  delay,
  put,
  select,
  take,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { invoke } from '$shared/generated/ipc-client';
import { hasCapability } from '$lib/utils/platform-capabilities';
import { customViewsChannels, type CustomViewsResponse } from '$shared/types/custom-views';
import {
  selectCustomViewRuntime,
  selectCustomViewsHaveActiveServers,
  selectCustomViewsState,
} from './custom-views-selectors';
import {
  closeCustomViewEditor,
  customViewFrameClosed,
  customViewFrameOpened,
  customViewFrameStatus,
  customViewsReceived,
  customViewsRequestFinished,
  customViewsRequestStarted,
  loadCustomViews,
  reloadCustomViewFrame,
  removeCustomView,
  saveCustomView,
  selectCustomView,
  startCustomView,
  stopCustomView,
} from './custom-views-slice';

type Request = ReturnType<
  | typeof loadCustomViews
  | typeof saveCustomView
  | typeof removeCustomView
  | typeof startCustomView
  | typeof stopCustomView
  | typeof selectCustomView
>;

function* requestWorker(action: Request): SagaGenerator<void> {
  if (!hasCapability('customViews')) {
    if (action.type !== selectCustomView.type)
      yield* put(customViewsRequestFinished('desktop-only', action.type !== loadCustomViews.type));
    return;
  }
  let channel: string;
  let payload: object | undefined;
  switch (action.type) {
    case loadCustomViews.type:
      channel = customViewsChannels.list;
      break;
    case saveCustomView.type:
      channel = customViewsChannels.save;
      payload = (action as ReturnType<typeof saveCustomView>).payload[0];
      break;
    case removeCustomView.type:
      channel = customViewsChannels.remove;
      payload = { id: (action as ReturnType<typeof removeCustomView>).payload[0] };
      break;
    case stopCustomView.type:
      channel = customViewsChannels.stop;
      payload = { id: (action as ReturnType<typeof stopCustomView>).payload[0] };
      break;
    case startCustomView.type:
      channel = customViewsChannels.start;
      payload = { id: (action as ReturnType<typeof startCustomView>).payload[0] };
      break;
    default: {
      const id = (action as ReturnType<typeof selectCustomView>).payload[0];
      if (!id) return;
      const runtime = yield* select(selectCustomViewRuntime.select, id);
      if (runtime && runtime.status !== 'stopped') return;
      channel = customViewsChannels.start;
      payload = { id };
    }
  }
  yield* put(customViewsRequestStarted(channel !== customViewsChannels.list));
  try {
    const response =
      payload === undefined
        ? yield* call(invoke<CustomViewsResponse>, channel)
        : yield* call(invoke<CustomViewsResponse>, channel, payload);
    if (!response?.success) {
      yield* put(
        customViewsRequestFinished(
          response?.error?.code ?? 'desktop-only',
          channel !== customViewsChannels.list,
        ),
      );
      return;
    }
    yield* put(customViewsReceived(response.data));
    if (channel === customViewsChannels.save) yield* put(closeCustomViewEditor());
    yield* put(customViewsRequestFinished(null, channel !== customViewsChannels.list));
  } catch {
    yield* put(customViewsRequestFinished('desktop-only', channel !== customViewsChannels.list));
  }
}

/** Serialize snapshots and mutations so a late poll cannot restore a deleted registration. */
function* requests(): SagaGenerator<void> {
  const queue = yield* actionChannel<Request>(
    [
      loadCustomViews.type,
      saveCustomView.type,
      removeCustomView.type,
      startCustomView.type,
      stopCustomView.type,
      selectCustomView.type,
    ],
    buffers.expanding(),
  );
  try {
    while (true) yield* call(requestWorker, yield* take(queue));
  } finally {
    queue.close();
  }
}

function* poll(): SagaGenerator<void> {
  if (!(yield* select(selectCustomViewsHaveActiveServers.select))) return;
  yield* delay(2000);
  yield* put(loadCustomViews());
}

function* frameTimeout(action: { type: string }): SagaGenerator<void> {
  if (action.type !== customViewFrameOpened.type && action.type !== reloadCustomViewFrame.type)
    return;
  const { frame } = yield* select(selectCustomViewsState.select);
  if (!frame.id) return;
  yield* delay(15000);
  yield* put(customViewFrameStatus(frame.id, frame.revision, 'slow'));
}

export function* customViewsSaga(): SagaGenerator<void> {
  yield* all([
    call(requests),
    takeLatest(customViewsRequestFinished, poll),
    takeLatest(
      [customViewFrameOpened, reloadCustomViewFrame, customViewFrameClosed, customViewFrameStatus],
      frameTimeout,
    ),
  ]);
}
