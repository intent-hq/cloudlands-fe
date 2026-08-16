<script lang="ts">
  import AgentAvatarWithState from './AgentAvatarWithState.svelte';
  import { agentAvatarCatalogIdentities, agentAvatarCatalogStates } from './agent-avatar.catalog';
  import type { AvatarState } from './avatar-state';
  import { agentAvatarVariants } from './avatar-size';

  const catalogStackStates = [
    'running',
    'unread',
    'attention-discussion',
  ] as const satisfies readonly AvatarState[];
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
    {#each catalogStackStates as state (state)}
      <AgentAvatarWithState
        agentId={`catalog-stack-${state}`}
        specialist="coordinator"
        {state}
        variant="emphasized"
      />
    {/each}
    <span data-agent-avatar-overflow>+3</span>
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
    grid-template-columns: repeat(10, 1.25rem);
    gap: 0.375rem;
  }
  .agent-avatar-catalog-variants,
  .agent-avatar-catalog-stack {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .agent-avatar-catalog-stack {
    gap: 0;
    width: min-content;
  }
  .agent-avatar-catalog-stack
    > :global([data-agent-avatar-with-state] + [data-agent-avatar-with-state]) {
    margin-inline-start: calc(-1 * var(--agent-avatar-emphasized-stack-overlap));
  }
  [data-agent-avatar-overflow] {
    display: inline-flex;
    width: max-content;
    align-items: center;
    justify-content: center;
    margin-inline-start: 0.25rem;
    border: 0;
    background: transparent;
    box-shadow: none;
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1;
  }
</style>
