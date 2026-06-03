/**
 * Context slice types.
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

import type { Collection } from "ag-redux-toolkit/utils/collections/collection-utils";
import type { ContextItem } from "$features/context/types";

export type ContextWorkspaceState = {
  items: Collection<ContextItem, "id">;
  loading: boolean;
  error: string | null;
};

export type ContextState = {
  byWorkspaceId: Record<string, ContextWorkspaceState>;
};

