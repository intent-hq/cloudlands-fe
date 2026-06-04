import { delay, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import {
  clearUiHighlight,
  requestUiHighlight,
  UI_HIGHLIGHT_DURATION_MS,
} from '../ui-highlight-slice';
import { selectUiHighlightToken } from '../ui-highlight-selectors';

export function* handleRequestUiHighlight(
  action: ReturnType<typeof requestUiHighlight>,
): SagaGenerator<void> {
  const [highlightId, options] = action.payload;
  const id = highlightId.trim();
  if (!id) return;

  const token = yield* selectUiHighlightToken.effect(id);
  yield* delay(options?.durationMs ?? UI_HIGHLIGHT_DURATION_MS);
  yield* put(clearUiHighlight(id, token));
}

export function* uiHighlightSaga(): SagaGenerator<void> {
  yield* takeEvery(requestUiHighlight, handleRequestUiHighlight);
}
