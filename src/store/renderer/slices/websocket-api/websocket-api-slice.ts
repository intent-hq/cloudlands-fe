import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import type { WebSocketApiState, WebSocketApiIntent } from './websocket-api-types';
import type { SettingsFormRequest } from '../settings-events/settings-events-types';

export const websocketApiRequested =
  createAction<[request: SettingsFormRequest, intent: WebSocketApiIntent]>(
    'websocketApi/requested',
  );
export const websocketApiQrOpened =
  createAction<[request: SettingsFormRequest]>('websocketApi/qrOpened');

export const initialState: WebSocketApiState = {
  enabled: false,
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
