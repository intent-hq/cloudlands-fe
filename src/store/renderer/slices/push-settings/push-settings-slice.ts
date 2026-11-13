import { createAction } from '@themislib/themis/utils/store/create-action';
import type { SettingsFormRequest } from '../settings-events/settings-events-types';
import type { PushSettingsIntent } from './push-settings-types';

/** Form state belongs to settings-events; this domain owns only its typed intents. */
export const pushSettingsRequested = createAction<
  [request: SettingsFormRequest, intent: PushSettingsIntent]
>('pushSettings/requested');
