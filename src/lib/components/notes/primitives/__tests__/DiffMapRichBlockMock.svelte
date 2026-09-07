<script lang="ts">
  let { document, onOpen }: any = $props();
</script>

{#each document.files as file (file.id)}
  <button onclick={(event) => onOpen(file, event)}>{file.path}</button>
{/each}
