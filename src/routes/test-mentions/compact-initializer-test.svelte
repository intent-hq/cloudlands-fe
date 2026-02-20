<script lang="ts">
  /**
   * Test page for RichTextarea component (used in CompactWorkspaceInitializer)
   * Tests mention dropdown positioning and functionality
   */
  import RichTextarea from '$lib/components/ui/RichTextarea.svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('CompactInitializerTest');

  let richTextarea: RichTextarea | null = $state(null);
  let value = $state('');
  let testMode = $state<'normal' | 'modal' | 'bottom'>('normal');
  let showModal = $state(false);
  let hasImages = $state(false);
  let hasMentions = $state(false);

  function handleChange(newValue: string) {
    value = newValue;
    logger.info('Content changed:', newValue);
  }

  function handleSubmit() {
    logger.info('Submit triggered');
    const mentions = richTextarea?.getMentions() ?? [];
    const contextMentions = richTextarea?.getContextMentions() ?? [];
    const images = richTextarea?.getInlineImages() ?? [];

    logger.info('Extracted data:', {
      mentions,
      contextMentions,
      images: images.map((img: { src: string; alt?: string }) => ({ alt: img.alt, srcLength: img.src.length })),
    });

    hasMentions = mentions.length > 0 || contextMentions.length > 0;
    hasImages = images.length > 0;
  }

  function insertTestMention() {
    richTextarea?.insertMention({
      id: 'test-file',
      label: 'test.ts',
      type: 'file',
      uri: 'file://test.ts',
      meta: { path: 'src/test.ts' },
    });
  }

  function insertTestImage() {
    // Create a small test image (1x1 red pixel)
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 100, 100);
      const dataUrl = canvas.toDataURL('image/png');
      richTextarea?.insertImage(dataUrl, 'Test image');
    }
  }

  function clearContent() {
    richTextarea?.clear();
    value = '';
    hasMentions = false;
    hasImages = false;
  }
</script>

<div class="test-page">
  <div class="header">
    <h1>RichTextarea Test (Compact Initializer)</h1>
    <p class="subtitle">Test mention dropdown positioning in different contexts</p>
  </div>

  <div class="controls">
    <h2>Test Mode</h2>
    <div class="button-group">
      <button class:active={testMode === 'normal'} onclick={() => testMode = 'normal'}>
        Normal
      </button>
      <button class:active={testMode === 'modal'} onclick={() => { testMode = 'modal'; showModal = true; }}>
        Modal Dialog
      </button>
      <button class:active={testMode === 'bottom'} onclick={() => testMode = 'bottom'}>
        Bottom of Page
      </button>
    </div>

    <h2>Actions</h2>
    <div class="button-group">
      <button onclick={insertTestMention}>Insert Test Mention</button>
      <button onclick={insertTestImage}>Insert Test Image</button>
      <button onclick={handleSubmit}>Extract Data</button>
      <button onclick={clearContent}>Clear</button>
    </div>

    <div class="status">
      <div>Has Mentions: {hasMentions ? '✅' : '❌'}</div>
      <div>Has Images: {hasImages ? '✅' : '❌'}</div>
      <div>Content Length: {value.length}</div>
    </div>
  </div>

  {#if testMode === 'normal'}
    <div class="editor-container normal">
      <h3>Type @ to test mention dropdown</h3>
      <RichTextarea
        bind:this={richTextarea}
        bind:value
        placeholder="Type @ to test mentions..."
        onchange={handleChange}
        onsubmit={handleSubmit}
        minHeight={120}
        maxHeight={400}
      />
    </div>
  {/if}

  {#if testMode === 'bottom'}
    <div style="height: 80vh;"></div>
    <div class="editor-container bottom">
      <h3>Editor at bottom - dropdown should appear above</h3>
      <RichTextarea
        bind:this={richTextarea}
        bind:value
        placeholder="Type @ to test mentions..."
        onchange={handleChange}
        onsubmit={handleSubmit}
        minHeight={120}
        maxHeight={400}
      />
    </div>
  {/if}

  {#if showModal && testMode === 'modal'}
    <div class="modal-overlay" onclick={() => showModal = false}>
      <div class="modal-content" onclick={(e) => e.stopPropagation()}>
        <h3>Modal Dialog Test</h3>
        <p>Dropdown should appear correctly within modal</p>
        <RichTextarea
          bind:this={richTextarea}
          bind:value
          placeholder="Type @ to test mentions..."
          onchange={handleChange}
          onsubmit={handleSubmit}
          minHeight={120}
          maxHeight={300}
        />
        <button onclick={() => showModal = false}>Close</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .test-page {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  .header h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: hsl(var(--muted-foreground));
    font-size: 0.875rem;
    margin-bottom: 2rem;
  }

  .controls {
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }

  .controls h2 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  .button-group {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .button-group button {
    padding: 0.5rem 1rem;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.875rem;
    transition: opacity 0.2s;
  }

  .button-group button:hover {
    opacity: 0.9;
  }

  .button-group button.active {
    background: hsl(var(--primary) / 0.8);
    box-shadow: 0 0 0 2px hsl(var(--primary) / 0.3);
  }

  .status {
    font-size: 0.875rem;
    color: hsl(var(--muted-foreground));
    display: flex;
    gap: 1rem;
  }

  .editor-container {
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }

  .editor-container h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-content {
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    padding: 2rem;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
  }

  .modal-content h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .modal-content p {
    color: hsl(var(--muted-foreground));
    margin-bottom: 1rem;
  }

  .modal-content button {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
  }
</style>
