<script lang="ts">
  interface Props {
    currentIsEventNotification: boolean;
    currentHasAssistantMessages: boolean;
    nextIsEventNotification: boolean;
    nextHasUserMessage?: boolean;
    compactOperationalSeam?: boolean;
    zeroToolSeam?: boolean;
  }

  let {
    currentIsEventNotification,
    currentHasAssistantMessages,
    nextIsEventNotification,
    nextHasUserMessage = false,
    compactOperationalSeam = false,
    zeroToolSeam = false,
  }: Props = $props();

  const gapClass = $derived(
    zeroToolSeam
      ? 'h-0'
      : compactOperationalSeam
        ? 'h-2'
        : nextIsEventNotification
          ? 'h-0'
          : nextHasUserMessage
            ? 'h-10'
            : currentIsEventNotification && !currentHasAssistantMessages
              ? 'h-8'
              : 'h-8',
  );
</script>

<div
  class={gapClass}
  data-testid="conversation-turn-gap"
  data-gap-before-wake={nextIsEventNotification ? '' : undefined}
  data-operational-seam={compactOperationalSeam ? 'true' : undefined}
  data-tool-seam={zeroToolSeam ? 'true' : undefined}
  aria-hidden="true"
></div>
