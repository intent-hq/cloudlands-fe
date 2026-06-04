import { store } from "../../store";
import type { PrBranchLookupEntry } from './pr-branch-lookup-types';

export const selectPrBranchLookupEntries = store.createSelector(
  (state): Record<string, PrBranchLookupEntry> => state.prBranchLookup?.byKey ?? {},
);

export const selectPrBranchLookupEntry = store.createSelector(
  (state, key: string): PrBranchLookupEntry | undefined =>
    key ? selectPrBranchLookupEntries.select(state)[key] : undefined,
);
