<script lang="ts">
  import DiffMap from './DiffMap.svelte';
  import type {
    DiffMapClaimAnnotation,
    DiffMapDocument,
    DiffMapFile,
    DiffMapGroupAnnotation,
  } from '../model/types';

  interface Props {
    document: DiffMapDocument;
    onOpen: (file: DiffMapFile, event: MouseEvent | KeyboardEvent) => void;
  }

  let { document, onOpen }: Props = $props();
  let enabledClaims = $state(new Set<string>());
  let activeGroup = $state<string | undefined>();
  const claims = $derived(
    document.annotations.filter(
      (annotation): annotation is DiffMapClaimAnnotation => annotation.kind === 'claim',
    ),
  );
  const groups = $derived(
    document.annotations.filter(
      (annotation): annotation is DiffMapGroupAnnotation => annotation.kind === 'group',
    ),
  );
  const highlightedPaths = $derived(
    new Set(claims.filter((claim) => enabledClaims.has(claim.id)).flatMap((claim) => claim.paths)),
  );
  const pathFilter = $derived(
    activeGroup
      ? new Set(groups.find((group) => group.id === activeGroup)?.paths ?? [])
      : undefined,
  );

  function toggleClaim(id: string) {
    const next = new Set(enabledClaims);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    enabledClaims = next;
  }
</script>

<div class="rich-diff-map ws-block-widget">
  {#if claims.length > 0 || groups.length > 0}
    <div class="annotation-chips">
      {#each claims as claim (claim.id)}
        <button
          type="button"
          class:active={enabledClaims.has(claim.id)}
          aria-pressed={enabledClaims.has(claim.id)}
          onclick={() => toggleClaim(claim.id)}>{claim.label}</button
        >
      {/each}
      {#each groups as group (group.id)}
        <button
          type="button"
          class:active={activeGroup === group.id}
          aria-pressed={activeGroup === group.id}
          onclick={() => (activeGroup = activeGroup === group.id ? undefined : group.id)}
          >{group.label}</button
        >
      {/each}
    </div>
  {/if}
  <div class="map">
    <DiffMap {document} selection={highlightedPaths} {pathFilter} filterable={false} {onOpen} />
  </div>
</div>

<style>
  .rich-diff-map {
    display: flex;
    height: 320px;
    min-height: 180px;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    background: hsl(var(--background));
  }

  .annotation-chips {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 5px;
    padding: 6px;
    border-bottom: 1px solid hsl(var(--border));
  }

  button {
    padding: 2px 8px;
    border: 1px solid hsl(var(--border));
    border-radius: 999px;
    color: hsl(var(--muted-foreground));
    font-size: 11px;
  }

  button.active {
    border-color: hsl(var(--ring));
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }

  .map {
    min-height: 0;
    flex: 1;
  }
</style>
