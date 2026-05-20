/**
 * Re-export createReducer for main-process consumption.
 * Main-process slices should import from here instead of $lib/store/utils/.
 */
export { createReducer, type StoreReducer } from "svelte-redux-toolkit/utils/store/create-reducer";

