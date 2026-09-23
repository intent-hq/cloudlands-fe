<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import type { Specialist } from '$lib/constants/specialists';
  import { m } from '$shared/paraglide/messages.js';

  let {
    specialists,
    value = null,
    onchange,
  }: {
    specialists: readonly Specialist[];
    value?: string | null;
    onchange: (id: string | null) => void;
  } = $props();

  const options = $derived([
    {
      id: null,
      name: m.chat_shared_general_fallback(),
      description: m.chat_shared_noSpecializedBehavior_label(),
      icon: undefined,
    },
    ...specialists,
  ]);
</script>

<Menu.RadioGroup
  value={value === null ? 'general' : `specialist:${value}`}
  aria-label={m.workspace_createAgentSection_specialists_label()}
>
  {#each options as option (option.id)}
    <Menu.RadioItem
      value={option.id === null ? 'general' : `specialist:${option.id}`}
      closeOnSelect
      class="h-auto min-h-(--control-height-medium) gap-2 py-2 whitespace-normal"
      data-specialist-option={option.id ?? 'general'}
      onSelect={() => onchange(option.id)}
    >
      <AgentAvatar agentId="blank" variant="standard" specialist={option.id} icon={option.icon} />
      <span class="flex min-w-0 flex-1 flex-col text-left">
        <span class="type-caption truncate text-foreground">{option.name}</span>
        <span class="type-caption line-clamp-2 text-muted-foreground">{option.description}</span>
      </span>
    </Menu.RadioItem>
  {/each}
</Menu.RadioGroup>
