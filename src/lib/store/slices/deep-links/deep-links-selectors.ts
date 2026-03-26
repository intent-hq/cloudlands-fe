import { createSelector } from "../../utils/create-selector";

export const selectDeepLinks = createSelector((state) => {
  return state.deepLinks;
});

export const selectHomePageInitializerRequest = createSelector((state) => {
  return selectDeepLinks.select(state).homePageInitializerRequest;
});

export const selectHasHomePageInitializerRequest = createSelector((state) => {
  return selectHomePageInitializerRequest.select(state) !== null;
});