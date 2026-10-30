<script lang="ts">
  import {
    ListRow,
    ListView,
    RowActions,
    type ActionDefinition,
  } from '$lib/components/patterns/collection';
  import { Badge } from '$lib/components/ui/badge';
  import { faLinkSlash } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { ExecutorBackend } from '$shared/types/remote-machines';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectExecutorBackends,
    selectRemoteMachineFailures,
    selectRemoteMachineOperations,
  } from './remote-machines-selectors';
  import { executorRevokeRequested, remoteMachineFailureDismissed } from './remote-machines-slice';
  import { remoteMachineFailureMessage, runningAgentsLabel } from './remote-machines-messages';
  import { Button } from '$lib/components/ui/button';

  const backends$ = selectExecutorBackends();
  const operations$ = selectRemoteMachineOperations();
  const failures$ = selectRemoteMachineFailures();

  function actions(backend: ExecutorBackend): ActionDefinition[] {
    return [
      {
        id: 'revoke',
        label: m.remoteMachines_revoke_label(),
        icon: faLinkSlash,
        destructive: true,
        disabled: $operations$[backend.credentialId] === 'revoking',
      },
    ];
  }
</script>

{#if $backends$.length > 0}
  <section class="space-y-3" aria-labelledby="executor-backends-title">
    <div>
      <h3 id="executor-backends-title" class="type-title text-foreground">
        {m.remoteMachines_backends_title()}
      </h3>
      <p class="max-w-2xl type-body text-muted-foreground">
        {m.remoteMachines_backends_description()}
      </p>
    </div>
    <ListView
      virtualize={false}
      items={$backends$}
      getKey={(backend) => backend.credentialId}
      getText={(backend) => backend.backendName}
      ariaLabel={m.remoteMachines_backends_title()}
      class="overflow-visible rounded-xl border border-border bg-card [&>div>div[aria-hidden=true]]:hidden"
    >
      {#snippet row({ item: backend })}
        {@const failure = $failures$[backend.credentialId]}
        <article class="border-t border-border first:border-t-0" aria-label={backend.backendName}>
          <ListRow class="items-center px-4 sm:px-5 [&>[data-slot]]:self-center">
            {#snippet title()}{backend.backendName}{/snippet}
            {#snippet meta()}
              {#if backend.connected}
                <Badge variant="dot" color="green"
                  >{m.remoteMachines_backends_connected_label()}</Badge
                >
              {/if}
              {#if backend.runningAgents > 0}<span>{runningAgentsLabel(backend.runningAgents)}</span
                >{/if}
            {/snippet}
            {#snippet trailing()}
              <RowActions
                alwaysVisible
                actions={actions(backend)}
                onAction={() => appStore.dispatch(executorRevokeRequested(backend.credentialId))}
                visibleCount={0}
                overflowLabel={m.remoteMachines_actionsFor_ariaLabel({ name: backend.backendName })}
              />
            {/snippet}
          </ListRow>
          {#if failure}
            <div class="mx-4 mb-3 flex items-center justify-between gap-3 sm:mx-5" role="alert">
              <p class="type-body text-danger">
                {remoteMachineFailureMessage(failure, {
                  machine: backend.backendName,
                  backend: backend.backendName,
                })}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onclick={() =>
                  appStore.dispatch(remoteMachineFailureDismissed(backend.credentialId))}
              >
                {m.remoteMachines_failure_dismiss_label()}
              </Button>
            </div>
          {/if}
        </article>
      {/snippet}
    </ListView>
  </section>
{/if}
