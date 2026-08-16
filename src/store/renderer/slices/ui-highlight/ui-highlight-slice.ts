import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type { UiHighlightState } from './ui-highlight-types';

export const UI_HIGHLIGHT_DURATION_MS = 2000;
export const UI_HIGHLIGHT_MAX_DURATION_MS = 30_000;

export const initialState: UiHighlightState = {
  activeById: {},
  durationMsById: {},
};

export type UiHighlightRequestOptions = {
  durationMs?: number;
};

export const requestUiHighlight = createAction<
  [highlightId: string, options?: UiHighlightRequestOptions]
>('uiHighlight/requestUiHighlight');

function normalizeHighlightId(highlightId: string): string {
  return highlightId.trim();
}

function normalizeDurationMs(durationMs: number | undefined): number | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return undefined;
  if (durationMs <= 0 || durationMs > UI_HIGHLIGHT_MAX_DURATION_MS) return undefined;
  return Math.round(durationMs);
}

export const uiHighlightReducer = createReducer<UiHighlightState>(initialState);
uiHighlightReducer.with(requestUiHighlight, (state, { payload: [highlightId, options] }) => {
    const id = normalizeHighlightId(highlightId);
    if (!id) return state;
    const durationMs = normalizeDurationMs(options?.durationMs);

    const { [id]: _removedDuration, ...durationMsByIdWithoutId } = state.durationMsById;

    return {
      ...state,
      activeById: {
        ...state.activeById,
        [id]: (state.activeById[id] ?? 0) + 1,
      },
      durationMsById:
        durationMs === undefined
          ? durationMsByIdWithoutId
          : {
              ...state.durationMsById,
              [id]: durationMs,
            },
    };
  });
