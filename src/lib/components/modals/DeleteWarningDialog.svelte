<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
  faXmark,
  faExclamationTriangle,
} from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';

  interface Props {
    open?: boolean;
    agentNames?: string[];
    onDeleteAnyway?: () => void;
    onCancel?: () => void;
  }

  let { open = $bindable(false), agentNames = [], onDeleteAnyway, onCancel }: Props = $props();

  function close() {
    open = false;
    onCancel?.();
  }

  function handleDeleteAnyway() {
    onDeleteAnyway?.();
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }
</script>

{#if open}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="presentation"
      onkeydown={handleKeydown}
      onclick={close}
    >
      <div
        class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
        onclick={(e) => e.stopPropagation()}
        role="dialog"
        tabindex="-1"
        onkeydown={(e) => e.stopPropagation()}
      >
        <!-- Header -->
        <div class="px-6 py-4 border-b border-border flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="text-red-600 dark:text-red-500">
              <Fa icon={faExclamationTriangle} size="lg" />
            </div>
            <div>
              <h2 class="text-lg font-semibold">Stop agents and delete space?</h2>
              <p class="text-sm text-subtle mt-0.5">Agents are currently running</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onclick={close}>
            <Fa icon={faXmark} />
          </Button>
        </div>

        <!-- Content -->
        <div class="p-6 space-y-4">
          <p class="text-sm text-foreground">
            This space has {agentNames.length} active agent{agentNames.length !== 1 ? 's' : ''}:
          </p>
          {#if agentNames.length > 0}
            <ul class="space-y-2">
              {#each agentNames as name}
                <li class="text-sm text-subtle flex items-center gap-2">
                  <span class="w-2 h-2 bg-red-600 dark:bg-red-500 rounded-full"></span>
                  {name}
                </li>
              {/each}
            </ul>
          {/if}
          <p class="text-sm text-subtle">
            To delete this space, Intent will stop these agents and permanently remove the space from
            disk. This cannot be undone.
          </p>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" onclick={close}>Cancel</Button>
          <Button variant="destructive" onclick={handleDeleteAnyway}>Stop agents and delete</Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
