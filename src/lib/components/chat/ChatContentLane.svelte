<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils/cn';

  let {
    children,
    chief = false,
    composer = false,
    operational = false,
    element = $bindable(),
    class: className,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    children: Snippet;
    chief?: boolean;
    composer?: boolean;
    operational?: boolean;
    element?: HTMLDivElement;
  } = $props();
</script>

<div
  bind:this={element}
  {...rest}
  class={cn('chat-content-measure mx-auto w-full min-w-0', className)}
  class:chief
  class:composer-prompt-lane={composer}
  class:regular-chat-content-inset={operational && !chief}
>
  {@render children()}
</div>

<style>
  .chat-content-measure {
    --chat-content-inset: 1rem;
    max-width: 140em;
    padding-inline: var(--chat-content-inset);
  }
  .chief {
    --chat-content-inset: 0px;
  }
  /* Reserve presence above the composer without resizing the input on updates. */
  .composer-prompt-lane {
    padding-block: 1.25rem var(--chat-content-inset);
  }
  .chief.composer-prompt-lane {
    padding-bottom: 0.25rem;
  }
  @container chat-panel (max-width: 639.98px) {
    .regular-chat-content-inset {
      --chat-operational-row-inline-padding: 0.125rem;
      --chat-operational-leading-gap: 0.625rem;
    }
  }
  @container chat-panel (min-width: 640px) {
    .chat-content-measure {
      --chat-content-inset: 1.5rem;
    }
    .chief {
      --chat-content-inset: 0px;
    }
    .chief.composer-prompt-lane {
      padding-bottom: 0.5rem;
    }
  }
</style>
