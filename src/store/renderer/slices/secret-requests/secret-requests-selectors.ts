import { store } from '../../store';
import type { SecretRequestsState } from './secret-requests-types';

/** The whole names-only secret-request state (listings + local answers). */
export const selectSecretRequestsState = store.createSelector(
  (state): SecretRequestsState => state.secretRequests,
);
