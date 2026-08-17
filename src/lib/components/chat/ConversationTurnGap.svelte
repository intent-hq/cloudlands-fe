<script lang="ts">
  interface Props {
    currentIsEventNotification: boolean;
    currentHasAssistantMessages: boolean;
    nextIsEventNotification: boolean;
  }

  let { currentIsEventNotification, currentHasAssistantMessages, nextIsEventNotification }: Props =
    $props();

  const gapClass = $derived(
    nextIsEventNotification
      ? 'h-0'
      : currentIsEventNotification && !currentHasAssistantMessages
        ? 'h-6'
        : 'h-8',
  );
</script>

<div
  class={gapClass}
  data-testid="conversation-turn-gap"
  data-gap-before-wake={nextIsEventNotification ? '' : undefined}
  aria-hidden="true"
></div>
