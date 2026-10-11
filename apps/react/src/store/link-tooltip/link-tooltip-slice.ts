import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { StoreReducerFunction } from '@themislib/themis/types';
import type { LinkTooltipPreview } from '@/lib/links/link-tooltip-types';
import type { LinkTooltipRequest, LinkTooltipState } from './link-tooltip-types';

export const linkTooltipRequested =
  createAction<[request: LinkTooltipRequest]>('linkTooltip/requested');
export const linkTooltipShown = createAction<[requestId: number]>('linkTooltip/shown');
export const linkTooltipHidden = createAction<[requestId?: number]>('linkTooltip/hidden');
export const linkTooltipPreviewChanged = createAction<
  [requestId: number, preview: LinkTooltipPreview]
>('linkTooltip/previewChanged');

const idlePreview: LinkTooltipPreview = { status: 'idle' };

export const linkTooltipReducer: StoreReducerFunction<LinkTooltipState> =
  createReducer<LinkTooltipState>({
    request: null,
    visible: false,
    shownRequestId: null,
    url: '',
    copied: false,
    preview: idlePreview,
  })
    .with(
      linkTooltipRequested,
      (
        state: LinkTooltipState,
        { payload: [request] }: ReturnType<typeof linkTooltipRequested>,
      ) => ({
        ...state,
        request,
        copied: false,
        preview: idlePreview,
      }),
    )
    .with(
      linkTooltipShown,
      (state: LinkTooltipState, { payload: [id] }: ReturnType<typeof linkTooltipShown>) =>
        state.request?.id !== id || (state.visible && state.shownRequestId === id)
          ? state
          : { ...state, visible: true, shownRequestId: id, url: state.request.url },
    )
    .with(
      linkTooltipHidden,
      (state: LinkTooltipState, { payload: [id] }: ReturnType<typeof linkTooltipHidden>) => {
        if (id !== undefined && state.request?.id !== id) return state;
        if (!state.request && !state.visible && state.preview.status === 'idle') return state;
        return {
          ...state,
          request: null,
          visible: state.copied,
          preview: idlePreview,
        };
      },
    )
    .with(
      linkTooltipPreviewChanged,
      (
        state: LinkTooltipState,
        { payload: [id, preview] }: ReturnType<typeof linkTooltipPreviewChanged>,
      ) =>
        state.request?.id !== id ||
        state.preview === preview ||
        (state.preview.status === 'idle' && preview.status === 'idle')
          ? state
          : { ...state, preview },
    );
