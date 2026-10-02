import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectQuestionUiConsumers = store.createSelector(
  (state) => state.questionUi.consumers,
);

export const selectQuestionUiConsumer = store.createSelector((state, consumerId: string) =>
  getItem(state.questionUi.consumers, consumerId),
);
