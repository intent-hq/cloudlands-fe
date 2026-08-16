import type { KnownRepo } from "$shared/types/known-repo";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import {
  createCollection,
  type Collection,
} from "@augmentcode/themis/utils/collections/collection-utils";

export type KnownReposState = {
  repos: Collection<KnownRepo, "path">;
  loaded: boolean;
};

export const initialState: KnownReposState = {
  repos: createCollection<KnownRepo, "path">("path"),
  loaded: false,
};

export const knownReposReducer = createReducer<KnownReposState>(initialState);
