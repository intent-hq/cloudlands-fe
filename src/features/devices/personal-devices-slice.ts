import { createAction } from '@themislib/themis/utils/store/create-action';
import type { SettingsFormRequest } from '$store/renderer/slices/settings-events/settings-events-types';

export const personalPairingRequested = createAction<
  [request: SettingsFormRequest, context: string, kind: 'pair' | 'copy']
>('personalDevices/pairingRequested');
