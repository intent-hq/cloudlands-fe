<script lang="ts">
  import WorkspaceSurface from '../../WorkspaceSurface.svelte';
  let { count, columnMode }: { count: number; columnMode: boolean } = $props();
</script>

<div
  data-visible-workspace-host={columnMode ? `${count}-columns` : 'standalone'}
  style={`display: flex; width: ${columnMode ? count * 360 : 960}px; height: 640px; overflow: hidden;`}
>
  {#each Array.from({ length: count }) as _, index}
    <section
      data-visible-workspace-column={index + 1}
      style={`width: ${columnMode ? 360 : 960}px; height: 640px; overflow: hidden; flex: none;`}
    >
      <WorkspaceSurface
        workspaceId={`workspace-${index + 1}`}
        active={index === 0}
        manageTab={false}
        {columnMode}
      />
    </section>
  {/each}
</div>
