<script lang="ts">
  interface MentionItem {
    id: string;
    label: string;
    type: string;
    description?: string;
  }

  interface Props {
    items: MentionItem[];
    command: (props: any) => void;
  }

  let { items = [], command }: Props = $props();

  let selectedIndex = $state(0);

  function onKeyDown({ event }: { event: KeyboardEvent }) {
    if (event.key === 'ArrowUp') {
      upHandler();
      return true;
    }

    if (event.key === 'ArrowDown') {
      downHandler();
      return true;
    }

    if (event.key === 'Enter') {
      enterHandler();
      return true;
    }

    return false;
  }

  function upHandler() {
    selectedIndex = (selectedIndex + items.length - 1) % items.length;
  }

  function downHandler() {
    selectedIndex = (selectedIndex + 1) % items.length;
  }

  function enterHandler() {
    selectItem(selectedIndex);
  }

  function selectItem(index: number) {
    const item = items[index];
    if (item) {
      command(item);
    }
  }

  // Reset selected index when items change
  $effect(() => {
    selectedIndex = 0;
  });

  // Expose onKeyDown for parent
  export { onKeyDown };
</script>

{#if items.length > 0}
  <div class="flex flex-col">
    {#each items as item, index (item.id)}
      <button
        class="flex items-center gap-2 px-3 py-2 bg-transparent border-none cursor-pointer text-left w-full transition-colors duration-150 {index ===
        selectedIndex
          ? 'bg-muted'
          : 'hover:bg-muted'}"
        onclick={() => selectItem(index)}
        onmouseenter={() => (selectedIndex = index)}
      >
        <span class="shrink-0 w-5 text-center">
          {#if item.type === 'file'}
            📄
          {:else if item.type === 'folder'}
            📁
          {:else if item.type === 'note'}
            📝
          {:else if item.type === 'workspace'}
            🏢
          {:else}
            📌
          {/if}
        </span>
        <div class="flex-1 min-w-0">
          <div
            class="text-[13px] font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {item.label}
          </div>
          {#if item.description}
            <div
              class="text-[11px] text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap mt-0.5"
            >
              {item.description}
            </div>
          {/if}
        </div>
        <span class="shrink-0 text-[11px] text-muted-foreground px-1.5 py-0.5 bg-background"
          >{item.type}</span
        >
      </button>
    {/each}
  </div>
{:else}
  <div class="p-3 text-center text-muted-foreground text-[13px]">No results found</div>
{/if}
