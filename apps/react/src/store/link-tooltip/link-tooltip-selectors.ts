import { store } from '@/store';

export const selectLinkTooltip = store.createSelector((state) => state.linkTooltip);
export const selectLinkTooltipRequest = store.createSelector((state) => state.linkTooltip.request);
export const selectLinkTooltipConnectionGeneration = store.createSelector(
  (state) => state.daemonHealth.connectionGeneration,
);
