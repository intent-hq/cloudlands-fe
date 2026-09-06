<script lang="ts">
  let { document, activePath, rungOverride = 2, onOpen }: any = $props();
</script>

<div
  role="region"
  aria-label="Changed files map"
  data-testid="diff-map"
  data-active-path={activePath}
  data-rung={rungOverride}
>
  {#each document.files as file (file.id)}
    <button data-map-file={file.path} onclick={(event) => onOpen(file, event)}>
      {file.path}
    </button>
  {/each}
</div>
