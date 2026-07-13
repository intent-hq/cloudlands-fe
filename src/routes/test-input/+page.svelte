<script lang="ts">
  import SimpleRichInput from '$lib/components/chat/input/SimpleRichInput.svelte';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import { createLogger } from '$lib/utils/client-logger';
  import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';

  const logger = createLogger('TestInput');

  let value = $state('');
  let contextItems: ContextItem[] = $state([]);
  let selectedModel = $state<string>(DEFAULT_AGENT_MODEL);
  let isStreaming = $state(false);
  let isProcessing = $state(false);

  function handleSubmit() {
    logger.info('Submit:', { value, contextItems, selectedModel });
  }

  function handleEnhance() {
    logger.info('Enhance requested');
  }

  function handleStop() {
    logger.info('Stop requested');
    isStreaming = false;
    isProcessing = false;
  }

  function handleModelChange(model: string) {
    logger.info('Model changed:', model);
    selectedModel = model;
  }

  function handleContextAdd(item: ContextItem) {
    logger.info('Context item added:', item);
  }

  function handleContextRemove(id: string) {
    logger.info('Context item removed:', id);
  }

  // Test streaming toggle
  function toggleStreaming() {
    isStreaming = !isStreaming;
    logger.info('Streaming toggled:', isStreaming);
  }

  // Test processing toggle
  function toggleProcessing() {
    isProcessing = !isProcessing;
    logger.info('Processing toggled:', isProcessing);
  }
</script>

<div class="p-8 max-w-4xl mx-auto space-y-4">
  <h1 class="text-2xl font-bold">SimpleRichInput Test Page</h1>

  <div class="space-y-2">
    <div class="flex gap-4">
      <button
        class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        onclick={toggleStreaming}
      >
        Toggle Streaming ({isStreaming ? 'ON' : 'OFF'})
      </button>

      <button
        class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        onclick={toggleProcessing}
      >
        Toggle Processing ({isProcessing ? 'ON' : 'OFF'})
      </button>
    </div>

    <div class="text-sm text-subtle">
      <p>Current Model: {selectedModel}</p>
      <p>Value length: {value.length}</p>
      <p>Context items: {contextItems.length}</p>
    </div>
  </div>

  <div class="border rounded-lg p-4">
    <SimpleRichInput
      bind:value
      bind:contextItems
      workspace={null}
      currentContext={null}
      placeholder="Test the input component here..."
      disabled={false}
      editableWhileDisabled={false}
      {isStreaming}
      {selectedModel}
      onsubmit={handleSubmit}
      onenhance={handleEnhance}
      onstop={handleStop}
      oncontextAdd={handleContextAdd}
      oncontextRemove={handleContextRemove}
      onmodelChange={handleModelChange}
    />
  </div>

  <div class="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded">
    <h3 class="font-semibold mb-2">Debug Output:</h3>
    <pre class="text-xs overflow-auto">{JSON.stringify(
        { value, selectedModel, isStreaming, isProcessing, contextItems },
        null,
        2,
      )}</pre>
  </div>
</div>
