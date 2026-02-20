<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils.js';
  import type { HTMLLiAttributes } from 'svelte/elements';

  type Props = HTMLLiAttributes;

  let { class: className, children, ...restProps }: Props = $props();
</script>

<li role="presentation" aria-hidden="true" class={cn('[&>svg]:size-3.5', className)} {...restProps}>
  {#if children}
    {@render children()}
  {:else}
    <Fa icon={faChevronRight} size="1x" />
  {/if}
</li>
