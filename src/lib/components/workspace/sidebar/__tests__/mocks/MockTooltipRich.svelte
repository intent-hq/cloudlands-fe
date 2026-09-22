<script lang="ts">
  let {
    children,
    trigger,
    content,
    contentClass,
    contentContainerClass,
    class: className,
    onclick,
    delayDuration,
    disableCloseOnTriggerClick,
    showArrow,
  }: any = $props();
</script>

{#if children}
  <button
    data-testid="mock-tooltip-trigger"
    class={className}
    data-delay-duration={delayDuration}
    data-disable-close-on-trigger-click={disableCloseOnTriggerClick}
    data-show-arrow={showArrow}
    {onclick}>{@render children()}</button
  >
{/if}
{#if trigger}
  <button
    data-testid="mock-tooltip-trigger"
    class={className}
    data-delay-duration={delayDuration}
    data-disable-close-on-trigger-click={disableCloseOnTriggerClick}
    data-show-arrow={showArrow}
    {onclick}>{@render trigger()}</button
  >
{/if}
{#if content}
  <div
    data-testid="mock-tooltip-content"
    data-content-class={contentClass}
    data-content-container-class={contentContainerClass}
  >
    {@render content()}
  </div>
{/if}
