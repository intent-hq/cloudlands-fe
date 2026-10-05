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
    open = $bindable(false),
    onOpenChange,
  }: any = $props();

  // Simulates the real tooltip opening from a hover: flips the bound `open`
  // and reports it, the way TooltipRich does. Content always renders so
  // tests can inspect the hover surface without opening it.
  function simulateHoverOpen() {
    open = true;
    onOpenChange?.(true);
  }
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
    data-open={open}
  >
    <button type="button" data-testid="mock-tooltip-hover-open" onclick={simulateHoverOpen}
    ></button>
    {@render content()}
  </div>
{/if}
