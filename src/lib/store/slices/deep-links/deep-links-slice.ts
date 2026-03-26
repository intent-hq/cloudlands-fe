import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

export type HomePageInitializerRequest = {
  nonce: number;
  applyPrefill: boolean;
  focus: boolean;
};

export type HomePageInitializerRequestPayload = {
  applyPrefill?: boolean;
  focus?: boolean;
};

export type DeepLinksState = {
  homePageInitializerRequest: HomePageInitializerRequest | null;
};

export const initialState: DeepLinksState = {
  homePageInitializerRequest: null,
};

export const requestHomePageInitializer = createAction<
  [payload: HomePageInitializerRequestPayload]
>("deepLinks/requestHomePageInitializer");

export const clearHomePageInitializerRequest = createAction(
  "deepLinks/clearHomePageInitializerRequest"
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
  }));