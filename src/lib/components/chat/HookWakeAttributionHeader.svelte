<script lang="ts">
  /**
   * HookWakeAttributionHeader
   *
   * Compact attribution chip for background-hook wake messages
   * (`messageMetadata.type === 'hook_wake'`, PROTOCOL §5.40): bolt icon +
   * hook name + "woke the agent". Non-interactive — mirrors the
   * AgentMessageAttributionHeader layout without the click-through.
   */
  import Fa from 'svelte-fa';
  import { faBolt } from '@fortawesome/free-solid-svg-icons';
  import type { HookWakeAttribution } from '$lib/utils/hook-wake-attribution';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    attribution: HookWakeAttribution;
    /** Optional class name */
    class?: string;
  }

  let { attribution, class: className = '' }: Props = $props();
</script>

<div
  class="flex items-center gap-1.5 rounded-md text-xs {className}"
  data-testid="hook-wake-attribution"
>
  <Fa icon={faBolt} class="w-3 h-3 text-ghost" />
  <span class="text-foreground truncate max-w-[150px] font-medium">
    {attribution.displayName}
  </span>
  <span class="text-subtle">{m.chat_hookWakeAttribution_wokeAgent_after()}</span>
</div>
