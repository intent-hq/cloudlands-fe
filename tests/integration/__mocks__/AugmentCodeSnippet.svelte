<script lang="ts">
  export let code: string = '';
  export let language: string | undefined = undefined;
  export let path: string | undefined = undefined;
  export let mode: string | undefined = undefined;
  export let onOpenFile: ((detail: { path: string }) => void) | undefined = undefined;
</script>

<div class="augment-code-snippet">
  {code}
</div>

<style>
  .augment-code-snippet {
    padding: 0.5rem;
    background: #f5f5f5;
    border-radius: 4px;
    font-family: monospace;
  }
</style>
