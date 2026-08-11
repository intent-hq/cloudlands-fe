<script lang="ts">
  let { children, trigger, content, contentClass, class: className, onclick }: any = $props();
</script>

{#if children}
  <button data-testid="mock-tooltip-trigger" class={className} {onclick}
    >{@render children()}</button
  >
{/if}
{#if trigger}
  <button data-testid="mock-tooltip-trigger" class={className} {onclick}>{@render trigger()}</button
  >
{/if}
{#if content}
  <div data-testid="mock-tooltip-content" data-content-class={contentClass}>
    {@render content()}
  </div>
{/if}
