<script lang="ts">
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarStateForSession } from '$features/agent/components/agent-avatar/avatar-state';
  import { getAgentAvatarStateLabel } from '$features/agent/components/agent-avatar/avatar-state-label';
  import { selectConnectionLabel } from '$features/remote-machines/remote-machines-selectors';
  import { Button } from '$lib/components/ui/button';
  import { menuItem } from '$lib/components/ui/menu';
  import { formatRelativeTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { RecentAgentEntry } from '$shared/recent-agents';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';

  interface Props {
    entry: RecentAgentEntry;
    id: string;
    selected: boolean;
    /** The entry lives on this window's machine, so its live status is known here. */
    local: boolean;
    /** The entry's machine has no live connection; opening it connects first. */
    offline: boolean;
    onpoint: (event: PointerEvent) => void;
    onchoose: () => void;
  }

  let { entry, id, selected, local, offline, onpoint, onchoose }: Props = $props();

  // svelte-ignore state_referenced_locally - selector readables must be created at component init; the card is keyed by its entry
  const session$ = selectAgentSession(entry.agentId);
  // svelte-ignore state_referenced_locally - selector readables must be created at component init; the card is keyed by its entry
  const machineLabel$ = selectConnectionLabel(entry.connectionId);

  const session = $derived(local ? $session$ : undefined);
  const avatarState = $derived(session ? getAvatarStateForSession(session) : null);
  const name = $derived(
    session?.name || entry.agentName || m.recentAgents_switcher_untitled_label(),
  );
  const specialist = $derived(session?.metadata?.specialist ?? null);
</script>

<Button
  variant="plain"
  wrapContent={false}
  type="button"
  {id}
  role="option"
  tabindex={-1}
  aria-selected={selected}
  data-recent-agent-card
  data-selected={selected || undefined}
  data-offline={offline || undefined}
  class={menuItem({
    class: `h-auto w-44 shrink-0 flex-col items-start gap-1 whitespace-normal rounded-md border border-transparent p-3 text-left ${
      selected ? 'border-focus-ring bg-accent' : 'hover:bg-accent/60'
    } ${offline ? 'opacity-60' : ''}`,
  })}
  onpointermove={onpoint}
  onclick={onchoose}
>
  <span class="flex w-full min-w-0 items-center gap-2">
    {#if avatarState}
      <AgentAvatarWithState agentId={entry.agentId} {specialist} state={avatarState} />
    {:else}
      <AgentAvatar agentId={entry.agentId} {specialist} />
    {/if}
    <span class="min-w-0 truncate type-body font-medium! text-foreground">{name}</span>
  </span>
  {#if entry.workspaceTitle}
    <span class="w-full truncate type-caption text-foreground">{entry.workspaceTitle}</span>
  {/if}
  <span class="w-full truncate type-caption text-muted-foreground">
    {offline
      ? m.recentAgents_switcher_offlineMachine_label({ machine: $machineLabel$ })
      : $machineLabel$}
  </span>
  <span class="w-full truncate type-caption text-muted-foreground">
    {avatarState
      ? m.recentAgents_switcher_statusTime_label({
          status: getAgentAvatarStateLabel(avatarState),
          time: formatRelativeTime(entry.visitedAt),
        })
      : formatRelativeTime(entry.visitedAt)}
  </span>
</Button>
