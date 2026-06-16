import { store } from "../../store";

const selectDeepLinks = store.createSelector((state) => {
  return state.deepLinks;
});

export const selectHomePageInitializerRequest = store.createSelector((state) => {
  return selectDeepLinks.select(state).homePageInitializerRequest;
});

export const selectPendingDeepLinkAction = store.createSelector((state) => {
  return selectDeepLinks.select(state).pendingAction;
});