<script lang="ts">
  /**
   * A (?) icon inside a provider ⋯ menu row that shows the row's explanation
   * on hover. Pointer events on the icon do not reach the row, so hovering or
   * clicking it never toggles the row. Screen readers get the same text from
   * a `ProviderMenuHelpText` placed outside the row.
   */
  import { Tooltip } from '$lib/components/patterns/settings/custom-controls';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faCircleQuestion } from '$lib/icons/phosphor-icons';

  interface Props {
    text: string;
  }

  let { text }: Props = $props();

  function stop(event: Event) {
    event.stopPropagation();
    event.preventDefault();
  }
</script>

<Tooltip content={text} side="top" class="pointer-events-auto shrink-0">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <span
    class="flex h-lh items-center text-muted-foreground hover:text-foreground"
    aria-hidden="true"
    onpointerdown={stop}
    onpointerup={stop}
    onclick={stop}
  >
    <Fa icon={faCircleQuestion} class="size-3.5" />
  </span>
</Tooltip>
