<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store } from '$store/renderer/store';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import {
    hostExecutionConnectionChanged,
    hostExecutionReceived,
  } from '$store/renderer/slices/host-execution/host-execution-slice';
  import {
    admitHostExecutionFixture,
    HOST_EXECUTION_FIXTURE,
  } from '../../test/fixtures/host-execution-state';

  function setup(enabled: boolean) {
    return () => {
      const previous = store.state;
      admitHostExecutionFixture('member', {
        ...HOST_EXECUTION_FIXTURE,
        gitCredentialPolicy: {
          ...HOST_EXECUTION_FIXTURE.gitCredentialPolicy,
          managedHelperEnabled: enabled,
        },
      });
      return () => {
        store.dispatch(principalContextChanged(previous.principal.context));
        if (previous.principal.snapshot && previous.principal.context)
          store.dispatch(
            principalReceived(
              { context: previous.principal.context, invalidation: 0, presentationVersion: 0 },
              previous.principal.snapshot,
            ),
          );
        store.dispatch(hostExecutionConnectionChanged(previous.hostExecution.connection));
        if (previous.hostExecution.connection && previous.hostExecution.context)
          store.dispatch(
            hostExecutionReceived(
              previous.hostExecution.connection,
              store.state.hostExecution.generation,
              previous.hostExecution.context,
            ),
          );
      };
    };
  }
  export const preview = definePreview({
    id: 'host-execution',
    title: 'Host execution recovery',
    defaultState: 'helper-disabled',
    states: {
      'helper-disabled': { props: {}, setup: setup(false) },
      'helper-enabled': { props: {}, setup: setup(true) },
    },
  });
</script>

<script lang="ts">
  import HostExecutionNotice from './HostExecutionNotice.svelte';
  import ModelPickerEmptyState from '$lib/components/chat/input/ModelPickerEmptyState.svelte';
</script>

<div class="space-y-4 p-4 max-w-lg">
  <ModelPickerEmptyState
    hostManaged={true}
    hasNoAvailableProvider={true}
    isLoadingModels={false}
    blockingLoadError={null}
    onOpenProviderSettings={() => {}}
    onRetry={() => {}}
  />
  <HostExecutionNotice kind="repository" />
  <HostExecutionNotice kind="git-policy" />
</div>
