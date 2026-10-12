import { store } from '@/store';
import { backendRequest } from '../backend/backend-transport';
import { settingsRuntime } from '../settings/settings-client';
import {
  selectCanAdministerHost,
  selectPrincipalConnectionContext,
} from '../../store/principal/principal-selectors';
import { createKnownRepositoriesReader } from '../../../../../src/store/renderer/slices/known-repos/known-repositories-read-factory';

/** Inactive daemon read binding; callers own admission and lifecycle activation. */
export const { readKnownRepositories } = createKnownRepositoriesReader({
  backendRequest,
  readSetting: settingsRuntime.readSetting,
  currentConnection: () => selectPrincipalConnectionContext.select(store.state),
  canAdministerHost: () => selectCanAdministerHost.select(store.state),
});
