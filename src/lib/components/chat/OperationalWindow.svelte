<script
  lang="ts"
  generics="T extends {key:string; kind:'tool'|'reasoning'|'group'|'content';estimatedHeight:number}"
>
  import { untrack, type Snippet } from 'svelte';
  import { useOperationalPanel, type WindowSegment } from './operational-panel.svelte';
  let { items, scope, row }: { items: T[]; scope: string; row: Snippet<[T, boolean]> } = $props();
  const panel = useOperationalPanel();
  let segments = $state<WindowSegment[]>([]);
  let publishedItems = $state.raw<T[]>([]);
  function attach(node: HTMLElement) {
    const detach = panel.attach(scope, node, items, (next) => (segments = next));
    publishedItems = items;
    return { destroy: detach };
  }
  $effect(() => {
    const next = items;
    untrack(() => {
      panel.update(scope, next);
      publishedItems = next;
    });
  });
</script>

<div use:attach data-operational-window={scope} style="overflow-anchor:none">
  {#each segments as segment (segment.key)}
    {#if segment.type === 'spacer'}
      <div
        data-operational-spacer
        data-operational-spacer-rows={segment.end - segment.start}
        style:height={`${segment.height}px`}
        aria-hidden="true"
      ></div>
    {:else}
      {@const item = publishedItems[segment.start]}
      {#if item}
        <div
          use:panel.watch={item.key}
          data-operational-window-key={item.key}
          style="display:flow-root"
        >
          {@render row(item, segment.admitted)}
        </div>
      {/if}
    {/if}
  {/each}
</div>
