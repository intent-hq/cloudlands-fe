import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { call, takeEvery } from 'typed-redux-saga';
import { prepareOnboardingAdaptersRequested } from '../agent-availability-slice';
import type * as projections0 from '../agent-availability-projections';

import type { ReadSelector, ProviderReadState } from '../../provider-catalog/provider-read-types';

export function createProviderAdapterPreparationSaga<State extends ProviderReadState>({
  selectOnboardingAdapterPreparationContext,
  prepareOnboardingAdapters,
}: {
  selectOnboardingAdapterPreparationContext: ReadSelector<
    typeof projections0.getOnboardingAdapterPreparationContext,
    State
  >;
  prepareOnboardingAdapters: (context: string) => Promise<void>;
}) {
  function* prepareDetectedAdapters() {
    const context = yield* selectOnboardingAdapterPreparationContext.effect();
    if (context) yield* call(prepareOnboardingAdapters, context);
  }

  function* providerAdapterPreparationSaga() {
    yield* takeEvery(prepareOnboardingAdaptersRequested, prepareDetectedAdapters);
    yield* takeLatestFromSelector(
      selectOnboardingAdapterPreparationContext,
      function* ({ payload: context }: SelectorChannelPayload<string | null>) {
        if (context) yield* call(prepareOnboardingAdapters, context);
      },
    );
  }

  return { providerAdapterPreparationSaga };
}
