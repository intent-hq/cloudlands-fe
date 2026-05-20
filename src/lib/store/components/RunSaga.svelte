<script lang="ts">
  import { type SagaName } from '../sagas';
  import { runSaga } from './run-saga';
  import { getStoreContext } from '../utils/svelte-context';

  const {
    sagaName,
  }: {
    sagaName: SagaName;
  } = $props();

  const storeContext = getStoreContext();

  $effect.pre(() => {
    if (!storeContext) return;
    return runSaga(sagaName);
  });
</script>

<span class="saga-marker" data-saga-name={sagaName}></span>

<style>
  .saga-marker {
    display: none;
  }
</style>
