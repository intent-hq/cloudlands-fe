<script lang="ts">
  import { onDestroy } from 'svelte';

  let {
    children,
    content,
    title,
    delayDuration,
    class: className,
    contentClass,
    contentContainerClass,
    disableHoverableContent = false,
    disabled = false,
  }: any = $props();
  let open = $state(false);
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let pointerWithin = false;
  let focusWithin = false;

  function clearOpenTimer() {
    if (openTimer === null) return;
    clearTimeout(openTimer);
    openTimer = null;
  }

  function handleMouseEnter() {
    pointerWithin = true;
    if (disabled || focusWithin) return;
    clearOpenTimer();
    openTimer = setTimeout(() => {
      openTimer = null;
      open = true;
    }, delayDuration);
  }

  function handleMouseLeave() {
    pointerWithin = false;
    clearOpenTimer();
    if (!focusWithin) open = false;
  }

  function handleFocusIn() {
    focusWithin = true;
    clearOpenTimer();
    if (!disabled) open = true;
  }

  function handleFocusOut(event: FocusEvent) {
    const currentTarget = event.currentTarget;
    if (
      currentTarget instanceof HTMLElement &&
      event.relatedTarget instanceof Node &&
      currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    focusWithin = false;
    if (!pointerWithin) open = false;
  }

  onDestroy(clearOpenTimer);
</script>

<div
  class={className}
  data-tooltip-title={title}
  data-tooltip-delay={delayDuration}
  data-tooltip-content-class={contentClass}
  data-tooltip-container-class={contentContainerClass}
  data-tooltip-disable-hoverable-content={disableHoverableContent}
  data-testid="workspace-tab-tooltip-root"
  role="group"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onfocusin={handleFocusIn}
  onfocusout={handleFocusOut}
>
  {@render children?.()}
  {#if open && content}
    <div data-testid="workspace-tab-preview" role="tooltip">{@render content()}</div>
  {/if}
</div>
