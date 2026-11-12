import { store } from '$store/renderer/store';

/** Add machine → Intent on this computer. */
export const selectLocalIntentAdd = store.createSelector((state) => state.localIntentAdd);
