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

  // Post-fire state suffix: on dispatched wakes carrying the additive
  // `hookStillActive` metadata field (PROTOCOL §5.40), say whether the hook
  // re-armed or retired; an eviction always retires the hook, so its wake
  // shows the retired suffix unconditionally (the body's state note is
  // display-stripped). Otherwise fall back to the plain "woke the agent".
  let stateLabel = $derived.by(() => {
    if (attribution.reason === 'evicted') {
      return m.chat_hookWakeAttribution_wokeAgentRetired_after();
    }
    if (attribution.reason === 'dispatched' && attribution.hookStillActive !== undefined) {
      return attribution.hookStillActive
        ? m.chat_hookWakeAttribution_wokeAgentStillActive_after()
        : m.chat_hookWakeAttribution_wokeAgentRetired_after();
    }
    return m.chat_hookWakeAttribution_wokeAgent_after();
  });
</script>

<div
  class="type-caption flex items-center gap-1.5 rounded-md {className}"
  data-testid="hook-wake-attribution"
>
  <Fa icon={faBolt} class="w-3 h-3 text-ghost" />
  <span
    class="text-foreground min-w-0 truncate font-medium"
    title={attribution.rawName || attribution.displayName}
  >
    {attribution.displayName}
  </span>
  <span class="text-subtle">{stateLabel}</span>
</div>
