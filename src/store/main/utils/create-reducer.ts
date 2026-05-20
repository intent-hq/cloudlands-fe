/**
 * Package-backed createReducer re-export for main-process slices.
 * Keeps main imports out of renderer $lib/store/utils while avoiding a duplicate implementation.
 */
export { createReducer, type StoreReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
