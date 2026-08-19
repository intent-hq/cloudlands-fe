<script lang="ts">
  import AgentAvatarStack, { type AgentAvatarStackItem } from './AgentAvatarStack.svelte';
  import AgentAvatarWithState from './AgentAvatarWithState.svelte';
  import { agentAvatarCatalogIdentities, agentAvatarCatalogStates } from './agent-avatar.catalog';
  import type { AvatarState } from './avatar-state';
  import { agentAvatarVariants } from './avatar-size';

  const catalogStackStates = [
    'running',
    'unread',
    'attention-discussion',
  ] as const satisfies readonly AvatarState[];
  const catalogStackItems = Array.from({ length: 6 }, (_, index): AgentAvatarStackItem => ({
    key: `catalog-stack-${index}`,
    agentId: `catalog-stack-${index}`,
    specialist: 'coordinator',
    state: catalogStackStates[index % catalogStackStates.length],
  }));
</script>

<div class="agent-avatar-catalog" data-agent-avatar-catalog>
  {#each agentAvatarCatalogIdentities as identity (identity.design)}
    <div class="agent-avatar-catalog-row" data-catalog-avatar-design={identity.design}>
      <!-- i18n-ignore (stable Figma design identifier) -->
      <code>{identity.design}</code>
      <div class="agent-avatar-catalog-states">
        {#each agentAvatarCatalogStates as state (state)}
          <AgentAvatarWithState
            agentId={identity.agentId}
            specialist={identity.specialist}
            {state}
            variant="standard"
          />
        {/each}
      </div>
    </div>
  {/each}
  <div class="agent-avatar-catalog-variants" data-agent-avatar-catalog-variants>
    {#each agentAvatarVariants as variant (variant)}
      <AgentAvatarWithState
        agentId="catalog-variant"
        specialist="coordinator"
        state="running"
        {variant}
      />
    {/each}
  </div>
  <div class="agent-avatar-catalog-stack" data-agent-avatar-catalog-stack>
    <AgentAvatarStack items={catalogStackItems} maxVisible={3} variant="emphasized" />
  </div>
</div>

<style>
  .agent-avatar-catalog {
    display: grid;
    gap: 0.375rem;
    min-width: max-content;
    padding: 0.5rem;
  }
  .agent-avatar-catalog-row {
    display: grid;
    grid-template-columns: 10rem auto;
    align-items: center;
    gap: 0.5rem;
  }
  .agent-avatar-catalog-row code {
    color: hsl(var(--muted-foreground));
    font-size: 0.6875rem;
  }
  .agent-avatar-catalog-states {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1.25rem;
    gap: 0.375rem;
  }
  .agent-avatar-catalog-variants {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
