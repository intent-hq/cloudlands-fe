<script lang="ts">
  import {
    selectHostExecutionContext,
    selectIsHostMember,
  } from '$store/renderer/slices/host-execution/host-execution-selectors';
  import { m } from '$shared/paraglide/messages.js';

  let { kind = 'git-policy' }: { kind?: 'git-policy' | 'repository' | 'ai' } = $props();
  const member$ = selectIsHostMember();
  const execution$ = selectHostExecutionContext();
  const message = $derived(
    !$member$
      ? null
      : kind === 'ai'
        ? m.hostExecution_providerSetup_description()
        : kind === 'repository'
          ? $execution$ && !$execution$.repositoryConnections.some((row) => row.configured)
            ? m.hostExecution_repositorySetup_description()
            : null
          : $execution$?.gitCredentialPolicy.managedHelperEnabled === false
            ? m.hostExecution_disabledHelper_description({
                setting: $execution$.gitCredentialPolicy.setting,
              })
            : null,
  );
</script>

{#if message}
  <p class="type-caption text-muted-foreground px-2 py-1" role="status">{message}</p>
{/if}
