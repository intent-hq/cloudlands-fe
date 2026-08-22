import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { DeepLinksState } from './deep-links-types';

// Re-export types for backward compatibility
export type { DeepLinksState } from './deep-links-types';

export const initialState: DeepLinksState = {
  homePageInitializerRequest: null,
  pendingAction: null,
  processing: false,
  error: null,
};

export const deepLinksReducer = createReducer<DeepLinksState>(initialState);
