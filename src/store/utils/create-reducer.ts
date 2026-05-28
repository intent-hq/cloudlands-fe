/**
 * Re-export createReducer for main-process consumption.
 * Main-process slices should import from here instead of $lib/store/utils/.
 */
export { createReducer, type StoreReducer } from "$lib/store/utils/create-reducer";

