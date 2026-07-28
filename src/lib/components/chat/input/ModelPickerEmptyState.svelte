<script lang="ts">
  import { fade } from 'svelte/transition';
  import {
  faArrowsRotate,
  faExclamationTriangle,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  import { cn } from '$lib/utils';
  import type { ProviderLoadError } from './model-picker-provider-errors';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    isLoadingModels: boolean;
    blockingLoadError: ProviderLoadError | null;
    onRetry: () => void;
  }

  let { isLoadingModels, blockingLoadError, onRetry }: Props = $props();
</script>

<div class="px-1 py-1" transition:fade={{ duration: 150 }}>
  {#if isLoadingModels}
    {#each [4, 3] as itemCount, i}
      <div>
        <div class="px-3 pt-3 pb-1 flex items-center gap-2">
          <div class="size-3.5 rounded bg-muted/60 animate-pulse"></div>
          <div class="h-3 w-16 bg-muted/60 rounded animate-pulse"></div>
        </div>
        {#each Array.from(Array(itemCount), (_, i) => i) as j}
          <div class="px-3 py-2 flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <div
                class="h-3.5 rounded bg-muted/40 animate-pulse"
                style="width: {60 + ((j * 17 + i * 23) % 30)}%; animation-delay: {(i *
                  itemCount +
                  j) *
                  75}ms"
              ></div>
            </div>
          </div>
        {/each}
      </div>
    {/each}
  {:else if blockingLoadError}
    <div class="flex flex-col items-center gap-2.5 py-4 px-3">
      <div class="flex items-center gap-1.5 text-destructive-foreground">
        <Fa icon={faExclamationTriangle} class="h-3.5 w-3.5" />
        <span class="text-sm font-medium">{m.chat_modelPicker_loadFailed_label()}</span>
      </div>
      <div class="text-xs text-center text-muted-foreground leading-tight max-w-[280px]">
        <div>{blockingLoadError.displayText}</div>
        {#if blockingLoadError.hint}
          <div class="mt-1 text-subtle">{blockingLoadError.hint}</div>
        {/if}
      </div>
      <button
        type="button"
        class={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
          'bg-muted hover:bg-muted/80 text-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
        onclick={onRetry}
      >
        <Fa icon={faArrowsRotate} class="h-3 w-3" />
        {m.chat_modelPicker_retry_label()}
      </button>
    </div>
  {:else}
    <div class="flex flex-col items-center gap-2.5 py-4 px-3 text-muted-foreground">
      <span class="text-sm">{m.chat_modelPicker_noModels_label()}</span>
      <button
        type="button"
        class={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
          'bg-muted hover:bg-muted/80 text-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
        onclick={onRetry}
      >
        <Fa icon={faArrowsRotate} class="h-3 w-3" />
        {m.chat_modelPicker_retry_label()}
      </button>
    </div>
  {/if}
</div>