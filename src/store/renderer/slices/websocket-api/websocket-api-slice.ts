import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { WebSocketApiState } from './websocket-api-types';

export const initialState: WebSocketApiState = {
  enabled: false,
  token: '',
  port: 5179,
  discoveryEnabled: false,
  discoveryExpiresAt: null,
  localIps: ['127.0.0.1'],
  certFingerprint: '',
  loading: true,
  regenerating: false,
  error: null,
  discoveryCountdownNow: null,
};

export const websocketApiReducer = createReducer<WebSocketApiState>(initialState);
