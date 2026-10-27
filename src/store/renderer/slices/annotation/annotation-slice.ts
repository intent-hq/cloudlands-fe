import {
  createCollection,
  getItem,
  getItems,
  upsertItem,
  removeItem,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import { MAX_ANNOTATION_CAPTURES } from '$features/annotation/annotation-types';
import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type {
  AnnotationSessionState,
  AnnotationDestination,
  SetAnnotationDestinationRequest,
  SetAnnotationToolbarLayoutRequest,
  RequestAnnotationSendRequest,
  RequestAnnotationScreenshot,
  ReportAnnotationScreenshot,
  ReportAnnotationDeliveryRequest,
  AnnotationStateResult,
  AnnotationTool,
  StartAnnotationRequest,
} from '$shared/annotation';

import type {
  AnnotationFrame,
  AnnotationEvidence,
  AnnotationRecipient,
  AnnotationSubmission,
  AnnotationWorkspace,
} from '$features/annotation/annotation-types';
import type { WireImageBlock } from '$shared/types/wire-image-block';

interface PreparedAnnotationImage {
  id: string;
  block: WireImageBlock;
}

export interface AnnotationState {
  draft: {
    startedAt: number | null;
    message: string;
    transcriptCount: number;
    recipientId: string;
    frames: Collection<AnnotationFrame, 'id'>;
  };
  workspaces: Collection<AnnotationWorkspace, 'id'>;
  recipients: Collection<AnnotationRecipient, 'id'>;
  recipientsWorkspaceId: string | null;
  createdRecipient: AnnotationRecipient | null;
  uncertainMessageId: string | null;
  submission:
    | (Omit<AnnotationSubmission, 'frames'> & { frames: Collection<AnnotationEvidence, 'id'> })
    | null;
  preparedDelivery: {
    messageId: string;
    workspaceId?: string;
    blocks: Collection<PreparedAnnotationImage, 'id'>;
  } | null;
  lastEvent: AnnotationSessionState | null;
  eventRevision: number;
  deliveryPending: boolean;
  deliverySucceeded: boolean;
}

const initialAnnotationState: AnnotationState = {
  draft: {
    startedAt: null,
    message: '',
    transcriptCount: 0,
    recipientId: '',
    frames: createCollection<AnnotationFrame, 'id'>('id'),
  },
  workspaces: createCollection<AnnotationWorkspace, 'id'>('id'),
  recipients: createCollection<AnnotationRecipient, 'id'>('id'),
  recipientsWorkspaceId: null,
  createdRecipient: null,
  uncertainMessageId: null,
  submission: null,
  preparedDelivery: null,
  lastEvent: null,
  eventRevision: 0,
  deliveryPending: false,
  deliverySucceeded: false,
};

export const startAnnotationRequested = createAsyncAction<[request: StartAnnotationRequest], void>(
  'annotation/start',
  'annotation/startRequested',
);
export const getAnnotationStateRequested = createAsyncAction<[], AnnotationStateResult>(
  'annotation/getState',
  'annotation/getStateRequested',
);
export const setAnnotationToolRequested = createAsyncAction<[tool: AnnotationTool], void>(
  'annotation/setTool',
  'annotation/setToolRequested',
);
export const addAnnotationTranscriptRequested = createAsyncAction<
  [text: string, startedAt?: number],
  void
>('annotation/addTranscript', 'annotation/addTranscriptRequested');
export const setAnnotationToolbarLayoutRequested = createAsyncAction<
  [request: SetAnnotationToolbarLayoutRequest],
  void
>('annotation/setToolbarLayout', 'annotation/setToolbarLayoutRequested');
export const setAnnotationDestinationRequested = createAsyncAction<
  [request: SetAnnotationDestinationRequest],
  void
>('annotation/setDestination', 'annotation/setDestinationRequested');
export const requestAnnotationSendRequested = createAsyncAction<
  [request: RequestAnnotationSendRequest],
  void
>('annotation/requestSend', 'annotation/requestSendRequested');
export const reportAnnotationDeliveryRequested = createAsyncAction<
  [request: ReportAnnotationDeliveryRequest],
  void
>('annotation/reportDelivery', 'annotation/reportDeliveryRequested');
export const requestAnnotationScreenshotRequested = createAsyncAction<
  [request: RequestAnnotationScreenshot],
  void
>('annotation/requestScreenshot', 'annotation/requestScreenshotRequested');
export const reportAnnotationScreenshotRequested = createAsyncAction<
  [request: ReportAnnotationScreenshot],
  void
>('annotation/reportScreenshot', 'annotation/reportScreenshotRequested');
export const resolveAnnotationRecipientRequested = createAsyncAction<
  [destination: AnnotationDestination, requestId?: string],
  AnnotationRecipient
>('annotation/resolveRecipient', 'annotation/resolveRecipientRequested');
export const reviewAnnotationRequested = createAsyncAction<[], void>(
  'annotation/review',
  'annotation/reviewRequested',
);
export const closeAnnotationRequested = createAsyncAction<[], void>(
  'annotation/close',
  'annotation/closeRequested',
);
export const annotationStateReceived = createAction<[state: AnnotationSessionState]>(
  'annotation/stateReceived',
);

export const annotationReducer = createReducer(initialAnnotationState);
annotationReducer.with(annotationStateReceived, (state, { payload: [event] }) => ({
  ...state,
  lastEvent: event,
  eventRevision: state.eventRevision + 1,
}));

export const annotationDraftStarted = createAction<[startedAt: number]>('annotation/draftStarted');
export const annotationMessageChanged = createAction<[message: string]>(
  'annotation/messageChanged',
);
const annotationRecipientChanged = createAction<[recipientId: string]>(
  'annotation/recipientChanged',
);
export const annotationFrameSaved = createAction<[frame: AnnotationFrame]>('annotation/frameSaved');
const annotationFrameRemoved = createAction<[id: string]>('annotation/frameRemoved');
export const annotationCreatedRecipient = createAction<[recipient: AnnotationRecipient]>(
  'annotation/createdRecipient',
);
export const annotationDeliveryPrepared = createAction<
  [messageId: string, blocks: WireImageBlock[], workspaceId?: string]
>('annotation/deliveryPrepared');
export const loadAnnotationWorkspacesRequested = createAsyncAction<[], AnnotationWorkspace[]>(
  'annotation/workspaces',
  'annotation/workspacesRequested',
);
export const loadAnnotationRecipientsRequested = createAsyncAction<
  [workspaceId: string],
  AnnotationRecipient[]
>('annotation/recipients', 'annotation/recipientsRequested');
export const submitAnnotationRequested = createAsyncAction<
  [submission: AnnotationSubmission],
  void
>('annotation/submit', 'annotation/submitRequested');

annotationReducer.with(annotationDraftStarted, (state, { payload: [startedAt] }) =>
  state.draft.startedAt === startedAt
    ? state
    : {
        ...state,
        draft: { ...initialAnnotationState.draft, startedAt },
        createdRecipient: null,
        preparedDelivery: null,
        uncertainMessageId: null,
        submission: null,
        deliverySucceeded: false,
      },
);
annotationReducer.with(annotationMessageChanged, (state, { payload: [message] }) => ({
  ...state,
  draft: { ...state.draft, message },
  preparedDelivery: null,
}));
annotationReducer.with(annotationRecipientChanged, (state, { payload: [recipientId] }) => ({
  ...state,
  draft: { ...state.draft, recipientId },
  preparedDelivery: null,
}));
annotationReducer.with(annotationFrameSaved, (state, { payload: [frame] }) => {
  if (
    !getItem(state.draft.frames, frame.id) &&
    getItems(state.draft.frames).length >= MAX_ANNOTATION_CAPTURES
  )
    return state;
  return {
    ...state,
    draft: { ...state.draft, frames: upsertItem(state.draft.frames, frame) },
    preparedDelivery: null,
  };
});
annotationReducer.with(annotationFrameRemoved, (state, { payload: [id] }) => ({
  ...state,
  draft: { ...state.draft, frames: removeItem(state.draft.frames, id) },
  preparedDelivery: null,
}));
annotationReducer.with(annotationCreatedRecipient, (state, { payload: [recipient] }) => ({
  ...state,
  createdRecipient: recipient,
}));
annotationReducer.with(
  annotationDeliveryPrepared,
  (state, { payload: [messageId, blocks, workspaceId] }) => ({
    ...state,
    preparedDelivery: {
      messageId,
      workspaceId,
      blocks: createCollection(
        'id',
        blocks.map((block, index) => ({ id: `${messageId}:${index}`, block })),
      ),
    },
  }),
);
annotationReducer.with(loadAnnotationWorkspacesRequested.success, (state, { payload }) => ({
  ...state,
  workspaces: createCollection('id', payload.response),
}));
annotationReducer.with(loadAnnotationRecipientsRequested, (state, { payload: [workspaceId] }) => ({
  ...state,
  recipientsWorkspaceId: workspaceId,
  recipients: createCollection<AnnotationRecipient, 'id'>('id'),
}));
annotationReducer.with(loadAnnotationRecipientsRequested.success, (state, { payload }) =>
  payload.request[0] !== state.recipientsWorkspaceId
    ? state
    : {
        ...state,
        recipients: createCollection('id', payload.response),
      },
);

export const annotationSubmissionRemembered = createAction<[submission: AnnotationSubmission]>(
  'annotation/submissionRemembered',
);
annotationReducer.with(annotationSubmissionRemembered, (state, { payload: [submission] }) => ({
  ...state,
  submission: { ...submission, frames: createCollection('id', submission.frames) },
  deliverySucceeded: false,
}));

export const annotationDeliveryUncertain = createAction<[messageId: string]>(
  'annotation/deliveryUncertain',
);
annotationReducer.with(annotationDeliveryUncertain, (state, { payload: [messageId] }) => ({
  ...state,
  uncertainMessageId: state.uncertainMessageId ?? messageId,
}));

export const annotationDeliveryPending = createAction<[pending: boolean]>(
  'annotation/deliveryPending',
);
annotationReducer.with(annotationDeliveryPending, (state, { payload: [deliveryPending] }) => ({
  ...state,
  deliveryPending,
}));

export const annotationTranscriptsReceived = createAction<[transcripts: string[]]>(
  'annotation/transcriptsReceived',
);
annotationReducer.with(annotationTranscriptsReceived, (state, { payload: [transcripts] }) => {
  if (transcripts.length <= state.draft.transcriptCount) return state;
  const added = transcripts.slice(state.draft.transcriptCount);
  return {
    ...state,
    draft: {
      ...state.draft,
      message: [state.draft.message, ...added].filter(Boolean).join('\n\n'),
      transcriptCount: transcripts.length,
    },
    preparedDelivery: null,
  };
});
export const annotationDeliverySucceeded = createAction<[]>('annotation/deliverySucceeded');
annotationReducer.with(annotationDeliverySucceeded, (state) => ({
  ...state,
  deliverySucceeded: true,
  uncertainMessageId: null,
}));
