import { readConnectedPrincipal } from '@/features/principal/principal-client';
import { selectPrincipalConnectionContext, selectPrincipalState } from '../principal-selectors';
import { createPrincipalSaga } from '../../../../../../src/store/renderer/slices/principal/sagas/principal-saga-factory';
export const principalSaga = createPrincipalSaga({
  readConnectedPrincipal,
  selectPrincipalConnectionContext,
  principalStateEffect: selectPrincipalState.effect,
});
