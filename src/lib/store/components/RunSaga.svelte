<script lang="ts">
  import { type SagaName } from '../sagas';
  import { startSaga, stopSaga } from '../slices/saga-manager/saga-manager-slice';
  import { getDispatch } from '../utils/utils';

  const {
    sagaName,
  }: {
    sagaName: SagaName;
  } = $props();

  const dispatch = getDispatch();

  // Should start saga as soon as possible to reduce possible race conditions
  $effect.pre(() => {
    dispatch(startSaga(sagaName));
    return () => {
      dispatch(stopSaga(sagaName));
    };
  });
</script>

<span class="saga-marker" data-saga-name={sagaName}></span>

<style>
  .saga-marker {
    display: none;
  }
</style>
