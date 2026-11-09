<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { workspacePickerStyles } from '$lib/components/workspace/initializer/workspace-picker-styles';
  import { cn } from '$lib/utils';
  import type { Specialist } from '$lib/constants/specialists';
  import { m } from '$shared/paraglide/messages.js';

  let {
    specialists,
    value = null,
    compact = false,
    onchange,
  }: {
    specialists: readonly Specialist[];
    value?: string | null;
    /** Single-line, body-sized rows with plain outline icons and no descriptions. */
    compact?: boolean;
    onchange: (id: string | null) => void;
  } = $props();

  const options = $derived([
    ...specialists,
    {
      id: null,
      name: m.chat_shared_general_fallback(),
      description: m.chat_shared_noSpecializedBehavior_label(),
      icon: undefined,
    },
  ]);
</script>

<Menu.RadioGroup
  value={value === null ? 'general' : `specialist:${value}`}
  aria-label={m.workspace_createAgentSection_specialists_label()}
>
  {#each options as option (option.id)}
    {#snippet compactLeading()}
      <span class={cn('plain-agent-icon flex', workspacePickerStyles.icon)}>
        <AgentAvatar agentId="blank" variant="compact" specialist={option.id} icon={option.icon} />
      </span>
    {/snippet}
    <Menu.RadioItem
      value={option.id === null ? 'general' : `specialist:${option.id}`}
      closeOnSelect
      leading={compact ? compactLeading : undefined}
      class={compact
        ? workspacePickerStyles.row
        : 'h-auto min-h-(--control-height-medium) gap-2 py-2 whitespace-normal'}
      data-specialist-option={option.id ?? 'general'}
      onSelect={() => onchange(option.id)}
    >
      {#if compact}
        <span class="min-w-0 flex-1 truncate">{option.name}</span>
      {:else}
        <span class="first-line-icon w-5">
          <AgentAvatar
            agentId="blank"
            variant="standard"
            specialist={option.id}
            icon={option.icon}
          />
        </span>
        <span class="flex min-w-0 flex-1 flex-col text-left">
          <span class="type-caption truncate text-foreground">{option.name}</span>
          <span class="type-caption line-clamp-2 text-muted-foreground">{option.description}</span>
        </span>
      {/if}
    </Menu.RadioItem>
  {/each}
</Menu.RadioGroup>

<style>
  /* Outline glyph only: no avatar tile, ink follows the row text. */
  .plain-agent-icon :global(.agent-avatar) {
    background: transparent;
    color: currentColor;
    padding: 0;
  }
</style>
