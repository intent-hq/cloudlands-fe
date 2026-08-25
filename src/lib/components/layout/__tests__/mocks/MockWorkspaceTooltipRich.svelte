<script lang="ts">
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
  onmouseenter={() => {
    if (!disabled) open = true;
  }}
  onmouseleave={() => (open = false)}
>
  {@render children?.()}
  {#if open && content}
    <div data-testid="workspace-tab-preview" role="tooltip">{@render content()}</div>
  {/if}
</div>
