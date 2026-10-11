import { store } from '@/store';
import { getCurrentConnectionId } from '../../../../../src/store/renderer/slices/connections/connections-projections';
export const selectCurrentConnectionId = store.createSelector(getCurrentConnectionId);
// Settings read binding uses this compatibility name; one selector owns both entry points.
export const selectWindowBackendId = selectCurrentConnectionId;
