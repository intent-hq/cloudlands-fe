import { selectBgSettings } from '../background-agent-settings-selectors';
import { createBackgroundSettingsSettlement } from './settle-background-settings-factory';
// Svelte compatibility binding, removed at renderer cutover.
export const settleBackgroundSettings = createBackgroundSettingsSettlement(selectBgSettings);
