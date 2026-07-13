import { store } from "../../store";
import { type PipState } from "./pip-slice";

/** Select the entire pip state */
export const selectPipState = store.createSelector(
  (state): PipState => {
    return state.pip;
  }
);

