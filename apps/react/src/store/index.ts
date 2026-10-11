import '@tanstack/react-start/client-only';
import { ReactStore } from '@themislib/themis/react-store';
import type { StoreState } from '@themislib/themis/types';
import { catalogReducer } from './catalog/catalog-slice';

export const store = new ReactStore({ catalog: catalogReducer });
export type AppState = StoreState<typeof store>;
