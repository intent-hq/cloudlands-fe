import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import type {
  DeepLinksState,
  DeepLinkActionPayload,
  HomePageInitializerRequestPayload,
} from "./deep-links-types";

// Re-export types for backward compatibility
export type {
  DeepLinksState,
  DeepLinkActionPayload,
  HomePageInitializerRequest,
  HomePageInitializerRequestPayload,
} from "./deep-links-types";

export const initialState: DeepLinksState = {
  homePageInitializerRequest: null,
  pendingAction: null,
  processing: false,
  error: null,
};

// --- Home page initializer actions (existing) ---

export const requestHomePageInitializer = createAction<
  [payload: HomePageInitializerRequestPayload]
>("deepLinks/requestHomePageInitializer");

export const clearHomePageInitializerRequest = createAction(
  "deepLinks/clearHomePageInitializerRequest"
);

// --- Deep link processing actions (new) ---

export const deepLinkReceived = createAction<[action: DeepLinkActionPayload]>(
  "deepLinks/deepLinkReceived"
);

export const deepLinkProcessingComplete = createAction(
  "deepLinks/deepLinkProcessingComplete"
);

export const deepLinkError = createAction<[error: string]>(
  "deepLinks/deepLinkError"
);

export const clearPendingDeepLinkAction = createAction(
  "deepLinks/clearPendingDeepLinkAction"
);

export const deepLinksReducer = createReducer<DeepLinksState>(initialState)
  .with(requestHomePageInitializer, (state, { payload: [request] }) => ({
    ...state,
    homePageInitializerRequest: {
      nonce: (state.homePageInitializerRequest?.nonce ?? 0) + 1,
      applyPrefill: request.applyPrefill ?? false,
      focus: request.focus ?? false,
    },
  }))
  .with(clearHomePageInitializerRequest, (state) => ({
    ...state,
    homePageInitializerRequest: null,
  }))
  .with(deepLinkReceived, (state, { payload: [action] }) => ({
    ...state,
    pendingAction: action,
    processing: true,
    error: null,
  }))
  .with(deepLinkProcessingComplete, (state) => ({
    ...state,
    pendingAction: null,
    processing: false,
  }))
  .with(deepLinkError, (state, { payload: [error] }) => ({
    ...state,
    error,
    processing: false,
  }))
  .with(clearPendingDeepLinkAction, (state) => ({
    ...state,
    pendingAction: null,
  }));