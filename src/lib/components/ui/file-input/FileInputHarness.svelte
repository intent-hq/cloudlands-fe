<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import FileInput from './file-input.svelte';

  let files = $state<FileList | undefined>();
</script>

<form>
  <FileInput
    id="theme-files"
    label="Choose theme files"
    accept=".json,application/json"
    multiple
    required
    name="themeFiles"
    bind:files
  />
  <Button type="reset">Reset form</Button>
  <Button type="button" onclick={() => (files = undefined)}>Reset from parent</Button>
</form>

<span role="status" aria-label="Bound filenames">
  {files?.length ? Array.from(files, (file) => file.name).join(', ') : 'No bound files'}
</span>
