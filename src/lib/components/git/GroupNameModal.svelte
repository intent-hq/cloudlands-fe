<script lang="ts">
  let {
    show = $bindable(),
    groupName = $bindable(),
    onCreate,
  }: {
    show: boolean;
    groupName: string;
    onCreate: () => void;
  } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      onCreate();
    } else if (e.key === 'Escape') {
      show = false;
    }
  }

  function autofocusOnMount(node: HTMLElement) {
    requestAnimationFrame(() => node.focus());
    return {};
  }
</script>

{#if show}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    onkeydown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (show = false)}
    onclick={() => (show = false)}
  >
    <div
      class="bg-card border border-border rounded-lg shadow-lg w-full max-w-md p-6"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <h2 class="text-lg font-semibold text-foreground mb-4">Create Group</h2>

      <div class="mb-6">
        <label for="group-name" class="block mb-2 text-sm font-medium text-foreground">
          Group Name
        </label>
        <input
          id="group-name"
          type="text"
          class="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
          bind:value={groupName}
          placeholder="Enter group name..."
          onkeydown={handleKeydown}
          use:autofocusOnMount
        />
      </div>

      <div class="flex gap-2 justify-end">
        <button
          class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          onclick={() => (show = false)}
        >
          Cancel
        </button>
        <button
          class="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={onCreate}
          disabled={!groupName.trim()}
        >
          Create
        </button>
      </div>
    </div>
  </div>
{/if}
