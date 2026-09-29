import { createAction } from '@augmentcode/themis/utils/store/create-action';
import type { SettingsFormRequest } from '../settings-events/settings-events-types';
import type { RtkSettingsIntent } from './rtk-settings-types';

/** Form state belongs to settings-events; this domain owns only its typed intents. */
export const rtkSettingsRequested =
  createAction<[request: SettingsFormRequest, intent: RtkSettingsIntent]>('rtkSettings/requested');

export const rtkInstallStarted = createAction<[request: SettingsFormRequest, terminalId: string]>(
  'rtkSettings/installStarted',
);
