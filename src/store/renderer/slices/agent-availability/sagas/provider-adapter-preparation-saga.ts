import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { call, takeEvery } from 'typed-redux-saga';
import { prepareOnboardingAdapters } from '$features/providers/provider-adapter-preparation.client';
import { selectOnboardingAdapterPreparationContext } from '../agent-availability-selectors';
import { prepareOnboardingAdaptersRequested } from '../agent-availability-slice';

function* prepareDetectedAdapters() {
  const context = yield* selectOnboardingAdapterPreparationContext.effect();
  if (context) yield* call(prepareOnboardingAdapters, context);
}

export function* providerAdapterPreparationSaga() {
  yield* takeEvery(prepareOnboardingAdaptersRequested, prepareDetectedAdapters);
  yield* takeLatestFromSelector(
    selectOnboardingAdapterPreparationContext,
    function* ({ payload: context }: SelectorChannelPayload<string | null>) {
      if (context) yield* call(prepareOnboardingAdapters, context);
    },
  );
}
