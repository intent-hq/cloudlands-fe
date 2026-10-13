<script lang="ts">
  import NativeCommentInputHarness from './NativeCommentInputHarness.svelte';
  let { source }: { source: string } = $props();
</script>

<NativeCommentInputHarness {source} />
<NativeCommentInputHarness {source} />
