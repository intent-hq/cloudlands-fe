import '@tanstack/react-start/client-only';
import { ReactStore } from '@themislib/themis/react-store';
import type { StoreState } from '@themislib/themis/types';
import { catalogReducer } from './catalog/catalog-slice';
import { uiHighlightReducer } from '../../../../src/store/renderer/slices/ui-highlight/ui-highlight-slice';

export const store = new ReactStore({ catalog: catalogReducer, uiHighlight: uiHighlightReducer });
export type AppState = StoreState<typeof store>;
