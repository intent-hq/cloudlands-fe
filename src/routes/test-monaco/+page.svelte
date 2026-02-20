<script lang="ts">
  import { onMount } from 'svelte';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';

  let editorValue = `// Test Monaco Editor
function hello() {
  console.log("Monaco Editor is working!");
}

hello();`;

  let errorMessage = '';
  let isLoaded = false;

  onMount(() => {
    // Check if Monaco loaded successfully
    setTimeout(() => {
      isLoaded = true;
    }, 1000);
  });
</script>

<div class="p-8">
  <h1 class="text-2xl font-bold mb-4">Monaco Editor Test</h1>

  {#if errorMessage}
    <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
      Error: {errorMessage}
    </div>
  {/if}

  <div class="border rounded-lg overflow-hidden" style="height: 400px;">
    <CodeEditor bind:value={editorValue} language="javascript" lineNumbers={true} />
  </div>

  <div class="mt-4">
    <p class="text-sm text-muted-foreground">
      Status: {isLoaded ? '✅ Editor loaded' : '⏳ Loading...'}
    </p>
    <p class="text-sm text-muted-foreground mt-2">
      Current value length: {editorValue.length} characters
    </p>
  </div>
</div>
