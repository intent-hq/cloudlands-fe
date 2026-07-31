import type { StoreMiddleware } from '@augmentcode/themis/types';

import { createChatSubscribeMiddleware } from '$features/agent/chat-subscribe-service';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { createStoreGuardMiddleware } from '../../store/utils/store-guard-middleware';
import {
  REDUX_DEBUG_LS_KEY,
  REDUX_DEBUG_LS_KEY_STATE_REFS_KEY,
  REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY,
} from './constants';
import { createBatchingMiddleware } from './middlewares/batch';
import { createLoggerMiddleware } from './middlewares/logger';
import { createReferenceChangeDetectorMiddleware } from './middlewares/state-reference-checks';
import { createStructuredCloneCheckerMiddleware } from './middlewares/structured-clone-checker';

const isDevBuild = (): boolean =>
  Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

function getReduxLoggerConfig(): { enabled: boolean; webviewName?: string } {
  if (typeof window === 'undefined') return { enabled: false };

  const globallyEnabled = (window as any).intentFlags?.enableReduxLogger;
  let localStorageEnabled: boolean | undefined;
  const { value, hadError } = safeLocalStorage.getItemWithStatus(REDUX_DEBUG_LS_KEY);

  if (hadError) {
    localStorageEnabled = false;
  } else if (value != null && value !== 'undefined') {
    try {
      localStorageEnabled = !!JSON.parse(value);
    } catch (error) {
      console.warn(`Failed to parse ${REDUX_DEBUG_LS_KEY} from localStorage:`, error);
      localStorageEnabled = false;
    }
  }

  return {
    enabled: globallyEnabled ?? localStorageEnabled ?? isDevBuild(),
    webviewName: globallyEnabled ? (window as any).intentFlags?.webviewName : '',
  };
}

function buildMiddleware(): StoreMiddleware[] {
  const baseMiddleware: StoreMiddleware[] = [
    createStoreGuardMiddleware('renderer'),
    createBatchingMiddleware([]),
    createChatSubscribeMiddleware(),
  ];
  const debugMiddleware: StoreMiddleware[] = [];

  if (typeof window !== 'undefined') {
    if (safeLocalStorage.getItem(REDUX_DEBUG_LS_KEY_STATE_REFS_KEY)) {
      debugMiddleware.push(createReferenceChangeDetectorMiddleware());
    }
    if (isDevBuild() || safeLocalStorage.getItem(REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY)) {
      debugMiddleware.push(createStructuredCloneCheckerMiddleware());
    }

    const { enabled, webviewName } = getReduxLoggerConfig();
    if (enabled) debugMiddleware.push(createLoggerMiddleware(webviewName));
  }

  return [...baseMiddleware, ...debugMiddleware];
}

export const middleware: StoreMiddleware[] = buildMiddleware();
