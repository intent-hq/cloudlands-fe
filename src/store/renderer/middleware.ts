import type { StoreMiddleware } from '@augmentcode/themis/types';

import { safeLocalStorage } from '$lib/utils/safe-storage';
import { createStoreGuardMiddleware } from '../../store/utils/store-guard-middleware';
import {
  REDUX_DEBUG_LS_KEY_STATE_REFS_KEY,
  REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY,
} from './constants';
import { createBatchingMiddleware } from './middlewares/batch';
import { createReferenceChangeDetectorMiddleware } from './middlewares/state-reference-checks';
import { createStructuredCloneCheckerMiddleware } from './middlewares/structured-clone-checker';

const isDevBuild = (): boolean =>
  Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

function buildMiddleware(): StoreMiddleware[] {
  const baseMiddleware: StoreMiddleware[] = [
    createStoreGuardMiddleware('renderer'),
    createBatchingMiddleware([]),
  ];
  const debugMiddleware: StoreMiddleware[] = [];

  if (typeof window !== 'undefined') {
    if (safeLocalStorage.getItem(REDUX_DEBUG_LS_KEY_STATE_REFS_KEY)) {
      debugMiddleware.push(createReferenceChangeDetectorMiddleware());
    }
    if (isDevBuild() || safeLocalStorage.getItem(REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY)) {
      debugMiddleware.push(createStructuredCloneCheckerMiddleware());
    }
  }

  return [...baseMiddleware, ...debugMiddleware];
}

export const middleware: StoreMiddleware[] = buildMiddleware();
